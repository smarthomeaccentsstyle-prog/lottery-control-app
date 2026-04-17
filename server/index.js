const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const {
  canSessionAccessSeller,
  getAccessibleSellerUsernameSet,
  getAccessibleSellers,
  normalizeUsername,
} = require("./lib/access");
const {
  createAdmin,
  createSeller,
  createTicket,
  DEFAULT_DB,
  normalizeAdmin,
  normalizeSeller,
  normalizeTicket,
  updateAdmin,
  updateSeller,
  updateTicket,
} = require("./lib/models");
const {
  buildAdminOverview,
  buildRangeReportMetrics,
  buildRiskBoard,
  buildSellerReport,
} = require("./lib/reports");
const {
  buildServerTimeSnapshot,
  formatDrawLabel,
  getCurrentBusinessDate,
  getEntryCutoffValue,
  getLatestAllowedTicketDate,
  getNextValidTicketDate,
  getResultAvailability,
  getResultReleaseValue,
  isDrawClosedForDate,
  isTicketLocked,
} = require("./lib/drawTiming");
const { getMaintenanceState } = require("./lib/maintenance");
const {
  buildBackupExportPayload,
  buildReadinessReport,
  toPublicReadinessReport,
} = require("./lib/runtime");
const { hashPassword, isPasswordHash, verifyPassword } = require("./lib/passwords");
const {
  createSessionRecord,
  findSessionByToken,
  pruneExpiredSessions,
  removeSessionByToken,
  removeSessionsForAccount,
  toSessionPayload,
} = require("./lib/sessionStore");
const {
  getDb,
  getStorageInfo,
  updateDb,
} = require("./lib/store");
const {
  isStaticAssetPath,
  shouldServeAppShell,
} = require("./lib/staticRouting");

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const BUILD_DIR = path.join(__dirname, "..", "build");
const AUTH_REQUIRED_MESSAGE = "Session expired. Please login again.";
const FORBIDDEN_MESSAGE = "You do not have permission for this action.";
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 7;
const MAINTENANCE_STATUS_CODE = 503;
const REQUEST_BODY_LIMIT_BYTES = resolveRequestBodyLimitBytes(
  process.env.REQUEST_BODY_LIMIT_BYTES || process.env.BODY_SIZE_LIMIT_BYTES
);
const SESSION_TTL_HOURS = resolveSessionTtlHours(process.env.SESSION_TTL_HOURS);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const CORS_ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const loginAttempts = new Map();
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(req, res);

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;
  const allowedOrigin = setCorsHeaders(req, res);

  if (pathname.startsWith("/api/") && isCorsPreflightRequest(req)) {
    if (!allowedOrigin) {
      return sendJson(res, 403, {
        ok: false,
        message: "Origin is not allowed.",
      });
    }

    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname.startsWith("/api/") && hasOriginHeader(req) && !allowedOrigin) {
    return sendJson(res, 403, {
      ok: false,
      message: "Origin is not allowed.",
    });
  }

  const authSession = pathname.startsWith("/api/") ? getAuthSession(req) : null;
  const maintenanceState = getMaintenanceState();

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      const storage = getStorageInfo();
      const db = getDb();
      const readiness = buildReadinessReport({
        db,
        storage,
        bodySizeLimitBytes: REQUEST_BODY_LIMIT_BYTES,
        sessionTtlHours: SESSION_TTL_HOURS,
        corsMode: CORS_ALLOWED_ORIGINS.length > 0 ? "custom" : "same-origin",
        shuttingDown,
      });

      return sendJson(res, 200, {
        ok: true,
        service: "lottery-control-backend",
        time: new Date().toISOString(),
        maintenance: maintenanceState,
        readiness: toPublicReadinessReport(readiness),
        storage: {
          mode: storage.usingExternalStorage ? "external" : "bundled",
          writable: storage.writable !== false,
          initializationMode: storage.initializationMode,
          migrationSource: storage.migrationSource ? path.basename(storage.migrationSource) : "",
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers.map(toPublicSeller),
        settings: db.settings,
        maintenance: maintenanceState,
      });
    }

    if (pathname.startsWith("/api/") && shuttingDown) {
      return sendJson(res, 503, {
        ok: false,
        message: "Server is restarting. Please try again in a moment.",
      });
    }

    if (pathname.startsWith("/api/") && maintenanceState.enabled) {
      return sendMaintenanceResponse(res, maintenanceState);
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const db = getDb();
      const role = String(body.role || "").toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();
      const loginKey = getLoginAttemptKey(req, role, username);
      const blockedUntil = getBlockedLoginUntil(loginKey);

      if (blockedUntil) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((blockedUntil - Date.now()) / 1000)
        );
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return sendJson(res, 429, {
          ok: false,
          message: "Too many login attempts. Please wait a little and try again.",
        });
      }

      if (role === "master") {
        if (
          normalizeUsername(username) === normalizeUsername(db.master.username) &&
          verifyPassword(password, db.master.password)
        ) {
          clearLoginAttempts(loginKey);
          const session = createStoredSession({
            role: "master",
            username: db.master.username,
          });

          return sendJson(res, 200, {
            ok: true,
            session,
          });
        }
      }

      if (role === "admin") {
        const adminAccount = findAdminAccountByUsername(db, username);

        if (adminAccount && verifyPassword(password, adminAccount.password)) {
          clearLoginAttempts(loginKey);
          const session = createStoredSession({
            role: "admin",
            adminId: adminAccount.id,
            username: adminAccount.username,
          });

          return sendJson(res, 200, {
            ok: true,
            session,
          });
        }
      }

      if (role === "seller") {
        const seller = db.sellers.find(
          (item) =>
            item.active &&
            item.username.toLowerCase() === username.toLowerCase() &&
            verifyPassword(password, item.password)
        );

        if (seller) {
          clearLoginAttempts(loginKey);
          const session = createStoredSession({
            role: "seller",
            username: seller.username,
            sellerId: seller.id,
            sellerName: seller.name,
          });

          return sendJson(res, 200, {
            ok: true,
            session,
          });
        }
      }

      recordFailedLogin(loginKey);

      return sendJson(res, 401, {
        ok: false,
        message: "Invalid login",
      });
    }

    if (req.method === "GET" && pathname === "/api/auth/session") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      return sendJson(res, 200, {
        ok: true,
        session: toSessionPayload(authSession, authSession.token),
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      revokeStoredSession(authSession && authSession.token ? authSession.token : "");

      return sendJson(res, 200, {
        ok: true,
      });
    }

    if (req.method === "PATCH" && pathname === "/api/auth/password") {
      if (!ensureAnyRole(res, authSession, ["seller", "admin"])) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = sanitizePasswordChangePayload(body);
      validatePasswordChangePayload(payload);

      if (authSession.role === "seller") {
        let refreshedSession = null;
        const db = updateDb((current) => {
          const sellerIndex = current.sellers.findIndex(
            (seller) =>
              String(seller.id) === String(authSession.sellerId) ||
              normalizeUsername(seller.username) === normalizeUsername(authSession.username)
          );

          if (sellerIndex < 0) {
            throw new ForbiddenError(FORBIDDEN_MESSAGE);
          }

          const currentSeller = current.sellers[sellerIndex];

          if (!verifyPassword(payload.currentPassword, currentSeller.password)) {
            throw new ValidationError("Current password is incorrect");
          }

          current.sellers[sellerIndex] = updateSeller(currentSeller, {
            password: hashPassword(payload.newPassword),
          });
          current.sessions = removeSessionsForAccount(current.sessions, {
            role: "seller",
            sellerId: currentSeller.id,
            username: currentSeller.username,
          });

          const createdSession = createSessionRecord({
            role: "seller",
            username: currentSeller.username,
            sellerId: currentSeller.id,
            sellerName: currentSeller.name,
          }, {
            ttlMs: SESSION_TTL_MS,
          });
          refreshedSession = toSessionPayload(createdSession.session, createdSession.token);
          current.sessions.push(createdSession.session);
          return current;
        });

        return sendJson(res, 200, {
          ok: true,
          seller: toPublicSeller(
            db.sellers.find((seller) => String(seller.id) === String(authSession.sellerId))
          ),
          session: refreshedSession,
          message: "Seller password updated",
        });
      }

      let refreshedSession = null;
      const db = updateDb((current) => {
        const adminAccounts = getAdminAccounts(current);
        const adminIndex = adminAccounts.findIndex(
          (admin) =>
            String(admin.id) === String(authSession.adminId) ||
            normalizeUsername(admin.username) === normalizeUsername(authSession.username)
        );

        if (adminIndex < 0) {
          throw new ForbiddenError(FORBIDDEN_MESSAGE);
        }

        const currentAdmin = adminAccounts[adminIndex];

        if (!verifyPassword(payload.currentPassword, currentAdmin.password)) {
          throw new ValidationError("Current password is incorrect");
        }

        const nextAdmins = adminAccounts.map((admin, index) =>
          index === adminIndex
            ? updateAdmin(currentAdmin, {
                password: hashPassword(payload.newPassword),
              })
            : admin
        );

        syncAdminAccounts(current, nextAdmins);
        current.sessions = removeSessionsForAccount(current.sessions, {
          role: "admin",
          adminId: currentAdmin.id,
          username: currentAdmin.username,
        });

        const createdSession = createSessionRecord({
          role: "admin",
          adminId: currentAdmin.id,
          username: currentAdmin.username,
        }, {
          ttlMs: SESSION_TTL_MS,
        });
        refreshedSession = toSessionPayload(createdSession.session, createdSession.token);
        current.sessions.push(createdSession.session);
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        admin: toPublicAdmin(findAdminAccountBySession(db, authSession)),
        session: refreshedSession,
        message: "Admin password updated",
      });
    }

    if (pathname === "/api/sellers" && req.method === "GET") {
      if (!ensureAnyRole(res, authSession, ["admin", "master"])) {
        return;
      }

      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        sellers: getScopedSellers(db, authSession).map(toPublicSeller),
      });
    }

    if (pathname === "/api/sellers" && req.method === "POST") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = sanitizeSellerPayload(body);

      validateRequiredSellerFields(payload);

      const db = updateDb((current) => {
        ensureUniqueSellerUsername(current.sellers, payload.username);
        current.sellers.push(
          createSeller({
            ...payload,
            password: hashPassword(payload.password),
            active: payload.active !== undefined ? payload.active : true,
            ownerAdminId:
              authSession.role === "admin"
                ? authSession.adminId
                : getPrimaryAdminId(current),
          }, current.sellers)
        );
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        sellers: getScopedSellers(db, authSession).map(toPublicSeller),
      });
    }

    if (pathname.startsWith("/api/sellers/") && req.method === "PATCH") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const sellerId = extractId(pathname, "/api/sellers/");
      const body = await readJsonBody(req);
      const payload = sanitizeSellerPayload(body, {
        partial: true,
      });

      const db = updateDb((current) => {
        const existingSeller = findSellerById(current, sellerId);

        if (!existingSeller) {
          throw new Error("Seller not found");
        }

        ensureSessionCanAccessSeller(current, authSession, existingSeller);
        validateSellerUpdatePayload(payload);

        if (payload.username) {
          ensureUniqueSellerUsername(current.sellers, payload.username, sellerId);
        }

        if (payload.password) {
          payload.password = hashPassword(payload.password);
        }

        current.sellers = current.sellers.map((seller) =>
          String(seller.id) === sellerId ? updateSeller(seller, payload) : seller
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        sellers: getScopedSellers(db, authSession).map(toPublicSeller),
      });
    }

    if (pathname === "/api/tickets" && req.method === "GET") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");
      const sellerUsername = requestUrl.searchParams.get("sellerUsername");

      let tickets = getScopedTickets(db, authSession);

      if (date) {
        tickets = tickets.filter((ticket) => ticket.date === date);
      }

      if (drawTime) {
        tickets = tickets.filter((ticket) => ticket.drawTime === drawTime);
      }

      if (sellerUsername) {
        tickets = tickets.filter(
          (ticket) =>
            normalizeUsername(ticket.sellerUsername) === normalizeUsername(sellerUsername)
        );
      }

      return sendJson(res, 200, {
        ok: true,
        tickets,
      });
    }

    if (pathname === "/api/tickets" && req.method === "POST") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const body = await readJsonBody(req);
      const db = updateDb((current) => {
        const requestedSellerUsername =
          authSession.role === "seller"
            ? authSession.username
            : String(body && body.sellerUsername ? body.sellerUsername : "").trim();

        if (!requestedSellerUsername) {
          throw new ValidationError("sellerUsername is required");
        }

        if (authSession.role === "admin") {
          ensureSessionCanAccessSellerUsername(
            current,
            authSession,
            requestedSellerUsername
          );
        } else if (authSession.role === "master") {
          const existingSeller = findSellerByUsername(current, requestedSellerUsername);

          if (!existingSeller) {
            throw new ValidationError("Seller not found");
          }
        }

        const ticketPayload = prepareTicketCreatePayload(
          authSession.role === "seller"
            ? {
                ...body,
                sellerUsername: authSession.username,
              }
            : body
        );

        current.tickets.unshift(
          createTicket(ticketPayload)
        );
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        tickets: getScopedTickets(db, authSession),
      });
    }

    if (pathname.startsWith("/api/tickets/") && req.method === "PATCH") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const ticketId = extractId(pathname, "/api/tickets/");
      const body = await readJsonBody(req);

      const db = updateDb((current) => {
        const existingTicket = current.tickets.find(
          (ticket) => String(ticket.id) === ticketId
        );

        if (!existingTicket) {
          throw new Error("Ticket not found");
        }

        if (
          authSession.role === "seller" &&
          normalizeUsername(existingTicket.sellerUsername) !== normalizeUsername(authSession.username)
        ) {
          throw new ForbiddenError(FORBIDDEN_MESSAGE);
        }

        if (authSession.role === "admin") {
          ensureSessionCanAccessSellerUsername(
            current,
            authSession,
            existingTicket.sellerUsername
          );
        }

        const { sellerUsername: _sellerUsername, ...safeTicketBody } = body || {};
        const ticketPayload = prepareTicketUpdatePayload(
          existingTicket,
          safeTicketBody
        );

        current.tickets = current.tickets.map((ticket) =>
          String(ticket.id) === ticketId
            ? updateTicket(
                ticket,
                ticketPayload
              )
            : ticket
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        tickets: getScopedTickets(db, authSession),
      });
    }

    if (pathname === "/api/results" && req.method === "GET") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");

      let results = db.results;

      if (date) {
        results = results.filter((result) => result.date === date);
      }

      if (drawTime) {
        results = results.filter((result) => result.drawTime === drawTime);
      }

      return sendJson(res, 200, {
        ok: true,
        results,
      });
    }

    if (pathname === "/api/results" && req.method === "PUT") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const body = await readJsonBody(req);
      const result = {
        date: String(body.date || ""),
        drawTime: String(body.drawTime || ""),
        winningNumber: String(body.winningNumber || "").replace(/[^\d]/g, "").slice(0, 2),
        updatedAt: new Date().toISOString(),
      };

      if (!result.date || !result.drawTime || result.winningNumber.length !== 2) {
        return sendJson(res, 400, {
          ok: false,
          message: "date, drawTime and 2 digit winningNumber are required",
        });
      }

      const resultAvailability = getResultAvailability(result.date, result.drawTime);

      if (!resultAvailability.allowed) {
        return sendJson(res, 409, {
          ok: false,
          message:
            resultAvailability.message ||
            `Result for ${formatDrawLabel(result.drawTime)} opens after ${getResultReleaseValue(result.drawTime)} IST.`,
        });
      }

      const db = updateDb((current) => {
        const index = current.results.findIndex(
          (item) => item.date === result.date && item.drawTime === result.drawTime
        );

        if (index >= 0) {
          current.results[index] = result;
        } else {
          current.results.push(result);
        }

        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        results: db.results,
      });
    }

    if (pathname === "/api/results" && req.method === "DELETE") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const date = String(requestUrl.searchParams.get("date") || "");
      const drawTime = String(requestUrl.searchParams.get("drawTime") || "");

      if (!date || !drawTime) {
        return sendJson(res, 400, {
          ok: false,
          message: "date and drawTime are required",
        });
      }

      const db = updateDb((current) => {
        current.results = current.results.filter(
          (item) => !(item.date === date && item.drawTime === drawTime)
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        results: db.results,
      });
    }

    if (pathname === "/api/dashboard/overview" && req.method === "GET") {
      if (!ensureAnyRole(res, authSession, ["admin", "master"])) {
        return;
      }

      const db = getDb();
      const tickets = getScopedTickets(db, authSession);
      return sendJson(res, 200, {
        ok: true,
        overview: buildAdminOverview(tickets, db.results),
      });
    }

    if (pathname === "/api/dashboard/risk" && req.method === "GET") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");
      const tickets = getScopedTickets(db, authSession).filter((ticket) => {
        if (date && ticket.date !== date) {
          return false;
        }

        if (drawTime && ticket.drawTime !== drawTime) {
          return false;
        }

        return !ticket.cancelled;
      });

      return sendJson(res, 200, {
        ok: true,
        riskBoard: buildRiskBoard(tickets),
      });
    }

    if (pathname === "/api/reports/seller" && req.method === "GET") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const db = getDb();
      const requestedSellerUsername = requestUrl.searchParams.get("sellerUsername");
      const sellerUsername =
        authSession.role === "seller"
          ? authSession.username
          : requestedSellerUsername;
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");

      if (!sellerUsername) {
        return sendJson(res, 400, {
          ok: false,
          message: "sellerUsername is required",
        });
      }

      if (
        authSession.role === "seller" &&
        requestedSellerUsername &&
        normalizeUsername(requestedSellerUsername) !== normalizeUsername(authSession.username)
      ) {
        return sendJson(res, 403, {
          ok: false,
          message: FORBIDDEN_MESSAGE,
        });
      }

      const seller =
        authSession.role === "admin"
          ? ensureSessionCanAccessSellerUsername(db, authSession, sellerUsername)
          : findSellerByUsername(db, sellerUsername);

      const tickets = getScopedTickets(db, authSession).filter((ticket) => {
        if (
          normalizeUsername(ticket.sellerUsername) !== normalizeUsername(sellerUsername)
        ) {
          return false;
        }

        if (date && ticket.date !== date) {
          return false;
        }

        if (drawTime && drawTime !== "ALL" && ticket.drawTime !== drawTime) {
          return false;
        }

        return !ticket.cancelled;
      });

      return sendJson(res, 200, {
        ok: true,
        report: buildSellerReport(seller, tickets, db.results, {
          date,
          drawTime,
        }),
      });
    }

    if (pathname === "/api/reports/summary" && req.method === "GET") {
      if (!ensureAuthenticated(res, authSession)) {
        return;
      }

      const db = getDb();
      const range = String(requestUrl.searchParams.get("range") || "Daily");
      const today = String(requestUrl.searchParams.get("today") || "");
      const sellerUsername =
        authSession.role === "seller"
          ? authSession.username
          : String(requestUrl.searchParams.get("sellerUsername") || "");

      if (!today) {
        return sendJson(res, 400, {
          ok: false,
          message: "today is required",
        });
      }

      if (authSession.role === "admin" && sellerUsername) {
        ensureSessionCanAccessSellerUsername(db, authSession, sellerUsername);
      }

      return sendJson(res, 200, {
        ok: true,
        report: buildRangeReportMetrics(
          getScopedTickets(db, authSession),
          db.results,
          range,
          today,
          sellerUsername
        ),
      });
    }

    if (pathname === "/api/master/admins" && req.method === "GET") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        admins: getAdminAccounts(db).map(toPublicAdmin),
      });
    }

    if (pathname === "/api/master/admins" && req.method === "POST") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = sanitizeAdminPayload(body);
      validateAdminPayload(payload);

      const db = updateDb((current) => {
        const admins = getAdminAccounts(current);
        ensureUniqueAdminUsername(admins, payload.username);
        syncAdminAccounts(current, [
          ...admins,
          createAdmin(
            {
              ...payload,
              password: hashPassword(payload.password),
            },
            admins
          ),
        ]);
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        admin: toPublicAdmin(getAdminAccounts(db).slice(-1)[0]),
        admins: getAdminAccounts(db).map(toPublicAdmin),
      });
    }

    if (pathname.startsWith("/api/master/admins/") && req.method === "PATCH") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const adminId = extractId(pathname, "/api/master/admins/");
      const body = await readJsonBody(req);
      const payload = sanitizeAdminPayload(body, {
        partial: true,
      });

      const db = updateDb((current) => {
        const admins = getAdminAccounts(current);
        const adminIndex = admins.findIndex((admin) => String(admin.id) === adminId);

        if (adminIndex < 0) {
          throw new Error("Admin not found");
        }

        validateAdminUpdatePayload(payload);

        if (payload.username) {
          ensureUniqueAdminUsername(admins, payload.username, adminId);
        }

        const currentAdmin = admins[adminIndex];
        const nextAdmin = updateAdmin(currentAdmin, {
          ...payload,
          ...(payload.password ? { password: hashPassword(payload.password) } : {}),
        });

        syncAdminAccounts(
          current,
          admins.map((admin, index) => (index === adminIndex ? nextAdmin : admin))
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        admin: toPublicAdmin(findAdminAccountById(db, adminId)),
        admins: getAdminAccounts(db).map(toPublicAdmin),
      });
    }

    if (pathname === "/api/master/admin" && req.method === "GET") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        admin: toPublicAdmin(getPrimaryAdmin(db)),
        admins: getAdminAccounts(db).map(toPublicAdmin),
      });
    }

    if (pathname === "/api/master/admin" && req.method === "PATCH") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = sanitizeAdminPayload(body);
      validateAdminPayload(payload);

      const db = updateDb((current) => {
        const admins = getAdminAccounts(current);
        const primaryAdmin = admins[0] || normalizeAdmin(DEFAULT_DB.admin, 0);

        ensureUniqueAdminUsername(admins, payload.username, primaryAdmin.id);

        syncAdminAccounts(current, [
          updateAdmin(primaryAdmin, {
            ...payload,
            password: hashPassword(payload.password),
          }),
          ...admins.slice(1),
        ]);
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        admin: toPublicAdmin(getPrimaryAdmin(db)),
        admins: getAdminAccounts(db).map(toPublicAdmin),
      });
    }

    if (pathname === "/api/master/system/storage" && req.method === "GET") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const db = getDb();
      const storage = getStorageInfo();

      return sendJson(res, 200, {
        ok: true,
        storage: {
          ...storage,
          dbFile: path.basename(storage.dbFile),
          backupDbFile: path.basename(storage.backupDbFile),
          snapshotDir: path.basename(storage.snapshotDir),
          migrationSource: storage.migrationSource
            ? path.basename(storage.migrationSource)
            : "",
        },
        readiness: buildReadinessReport({
          db,
          storage,
          bodySizeLimitBytes: REQUEST_BODY_LIMIT_BYTES,
          sessionTtlHours: SESSION_TTL_HOURS,
          corsMode: CORS_ALLOWED_ORIGINS.length > 0 ? "custom" : "same-origin",
          shuttingDown,
        }),
      });
    }

    if (pathname === "/api/master/system/export" && req.method === "GET") {
      if (!ensureRole(res, authSession, "master")) {
        return;
      }

      const backupFileName = `lottery-backup-${formatExportTimestamp(new Date())}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${backupFileName}"`);

      return sendJson(res, 200, buildBackupExportPayload({
        db: getDb(),
        storage: getStorageInfo(),
      }));
    }

    if ((req.method === "GET" || req.method === "HEAD") && isStaticAssetPath(pathname)) {
      return serveStaticAsset(res, pathname, req.method);
    }

    if ((req.method === "GET" || req.method === "HEAD") && shouldServeAppShell(pathname)) {
      return serveIndexHtml(res, req.method);
    }

    return sendJson(res, 404, {
      ok: false,
      message: "Route not found",
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return sendJson(res, 403, {
        ok: false,
        message: error.message || FORBIDDEN_MESSAGE,
      });
    }

    if (error instanceof ConflictError) {
      return sendJson(res, 409, {
        ok: false,
        message: error.message,
      });
    }

    if (error instanceof ValidationError) {
      return sendJson(res, 400, {
        ok: false,
        message: error.message,
      });
    }

    if (error instanceof PayloadTooLargeError) {
      return sendJson(res, 413, {
        ok: false,
        message: error.message,
      });
    }

    if (
      error &&
      (
        error.message === "Ticket not found" ||
        error.message === "Seller not found" ||
        error.message === "Admin not found"
      )
    ) {
      return sendJson(res, 404, {
        ok: false,
        message: error.message,
      });
    }

    return sendJson(res, 500, {
      ok: false,
      message: error.message || "Server error",
    });
  }
});

migrateStoredCredentials();

server.listen(PORT, HOST, () => {
  const db = getDb();
  const storage = getStorageInfo();
  const readiness = buildReadinessReport({
    db,
    storage,
    bodySizeLimitBytes: REQUEST_BODY_LIMIT_BYTES,
    sessionTtlHours: SESSION_TTL_HOURS,
    corsMode: CORS_ALLOWED_ORIGINS.length > 0 ? "custom" : "same-origin",
    shuttingDown,
  });
  console.log(`Lottery backend running on http://localhost:${PORT}`);
  getNetworkAddresses().forEach((address) => {
    console.log(`Lottery backend running on http://${address}:${PORT}`);
  });
  console.log(`Data file: ${storage.dbFile}`);
  console.log(`Backup file: ${storage.backupDbFile}`);
  console.log(`Snapshot dir: ${storage.snapshotDir}`);
  console.log(`Request body limit: ${REQUEST_BODY_LIMIT_BYTES} bytes`);
  console.log(`Session TTL: ${SESSION_TTL_HOURS} hour(s)`);
  if (storage.migrationSource) {
    console.log(`Seeded persistent data from: ${storage.migrationSource}`);
  }
  if (storage.usingBundledStorage) {
    console.warn(
      "WARNING: data is being written inside the app folder. Redeploys can reset sellers, tickets, and results. Use DATA_DIR=/data or DB_FILE on a persistent disk."
    );
  } else {
    console.log("Persistent storage is active. Future code deploys will keep existing data.");
  }
  if (getMaintenanceState().enabled) {
    console.warn("Maintenance mode is active. The app will show an updating screen until it is turned off.");
  }
  readiness.warnings.forEach((warning) => {
    console.warn(`WARNING: ${warning.message}`);
  });
  console.log(`Loaded ${db.sellers.length} seller(s), ${db.tickets.length} ticket(s), ${db.results.length} result(s)`);
});

server.requestTimeout = 30 * 1000;
server.headersTimeout = 35 * 1000;
server.keepAliveTimeout = 30 * 1000;
server.on("clientError", (error, socket) => {
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch {}

  if (error) {
    console.error("Client connection error:", error.message || error);
  }
});

registerProcessHandlers();

function setSecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (isSecureRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function setCorsHeaders(req, res) {
  const allowedOrigin = resolveAllowedCorsOrigin(req);

  appendVaryHeader(res, "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }

  return allowedOrigin;
}

function sendJson(res, statusCode, payload) {
  const responsePayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? {
          ...payload,
          serverTime:
            payload.serverTime && typeof payload.serverTime === "object"
              ? payload.serverTime
              : buildServerTimeSnapshot(),
        }
      : payload;

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(responsePayload, null, 2));
}

function sendMaintenanceResponse(res, maintenanceState) {
  const payload = buildMaintenancePayload(maintenanceState);

  if (payload.retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(payload.retryAfterSeconds));
  }

  sendJson(res, MAINTENANCE_STATUS_CODE, {
    ok: false,
    maintenance: payload,
    message: payload.message,
  });
}

function buildMaintenancePayload(maintenanceState = {}) {
  const currentState =
    maintenanceState && typeof maintenanceState === "object"
      ? maintenanceState
      : getMaintenanceState();

  return {
    enabled: Boolean(currentState.enabled),
    title: String(currentState.title || "Updating Server"),
    message: String(
      currentState.message || "Updating server maintenance. Please wait a short time."
    ),
    completionMessage: String(
      currentState.completionMessage || "Refresh or reopen after update is complete."
    ),
    actionLabel: String(currentState.actionLabel || "Refresh"),
    retryAfterSeconds:
      Number(currentState.retryAfterSeconds) > 0 ? Number(currentState.retryAfterSeconds) : 30,
    updatedAt: String(currentState.updatedAt || ""),
    source: String(currentState.source || ""),
  };
}

function extractId(pathname, prefix) {
  return pathname.slice(prefix.length).split("/")[0];
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveRequestBodyLimitBytes(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 256 * 1024;
  }

  return Math.max(8 * 1024, Math.min(numericValue, 5 * 1024 * 1024));
}

function resolveSessionTtlHours(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 24;
  }

  return Math.max(1, Math.min(numericValue, 24 * 30));
}

function resolveAllowedCorsOrigin(req) {
  const origin = String(req.headers.origin || "").trim();

  if (!origin) {
    return "";
  }

  if (CORS_ALLOWED_ORIGINS.includes("*")) {
    return "*";
  }

  if (CORS_ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }

  if (isLocalDevelopmentOrigin(origin)) {
    return origin;
  }

  const requestOrigin = getRequestOrigin(req);

  if (requestOrigin && origin === requestOrigin) {
    return origin;
  }

  return "";
}

function isLocalDevelopmentOrigin(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(origin || ""));
}

function getRequestOrigin(req) {
  const protocol = getRequestProtocol(req);
  const hostHeader = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();

  if (!hostHeader) {
    return "";
  }

  return `${protocol}://${hostHeader}`;
}

function getRequestProtocol(req) {
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (forwardedProtocol === "http" || forwardedProtocol === "https") {
    return forwardedProtocol;
  }

  return isSecureRequest(req) ? "https" : "http";
}

function isSecureRequest(req) {
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProtocol === "https" || Boolean(req.socket && req.socket.encrypted);
}

function hasOriginHeader(req) {
  return Boolean(String(req.headers.origin || "").trim());
}

function isCorsPreflightRequest(req) {
  return req.method === "OPTIONS";
}

function appendVaryHeader(res, headerName) {
  const currentValue = String(res.getHeader("Vary") || "");
  const values = currentValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!values.includes(headerName)) {
    values.push(headerName);
  }

  if (values.length > 0) {
    res.setHeader("Vary", values.join(", "));
  }
}

function formatExportTimestamp(dateValue) {
  return new Date(dateValue || Date.now()).toISOString().replace(/[:.]/g, "-");
}

function migrateStoredCredentials() {
  const db = getDb();
  let hasChanges = false;
  const needsAdminCollectionMigration =
    !Array.isArray(db.admins) ||
    db.admins.length === 0 ||
    getAdminAccounts(db).some((admin) => !admin.id);

  const nextMaster = { ...db.master };
  const nextAdmins = getAdminAccounts(db).map((admin) => ({ ...admin }));
  const nextSellers = db.sellers.map((seller) => ({ ...seller }));

  if (nextMaster.password && !isPasswordHash(nextMaster.password)) {
    nextMaster.password = hashPassword(nextMaster.password);
    hasChanges = true;
  }

  nextAdmins.forEach((admin) => {
    if (admin.password && !isPasswordHash(admin.password)) {
      admin.password = hashPassword(admin.password);
      hasChanges = true;
    }
  });

  nextSellers.forEach((seller) => {
    if (seller.password && !isPasswordHash(seller.password)) {
      seller.password = hashPassword(seller.password);
      hasChanges = true;
    }
  });

  if (needsAdminCollectionMigration) {
    hasChanges = true;
  }

  if (!hasChanges) {
    return;
  }

  updateDb((current) => ({
    ...current,
    master: nextMaster,
    admin: nextAdmins[0] || normalizeAdmin(DEFAULT_DB.admin, 0),
    admins: nextAdmins,
    sellers: nextSellers,
  }));
}

function createStoredSession(payload) {
  let nextSessionPayload = null;

  updateDb((current) => {
    current.sessions = pruneExpiredSessions(current.sessions, {
      now: new Date(),
    });

    const createdSession = createSessionRecord(payload, {
      ttlMs: SESSION_TTL_MS,
    });
    current.sessions.push(createdSession.session);
    nextSessionPayload = toSessionPayload(createdSession.session, createdSession.token);
    return current;
  }, {
    skipBackup: true,
  });

  return nextSessionPayload;
}

function revokeStoredSession(token) {
  if (!String(token || "").trim()) {
    return;
  }

  updateDb((current) => {
    current.sessions = removeSessionByToken(current.sessions, token);
    return current;
  }, {
    skipBackup: true,
  });
}

function getAuthSession(req) {
  const authorization = String(req.headers.authorization || "");

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  const db = getDb();
  const session = findSessionByToken(db.sessions, token, {
    now: new Date(),
  });

  if (!session) {
    const expiredSessionCount = Array.isArray(db.sessions) ? db.sessions.length : 0;
    const activeSessionCount = pruneExpiredSessions(db.sessions, {
      now: new Date(),
    }).length;

    if (expiredSessionCount !== activeSessionCount) {
      updateDb((current) => {
        current.sessions = pruneExpiredSessions(current.sessions, {
          now: new Date(),
        });
        return current;
      }, {
        skipBackup: true,
      });
    }
    return null;
  }

  return {
    ...session,
    token,
  };
}

function ensureAuthenticated(res, session) {
  if (session) {
    return true;
  }

  sendJson(res, 401, {
    ok: false,
    message: AUTH_REQUIRED_MESSAGE,
  });
  return false;
}

function ensureRole(res, session, role) {
  if (!ensureAuthenticated(res, session)) {
    return false;
  }

  if (session.role === role) {
    return true;
  }

  sendJson(res, 403, {
    ok: false,
    message: FORBIDDEN_MESSAGE,
  });
  return false;
}

function getLoginAttemptKey(req, role, username) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const remoteAddress = forwardedFor || req.socket.remoteAddress || "local";

  return [
    remoteAddress,
    String(role || "unknown").toLowerCase(),
    normalizeUsername(username) || "unknown",
  ].join("|");
}

function getBlockedLoginUntil(loginKey) {
  clearExpiredLoginAttempts();
  const attemptState = loginAttempts.get(loginKey);

  if (!attemptState || !attemptState.blockedUntil) {
    return 0;
  }

  return attemptState.blockedUntil > Date.now() ? attemptState.blockedUntil : 0;
}

function recordFailedLogin(loginKey) {
  clearExpiredLoginAttempts();
  const now = Date.now();
  const currentState = loginAttempts.get(loginKey);
  const withinWindow =
    currentState && now - currentState.windowStartedAt <= LOGIN_ATTEMPT_WINDOW_MS;

  const nextState = {
    attempts: withinWindow ? currentState.attempts + 1 : 1,
    windowStartedAt: withinWindow ? currentState.windowStartedAt : now,
    blockedUntil: 0,
  };

  if (nextState.attempts >= LOGIN_ATTEMPT_LIMIT) {
    nextState.blockedUntil = now + LOGIN_ATTEMPT_BLOCK_MS;
  }

  loginAttempts.set(loginKey, nextState);
}

function clearLoginAttempts(loginKey) {
  loginAttempts.delete(loginKey);
}

function clearExpiredLoginAttempts() {
  const now = Date.now();

  loginAttempts.forEach((attemptState, loginKey) => {
    if (!attemptState) {
      loginAttempts.delete(loginKey);
      return;
    }

    const windowExpired = now - attemptState.windowStartedAt > LOGIN_ATTEMPT_WINDOW_MS;
    const blockExpired = !attemptState.blockedUntil || attemptState.blockedUntil <= now;

    if (windowExpired && blockExpired) {
      loginAttempts.delete(loginKey);
    }
  });
}

function ensureAnyRole(res, session, roles = []) {
  if (!ensureAuthenticated(res, session)) {
    return false;
  }

  if (roles.includes(session.role)) {
    return true;
  }

  sendJson(res, 403, {
    ok: false,
    message: FORBIDDEN_MESSAGE,
  });
  return false;
}

function getAdminAccounts(db = {}) {
  if (Array.isArray(db.admins) && db.admins.length > 0) {
    return db.admins;
  }

  if (db.admin) {
    return [normalizeAdmin(db.admin, 0)];
  }

  return [normalizeAdmin(DEFAULT_DB.admin, 0)];
}

function getPrimaryAdmin(db = {}) {
  return getAdminAccounts(db)[0] || normalizeAdmin(DEFAULT_DB.admin, 0);
}

function getPrimaryAdminId(db = {}) {
  const primaryAdmin = getPrimaryAdmin(db);
  return primaryAdmin ? primaryAdmin.id : null;
}

function syncAdminAccounts(current, admins = []) {
  const nextAdmins =
    Array.isArray(admins) && admins.length > 0
      ? admins.map((admin, index) => normalizeAdmin(admin, index))
      : [normalizeAdmin(DEFAULT_DB.admin, 0)];

  current.admins = nextAdmins;
  current.admin = nextAdmins[0];
  return current;
}

function findAdminAccountById(db = {}, adminId) {
  return getAdminAccounts(db).find((admin) => String(admin.id) === String(adminId)) || null;
}

function findAdminAccountByUsername(db = {}, username) {
  return (
    getAdminAccounts(db).find(
      (admin) => normalizeUsername(admin.username) === normalizeUsername(username)
    ) || null
  );
}

function findAdminAccountBySession(db = {}, session = {}) {
  return (
    findAdminAccountById(db, session.adminId) ||
    findAdminAccountByUsername(db, session.username) ||
    getPrimaryAdmin(db)
  );
}

function findSellerById(db = {}, sellerId) {
  return (
    (Array.isArray(db.sellers) ? db.sellers : []).find(
      (seller) => String(seller.id) === String(sellerId)
    ) || null
  );
}

function findSellerByUsername(db = {}, username) {
  return (
    (Array.isArray(db.sellers) ? db.sellers : []).find(
      (seller) =>
        normalizeUsername(seller.username) === normalizeUsername(username)
    ) || null
  );
}

function getScopedSellers(db = {}, session = null) {
  return getAccessibleSellers(db.sellers, session, {
    primaryAdminId: getPrimaryAdminId(db),
  });
}

function getScopedSellerUsernameSet(db = {}, session = null) {
  return getAccessibleSellerUsernameSet(db.sellers, session, {
    primaryAdminId: getPrimaryAdminId(db),
  });
}

function getScopedTickets(db = {}, session = null) {
  const tickets = Array.isArray(db.tickets) ? db.tickets : [];

  if (!session) {
    return [];
  }

  if (session.role === "seller") {
    return tickets.filter(
      (ticket) =>
        normalizeUsername(ticket.sellerUsername) === normalizeUsername(session.username)
    );
  }

  if (session.role === "admin") {
    const scopedSellerUsernames = getScopedSellerUsernameSet(db, session);

    return tickets.filter((ticket) =>
      scopedSellerUsernames.has(normalizeUsername(ticket.sellerUsername))
    );
  }

  return tickets;
}

function ensureSessionCanAccessSeller(db = {}, session = null, seller = null) {
  if (!seller) {
    throw new Error("Seller not found");
  }

  if (
    session &&
    session.role === "admin" &&
    !canSessionAccessSeller(seller, session, {
      primaryAdminId: getPrimaryAdminId(db),
    })
  ) {
    throw new ForbiddenError(FORBIDDEN_MESSAGE);
  }

  return seller;
}

function ensureSessionCanAccessSellerUsername(db = {}, session = null, sellerUsername = "") {
  const seller = findSellerByUsername(db, sellerUsername);

  if (!seller) {
    throw new ValidationError("Seller not found");
  }

  return ensureSessionCanAccessSeller(db, session, seller);
}

function toPublicAdmin(admin = {}) {
  return {
    id: admin.id,
    username: admin.username || "",
  };
}

function toPublicSeller(seller = {}) {
  return {
    id: seller.id,
    name: seller.name || "",
    mobile: seller.mobile || "",
    username: seller.username || "",
    active: seller.active !== undefined ? Boolean(seller.active) : true,
    singleCommission: Number(seller.singleCommission || 0),
    juriCommission: Number(seller.juriCommission || 0),
  };
}

class ForbiddenError extends Error {}
class ValidationError extends Error {}
class ConflictError extends Error {}
class PayloadTooLargeError extends Error {}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }

      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""));
      size += bufferChunk.length;

      if (size > REQUEST_BODY_LIMIT_BYTES) {
        settled = true;
        reject(
          new PayloadTooLargeError(
            `Request body is too large. Limit is ${REQUEST_BODY_LIMIT_BYTES} bytes.`
          )
        );

        try {
          req.destroy();
        } catch {}
        return;
      }

      raw += bufferChunk.toString("utf8");
    });

    req.on("end", () => {
      if (settled) {
        return;
      }

      settled = true;

      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });
  });
}

function prepareTicketCreatePayload(input = {}) {
  return applyTicketBookingCutoff({
    ...input,
    drawTime: normalizeDrawTime(input.drawTime),
  });
}

function prepareTicketUpdatePayload(existingTicket, input = {}) {
  if (!existingTicket) {
    throw new Error("Ticket not found");
  }

  if (existingTicket.cancelled) {
    throw new ValidationError("Cancelled ticket cannot be changed");
  }

  if (existingTicket.claimed && !isClaimOnlyTicketPatch(input)) {
    throw new ValidationError("Claimed ticket cannot be edited or cancelled");
  }

  if (!isClaimOnlyTicketPatch(input) && isTicketLocked(existingTicket)) {
    throw new ValidationError("Ticket is locked. Edit or cancel is allowed only before last entry time.");
  }

  if (isClaimOnlyTicketPatch(input)) {
    return {
      claimed: Boolean(input.claimed),
      payout: Number(input.payout || 0),
      winningNumber: String(input.winningNumber || "").replace(/[^\d]/g, "").slice(0, 2),
    };
  }

  return applyTicketBookingCutoff({
    ...input,
    drawTime: normalizeDrawTime(input.drawTime || existingTicket.drawTime),
    date: normalizeTicketDate(input.date || existingTicket.date),
  });
}

function applyTicketBookingCutoff(input = {}) {
  const drawTime = normalizeDrawTime(input.drawTime);
  const requestedDate = normalizeTicketDate(input.date);

  return {
    ...input,
    date: getNextValidTicketDate(requestedDate, drawTime),
    drawTime,
  };
}

function isClaimOnlyTicketPatch(input = {}) {
  const keys = Object.keys(input).filter((key) => input[key] !== undefined);

  if (!keys.length) {
    return false;
  }

  return keys.every((key) => ["claimed", "payout", "winningNumber"].includes(key));
}

function normalizeDrawTime(value) {
  const nextValue = String(value || "").trim();
  return nextValue || "11:00";
}

function normalizeTicketDate(value) {
  const nextValue = String(value || "").trim();
  return nextValue || getCurrentBusinessDate();
}

function sanitizeSellerPayload(input = {}, options = {}) {
  const partial = Boolean(options.partial);
  const payload = {};

  if (!partial || input.name !== undefined) {
    payload.name = String(input.name || "").trim();
  }

  if (!partial || input.mobile !== undefined) {
    payload.mobile = String(input.mobile || "").trim();
  }

  if (!partial || input.username !== undefined) {
    payload.username = String(input.username || "").trim();
  }

  if (!partial || input.password !== undefined) {
    payload.password = String(input.password || "").trim();
  }

  if (!partial || input.singleCommission !== undefined) {
    payload.singleCommission = sanitizePositiveNumber(input.singleCommission);
  }

  if (!partial || input.juriCommission !== undefined) {
    payload.juriCommission = sanitizePositiveNumber(input.juriCommission);
  }

  if (input.active !== undefined) {
    payload.active = Boolean(input.active);
  }

  return payload;
}

function validateRequiredSellerFields(payload = {}) {
  if (!payload.name || !payload.username || !payload.password) {
    throw new ValidationError("Name, username and password are required");
  }

  validateSellerCommissionFields(payload);
}

function validateSellerUpdatePayload(payload = {}) {
  if (payload.password !== undefined && !payload.password) {
    throw new ValidationError("Password is required");
  }

  if (payload.username !== undefined && !payload.username) {
    throw new ValidationError("Username is required");
  }

  if (payload.name !== undefined && !payload.name) {
    throw new ValidationError("Name is required");
  }

  validateSellerCommissionFields(payload);
}

function validateSellerCommissionFields(payload = {}) {
  if (
    payload.singleCommission !== undefined &&
    (!Number.isFinite(payload.singleCommission) || payload.singleCommission <= 0)
  ) {
    throw new ValidationError("Set valid single commission");
  }

  if (
    payload.juriCommission !== undefined &&
    (!Number.isFinite(payload.juriCommission) || payload.juriCommission <= 0)
  ) {
    throw new ValidationError("Set valid juri commission");
  }
}

function sanitizePositiveNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function sanitizeAdminPayload(input = {}, options = {}) {
  const partial = Boolean(options.partial);
  const payload = {};

  if (!partial || input.username !== undefined) {
    payload.username = String(input.username || "").trim();
  }

  if (!partial || input.password !== undefined) {
    payload.password = String(input.password || "").trim();
  }

  return payload;
}

function validateAdminPayload(payload = {}) {
  if (!payload.username || !payload.password) {
    throw new ValidationError("Admin username and password are required");
  }
}

function validateAdminUpdatePayload(payload = {}) {
  if (payload.username !== undefined && !payload.username) {
    throw new ValidationError("Admin username is required");
  }

  if (payload.password !== undefined && !payload.password) {
    throw new ValidationError("Admin password is required");
  }

  if (payload.username === undefined && payload.password === undefined) {
    throw new ValidationError("Change admin username or password");
  }
}

function sanitizePasswordChangePayload(input = {}) {
  return {
    currentPassword: String(input.currentPassword || "").trim(),
    newPassword: String(input.newPassword || "").trim(),
  };
}

function validatePasswordChangePayload(payload = {}) {
  if (!payload.currentPassword || !payload.newPassword) {
    throw new ValidationError("Current password and new password are required");
  }

  if (payload.newPassword.length < 4) {
    throw new ValidationError("New password must be at least 4 characters");
  }

  if (payload.currentPassword === payload.newPassword) {
    throw new ValidationError("Use a different new password");
  }
}

function ensureUniqueAdminUsername(admins = [], username, excludedId = null) {
  const exists = admins.some(
    (admin) =>
      normalizeUsername(admin.username) === normalizeUsername(username) &&
      String(admin.id) !== String(excludedId)
  );

  if (exists) {
    throw new ConflictError("Admin username already exists");
  }
}

function ensureUniqueSellerUsername(sellers = [], username, excludedId = null) {
  const normalizedUsername = normalizeUsername(username);

  const duplicate = sellers.find((seller) => {
    if (excludedId !== null && String(seller.id) === String(excludedId)) {
      return false;
    }

    return normalizeUsername(seller.username) === normalizedUsername;
  });

  if (duplicate) {
    throw new ConflictError("Username already exists");
  }
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      addresses.add(entry.address);
    });
  });

  return [...addresses];
}

function registerProcessHandlers() {
  process.once("SIGTERM", () => {
    startGracefulShutdown("SIGTERM");
  });

  process.once("SIGINT", () => {
    startGracefulShutdown("SIGINT");
  });

  process.once("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    startGracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error);
  });
}

function startGracefulShutdown(signalName) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Graceful shutdown started from ${signalName}.`);

  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out. Exiting forcefully.");
    process.exit(1);
  }, 10 * 1000);

  if (typeof forceExitTimer.unref === "function") {
    forceExitTimer.unref();
  }

  server.close(() => {
    clearTimeout(forceExitTimer);
    console.log("HTTP server stopped cleanly.");
    process.exit(0);
  });
}

function hasBuildIndex() {
  return fs.existsSync(path.join(BUILD_DIR, "index.html"));
}

function serveStaticAsset(res, pathname, method = "GET") {
  if (!hasBuildIndex()) {
    return sendJson(res, 404, {
      ok: false,
      message: "Frontend build not found",
    });
  }

  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");
  const filePath = path.resolve(BUILD_DIR, safeRelativePath);
  const insideBuildDirectory =
    filePath === BUILD_DIR || filePath.startsWith(`${BUILD_DIR}${path.sep}`);

  if (!insideBuildDirectory) {
    return sendJson(res, 400, {
      ok: false,
      message: "Invalid file path",
    });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, {
      ok: false,
      message: "File not found",
    });
  }

  const contentType = getContentType(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control":
      pathname.startsWith("/static/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function serveIndexHtml(res, method = "GET") {
  const filePath = path.join(BUILD_DIR, "index.html");

  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, {
      ok: false,
      message: "Frontend build not found",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".ico") {
    return "image/x-icon";
  }

  if (extension === ".txt") {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

if (typeof DEFAULT_DB !== "undefined") {
  void DEFAULT_DB;
}
