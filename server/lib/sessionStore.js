const crypto = require("crypto");

const { normalizeUsername } = require("./access");

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function createSessionRecord(payload = {}, options = {}) {
  const now = toDate(options.now);
  const ttlMs = resolveSessionTtlMs(options.ttlMs);
  const token = crypto.randomBytes(32).toString("hex");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  return {
    token,
    session: normalizeSessionRecord({
      ...payload,
      tokenHash: hashSessionToken(token),
      createdAt,
      expiresAt,
      lastSeenAt: createdAt,
    }),
  };
}

function normalizeSessionRecord(input = {}) {
  return {
    tokenHash: String(input.tokenHash || ""),
    role: normalizeRole(input.role),
    username: String(input.username || "").trim(),
    adminId: normalizeOptionalValue(input.adminId),
    sellerId: normalizeOptionalValue(input.sellerId),
    sellerName: String(input.sellerName || "").trim(),
    createdAt: normalizeIsoString(input.createdAt),
    expiresAt: normalizeIsoString(input.expiresAt),
    lastSeenAt: normalizeIsoString(input.lastSeenAt),
  };
}

function normalizeSessionList(list = [], options = {}) {
  const sessions = Array.isArray(list) ? list : [];
  const normalizedSessions = sessions
    .map((session) => normalizeSessionRecord(session))
    .filter((session) => session.tokenHash && session.role && session.expiresAt);

  if (!options.pruneExpired) {
    return normalizedSessions;
  }

  return normalizedSessions.filter((session) => !isSessionExpired(session, options.now));
}

function pruneExpiredSessions(list = [], options = {}) {
  return normalizeSessionList(list, {
    ...options,
    pruneExpired: true,
  });
}

function findSessionByToken(list = [], token, options = {}) {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    return null;
  }

  const tokenHash = hashSessionToken(normalizedToken);

  return (
    pruneExpiredSessions(list, options).find((session) => session.tokenHash === tokenHash) || null
  );
}

function removeSessionByToken(list = [], token) {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    return normalizeSessionList(list);
  }

  const tokenHash = hashSessionToken(normalizedToken);
  return normalizeSessionList(list).filter((session) => session.tokenHash !== tokenHash);
}

function removeSessionsForAccount(list = [], account = {}) {
  return normalizeSessionList(list).filter((session) => !sessionMatchesAccount(session, account));
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function isSessionExpired(session = {}, now = new Date()) {
  const expiresAtValue = Date.parse(String(session.expiresAt || ""));

  if (!Number.isFinite(expiresAtValue)) {
    return true;
  }

  return expiresAtValue <= toDate(now).getTime();
}

function toSessionPayload(session = {}, token = "") {
  return {
    role: session.role,
    username: session.username,
    adminId: session.adminId,
    sellerId: session.sellerId,
    sellerName: session.sellerName,
    token: String(token || ""),
    expiresAt: session.expiresAt,
  };
}

function sessionMatchesAccount(session = {}, account = {}) {
  const normalizedSession = normalizeSessionRecord(session);
  const role = normalizeRole(account.role);

  if (!role || normalizedSession.role !== role) {
    return false;
  }

  if (role === "seller") {
    if (
      normalizedSession.sellerId !== null &&
      normalizeOptionalValue(account.sellerId) !== null
    ) {
      return String(normalizedSession.sellerId) === String(account.sellerId);
    }

    return (
      normalizeUsername(normalizedSession.username) === normalizeUsername(account.username)
    );
  }

  if (role === "admin") {
    if (normalizedSession.adminId !== null && normalizeOptionalValue(account.adminId) !== null) {
      return String(normalizedSession.adminId) === String(account.adminId);
    }

    return (
      normalizeUsername(normalizedSession.username) === normalizeUsername(account.username)
    );
  }

  return normalizeUsername(normalizedSession.username) === normalizeUsername(account.username);
}

function resolveSessionTtlMs(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : DEFAULT_SESSION_TTL_MS;
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role || "";
}

function normalizeOptionalValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return value;
}

function normalizeIsoString(value) {
  const nextValue = String(value || "").trim();
  return nextValue || "";
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const nextDate = new Date(value || Date.now());
  return Number.isNaN(nextDate.getTime()) ? new Date() : nextDate;
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  createSessionRecord,
  findSessionByToken,
  hashSessionToken,
  isSessionExpired,
  normalizeSessionList,
  pruneExpiredSessions,
  removeSessionByToken,
  removeSessionsForAccount,
  sessionMatchesAccount,
  toSessionPayload,
};
