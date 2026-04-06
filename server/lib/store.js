const fs = require("fs");
const path = require("path");

const { DEFAULT_DB, normalizeSeller, normalizeTicket } = require("./models");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const CONFIGURED_DATA_DIR =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_DATA_DIR;
const CONFIGURED_DB_FILE = process.env.DB_FILE || path.join(CONFIGURED_DATA_DIR, "db.json");
const DB_FILE = resolveDbFilePath(CONFIGURED_DB_FILE);
const DATA_DIR = path.dirname(DB_FILE);

function ensureDbFile() {
  ensureDirectory(DATA_DIR);

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

function getDb() {
  ensureDbFile();

  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      admin: parsed.admin || DEFAULT_DB.admin,
      sellers: Array.isArray(parsed.sellers)
        ? parsed.sellers.map((seller, index) => normalizeSeller(seller, index))
        : DEFAULT_DB.sellers,
      tickets: Array.isArray(parsed.tickets)
        ? parsed.tickets.map((ticket, index) => normalizeTicket(ticket, index))
        : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      settings: parsed.settings || DEFAULT_DB.settings,
    };
  } catch {
    writeDb(DEFAULT_DB);
    return DEFAULT_DB;
  }
}

function writeDb(db) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  return db;
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
  return writeDb(next);
}

module.exports = {
  DB_FILE,
  getDb,
  updateDb,
  writeDb,
};
