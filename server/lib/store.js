const fs = require("fs");
const path = require("path");

const { DEFAULT_DB, normalizeSeller, normalizeTicket } = require("./models");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const CONFIGURED_DATA_DIR =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_DATA_DIR;
const CONFIGURED_DB_FILE = process.env.DB_FILE || path.join(CONFIGURED_DATA_DIR, "db.json");
const DB_FILE = resolveDbFilePath(CONFIGURED_DB_FILE);
const DATA_DIR = path.dirname(DB_FILE);
const DB_EXTENSION = path.extname(DB_FILE) || ".json";
const DB_BASENAME = DB_FILE.slice(0, -DB_EXTENSION.length);
const BACKUP_DB_FILE = `${DB_BASENAME}.backup${DB_EXTENSION}`;
const RECOVERY_DIR = path.join(DATA_DIR, "recovery");

function ensureDbFile() {
  ensureDirectory(DATA_DIR);

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(buildDbSnapshot(DEFAULT_DB), null, 2));
  }
}

function getDb() {
  ensureDbFile();

  try {
    return buildDbSnapshot(readDbFile(DB_FILE), DEFAULT_DB);
  } catch {
    preserveRecoveryCopy(DB_FILE);

    try {
      const backupDb = buildDbSnapshot(readDbFile(BACKUP_DB_FILE), DEFAULT_DB);
      writeDb(backupDb, DEFAULT_DB, { skipBackup: true });
      return backupDb;
    } catch {}

    const fallbackDb = buildDbSnapshot(DEFAULT_DB, DEFAULT_DB);
    writeDb(fallbackDb, DEFAULT_DB, { skipBackup: true });
    return fallbackDb;
  }
}

function writeDb(db, fallback = DEFAULT_DB, options = {}) {
  ensureDbFile();
  const snapshot = buildDbSnapshot(db, fallback);

  if (!options.skipBackup) {
    backupCurrentDbFile();
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function resolveDbFilePath(configuredPath) {
  try {
    if (fs.existsSync(configuredPath) && fs.statSync(configuredPath).isDirectory()) {
      return path.join(configuredPath, "db.json");
    }
  } catch {}

  return configuredPath;
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function updateDb(updater) {
  const current = getDb();
  const next = updater(current) || current;
  return writeDb(next, current);
}

function readDbFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function backupCurrentDbFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      fs.copyFileSync(DB_FILE, BACKUP_DB_FILE);
    }
  } catch {}
}

function preserveRecoveryCopy(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }

    ensureDirectory(RECOVERY_DIR);
    const recoveryFile = path.join(RECOVERY_DIR, `db.corrupt.${Date.now()}${DB_EXTENSION}`);
    fs.copyFileSync(filePath, recoveryFile);
  } catch {}
}

function buildDbSnapshot(input = {}, fallback = DEFAULT_DB) {
  const source = isPlainObject(input) ? input : {};
  const base = isPlainObject(fallback) ? fallback : DEFAULT_DB;

  return {
    ...base,
    ...source,
    master: mergeCredentials(source.master, base.master, DEFAULT_DB.master),
    admin: mergeCredentials(source.admin, base.admin, DEFAULT_DB.admin),
    sellers: normalizeSellerList(source.sellers, base.sellers),
    tickets: normalizeTicketList(source.tickets, base.tickets),
    results: Array.isArray(source.results)
      ? source.results
      : Array.isArray(base.results)
        ? base.results
        : [],
    settings: mergeSettings(source.settings, base.settings, DEFAULT_DB.settings),
  };
}

function normalizeSellerList(list, fallback = []) {
  const source = Array.isArray(list) ? list : Array.isArray(fallback) ? fallback : [];
  return source.map((seller, index) => normalizeSeller(seller, index));
}

function normalizeTicketList(list, fallback = []) {
  const source = Array.isArray(list) ? list : Array.isArray(fallback) ? fallback : [];
  return source.map((ticket, index) => normalizeTicket(ticket, index));
}

function mergeCredentials(input, fallback, defaults) {
  return {
    ...(isPlainObject(defaults) ? defaults : {}),
    ...(isPlainObject(fallback) ? fallback : {}),
    ...(isPlainObject(input) ? input : {}),
  };
}

function mergeSettings(input, fallback, defaults) {
  const defaultSettings = isPlainObject(defaults) ? defaults : {};
  const fallbackSettings = isPlainObject(fallback) ? fallback : {};
  const inputSettings = isPlainObject(input) ? input : {};

  return {
    ...defaultSettings,
    ...fallbackSettings,
    ...inputSettings,
    commission: {
      ...(isPlainObject(defaultSettings.commission) ? defaultSettings.commission : {}),
      ...(isPlainObject(fallbackSettings.commission) ? fallbackSettings.commission : {}),
      ...(isPlainObject(inputSettings.commission) ? inputSettings.commission : {}),
    },
    rates: {
      ...(isPlainObject(defaultSettings.rates) ? defaultSettings.rates : {}),
      ...(isPlainObject(fallbackSettings.rates) ? fallbackSettings.rates : {}),
      ...(isPlainObject(inputSettings.rates) ? inputSettings.rates : {}),
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  BACKUP_DB_FILE,
  DB_FILE,
  getDb,
  updateDb,
  writeDb,
};
