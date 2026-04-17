const { DEFAULT_DB } = require("./models");
const { verifyPassword } = require("./passwords");

function buildReadinessReport({
  db = {},
  storage = {},
  bodySizeLimitBytes = 0,
  sessionTtlHours = 24,
  corsMode = "same-origin",
  shuttingDown = false,
} = {}) {
  const checks = {
    persistentStorage: buildCheck(
      storage.usingExternalStorage === true,
      storage.usingExternalStorage
        ? "Persistent storage is active, so sellers, tickets, and results survive deploys."
        : "Data is still inside the app folder. Redeploys can reset sellers, tickets, and results."
    ),
    writableStorage: buildCheck(
      storage.writable !== false,
      storage.writable === false
        ? "The configured data directory is not writable."
        : "The configured data directory is writable."
    ),
    defaultMasterCredentials: buildCheck(
      !matchesDefaultCredentials(db.master, DEFAULT_DB.master),
      matchesDefaultCredentials(db.master, DEFAULT_DB.master)
        ? "Master account is still using the default credentials."
        : "Master account credentials are customized."
    ),
    defaultAdminCredentials: buildCheck(
      !hasDefaultAdminCredentials(db),
      hasDefaultAdminCredentials(db)
        ? "At least one admin account is still using the default credentials."
        : "Admin account credentials are customized."
    ),
    defaultSellerCredentials: buildCheck(
      !hasDefaultSellerCredentials(db),
      hasDefaultSellerCredentials(db)
        ? "At least one seller account is still using the default seed credentials."
        : "Seller seed credentials are customized."
    ),
    sessionPersistence: buildCheck(
      true,
      `Sessions are stored in the database and stay valid across restarts for ${sessionTtlHours} hour(s).`
    ),
    requestLimit: buildCheck(
      Number(bodySizeLimitBytes) > 0,
      Number(bodySizeLimitBytes) > 0
        ? `JSON request body limit is ${formatBytes(bodySizeLimitBytes)}.`
        : "JSON request body limit is not configured."
    ),
    cors: buildCheck(
      true,
      corsMode === "custom"
        ? "CORS is restricted to configured origins."
        : "CORS is limited to same-origin traffic plus localhost development origins."
    ),
    shutdown: buildCheck(
      !shuttingDown,
      shuttingDown
        ? "Server is shutting down and should stop receiving new traffic."
        : "Server is accepting traffic."
    ),
  };

  const warnings = Object.entries(checks)
    .filter(([, value]) => !value.ok)
    .map(([key, value]) => ({
      key,
      message: value.message,
    }));

  return {
    ok: warnings.length === 0,
    status: warnings.length === 0 ? "ready" : "warning",
    warnings,
    checks,
  };
}

function buildBackupExportPayload({ db = {}, storage = {} } = {}, options = {}) {
  const exportedAt = toIsoString(options.now);
  const metadata = db && db.meta && typeof db.meta === "object" ? db.meta : {};
  const schemaVersion =
    Number(metadata.schemaVersion) > 0
      ? Number(metadata.schemaVersion)
      : Number(DEFAULT_DB.meta && DEFAULT_DB.meta.schemaVersion) || 1;

  return {
    format: "lottery-app-backup",
    exportedAt,
    schemaVersion,
    storage: {
      usingExternalStorage: Boolean(storage.usingExternalStorage),
      initializationMode: String(storage.initializationMode || ""),
      migrationSource: String(storage.migrationSource || ""),
    },
    db: {
      ...db,
      sessions: [],
      meta: {
        ...metadata,
        schemaVersion,
        exportedAt,
      },
    },
  };
}

function toPublicReadinessReport(report = {}) {
  const safeChecks = {};
  let hasHiddenSecurityWarning = false;

  Object.entries(report.checks || {}).forEach(([key, value]) => {
    if (
      key === "defaultMasterCredentials" ||
      key === "defaultAdminCredentials" ||
      key === "defaultSellerCredentials"
    ) {
      if (value && value.ok === false) {
        hasHiddenSecurityWarning = true;
      }
      return;
    }

    safeChecks[key] = value;
  });

  const warnings = Object.entries(safeChecks)
    .filter(([, value]) => value && value.ok === false)
    .map(([key, value]) => ({
      key,
      message: value.message,
    }));

  if (hasHiddenSecurityWarning) {
    warnings.push({
      key: "security",
      message: "Security configuration still needs attention before full production rollout.",
    });
  }

  return {
    ok: warnings.length === 0,
    status: warnings.length === 0 ? "ready" : "warning",
    warnings,
    checks: safeChecks,
  };
}

function hasDefaultAdminCredentials(db = {}) {
  const admins =
    Array.isArray(db.admins) && db.admins.length > 0
      ? db.admins
      : db.admin
        ? [db.admin]
        : [];

  return admins.some((admin) => matchesDefaultCredentials(admin, DEFAULT_DB.admin));
}

function hasDefaultSellerCredentials(db = {}) {
  const sellers = Array.isArray(db.sellers) ? db.sellers : [];
  const defaultSeller = Array.isArray(DEFAULT_DB.sellers) ? DEFAULT_DB.sellers[0] : null;

  if (!defaultSeller) {
    return false;
  }

  return sellers.some((seller) => matchesDefaultCredentials(seller, defaultSeller));
}

function matchesDefaultCredentials(account = {}, defaults = {}) {
  const accountUsername = String(account.username || "").trim();
  const defaultUsername = String(defaults.username || "").trim();

  if (!accountUsername || !defaultUsername || accountUsername !== defaultUsername) {
    return false;
  }

  return verifyPassword(defaults.password, account.password);
}

function buildCheck(ok, message) {
  return {
    ok: Boolean(ok),
    message: String(message || ""),
  };
}

function formatBytes(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function toIsoString(value) {
  const nextDate = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(nextDate.getTime()) ? new Date().toISOString() : nextDate.toISOString();
}

module.exports = {
  buildBackupExportPayload,
  buildReadinessReport,
  hasDefaultAdminCredentials,
  hasDefaultSellerCredentials,
  matchesDefaultCredentials,
  toPublicReadinessReport,
};
