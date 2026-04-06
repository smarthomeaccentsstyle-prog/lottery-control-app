const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const {
  createSeller,
  createTicket,
  DEFAULT_DB,
  normalizeSeller,
  normalizeTicket,
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
  getDb,
  updateDb,
} = require("./lib/store");

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const BUILD_DIR = path.join(__dirname, "..", "build");
const STATIC_DIR = path.join(BUILD_DIR, "static");
const activeSessions = new Map();
const AUTH_REQUIRED_MESSAGE = "Session expired. Please login again.";
const FORBIDDEN_MESSAGE = "You do not have permission for this action.";

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;
  const authSession = getAuthSession(req);

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "lottery-control-backend",
        time: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const db = getDb();
      const role = String(body.role || "").toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();

      if (role === "admin") {
        if (
          username === db.admin.username &&
          password === db.admin.password
        ) {
          const session = createSession({
            role: "admin",
            username: db.admin.username,
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
            item.password === password
        );

        if (seller) {
          const session = createSession({
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
        session: toSessionPayload(authSession),
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      if (authSession && authSession.token) {
        activeSessions.delete(authSession.token);
      }

      return sendJson(res, 200, {
        ok: true,
      });
    }

    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers.map(toPublicSeller),
        settings: db.settings,
      });
    }

    if (pathname === "/api/sellers" && req.method === "GET") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers,
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
            active: payload.active !== undefined ? payload.active : true,
          }, current.sellers)
        );
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        sellers: db.sellers,
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
        const existingSeller = current.sellers.find(
          (seller) => String(seller.id) === sellerId
        );

        if (!existingSeller) {
          throw new Error("Seller not found");
        }

        validateSellerUpdatePayload(payload);

        if (payload.username) {
          ensureUniqueSellerUsername(current.sellers, payload.username, sellerId);
        }

        current.sellers = current.sellers.map((seller) =>
          String(seller.id) === sellerId ? updateSeller(seller, payload) : seller
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers,
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

      let tickets = db.tickets;

      if (date) {
        tickets = tickets.filter((ticket) => ticket.date === date);
      }

      if (drawTime) {
        tickets = tickets.filter((ticket) => ticket.drawTime === drawTime);
      }

      if (authSession.role === "seller") {
        tickets = tickets.filter(
          (ticket) =>
            normalizeUsername(ticket.sellerUsername) === normalizeUsername(authSession.username)
        );
      } else if (sellerUsername) {
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
        current.tickets.unshift(
          createTicket(
            authSession.role === "seller"
              ? {
                  ...body,
                  sellerUsername: authSession.username,
                }
              : body
          )
        );
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        tickets: db.tickets,
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

        current.tickets = current.tickets.map((ticket) =>
          String(ticket.id) === ticketId
            ? updateTicket(
                ticket,
                authSession.role === "seller"
                  ? {
                      ...body,
                      sellerUsername: ticket.sellerUsername,
                    }
                  : body
              )
            : ticket
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        tickets: db.tickets,
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
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        overview: buildAdminOverview(db.tickets, db.results),
      });
    }

    if (pathname === "/api/dashboard/risk" && req.method === "GET") {
      if (!ensureRole(res, authSession, "admin")) {
        return;
      }

      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");
      const tickets = db.tickets.filter((ticket) => {
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

      const seller = db.sellers.find(
        (item) => normalizeUsername(item.username) === normalizeUsername(sellerUsername)
      );

      const tickets = db.tickets.filter((ticket) => {
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

      return sendJson(res, 200, {
        ok: true,
        report: buildRangeReportMetrics(db.tickets, db.results, range, today, sellerUsername),
      });
    }

    if ((req.method === "GET" || req.method === "HEAD") && shouldServeStatic(pathname)) {
      return serveStaticAsset(res, pathname, req.method);
    }

    if ((req.method === "GET" || req.method === "HEAD") && hasBuildIndex()) {
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

    if (
      error &&
      (error.message === "Ticket not found" || error.message === "Seller not found")
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

server.listen(PORT, HOST, () => {
  const db = getDb();
  console.log(`Lottery backend running on http://localhost:${PORT}`);
  getNetworkAddresses().forEach((address) => {
    console.log(`Lottery backend running on http://${address}:${PORT}`);
  });
  console.log(`Loaded ${db.sellers.length} seller(s), ${db.tickets.length} ticket(s), ${db.results.length} result(s)`);
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function extractId(pathname, prefix) {
  return pathname.slice(prefix.length).split("/")[0];
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function createSession(payload) {
  const session = {
    ...payload,
    token: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
  };

  activeSessions.set(session.token, session);
  return toSessionPayload(session);
}

function toSessionPayload(session = {}) {
  return {
    role: session.role,
    username: session.username,
    sellerId: session.sellerId,
    sellerName: session.sellerName,
    token: session.token,
  };
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

  const session = activeSessions.get(token);

  if (!session) {
    return null;
  }

  return session;
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
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

    req.on("error", reject);
  });
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

function hasBuildIndex() {
  return fs.existsSync(path.join(BUILD_DIR, "index.html"));
}

function shouldServeStatic(pathname) {
  return pathname === "/" || pathname.startsWith("/static/") || pathname.endsWith(".json") || pathname.endsWith(".ico") || pathname.endsWith(".png") || pathname.endsWith(".svg") || pathname.endsWith(".txt") || pathname.endsWith(".js") || pathname.endsWith(".css");
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
  const filePath = path.join(BUILD_DIR, safeRelativePath);

  if (!filePath.startsWith(BUILD_DIR)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Invalid file path",
    });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (pathname === "/") {
      return serveIndexHtml(res);
    }

    return sendJson(res, 404, {
      ok: false,
      message: "File not found",
    });
  }

  const contentType = getContentType(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
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
