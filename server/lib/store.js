const fs = require("fs");
const path = require("path");

const { DEFAULT_DB, normalizeSeller, normalizeTicket } = require("./models");

const APP_ROOT = path.join(__dirname, "..", "..");
const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_DB_FILE = path.join(DEFAULT_DATA_DIR, "db.json");
const DEFAULT_BACKUP_DB_FILE = path.join(DEFAULT_DATA_DIR, "db.backup.json");
const SNAPSHOT_LIMIT = Math.max(3, Number(process.env.DB_SNAPSHOT_LIMIT || 20));
const CONFIGURED_DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.RENDER_DISK_PATH ||
  process.env.FLY_VOLUME_DIR ||
  process.env.VOLUME_PATH ||
  detectMountedDataDir() ||
  DEFAULT_DATA_DIR;
const CONFIGURED_DB_FILE = process.env.DB_FILE || path.join(CONFIGURED_DATA_DIR, "db.json");
const DB_FILE = resolveDbFilePath(CONFIGURED_DB_FILE);
const DATA_DIR = path.dirname(DB_FILE);
const DB_EXTENSION = path.extname(DB_FILE) || ".json";
const DB_BASENAME = DB_FILE.slice(0, -DB_EXTENSION.length);
const BACKUP_DB_FILE = `${DB_BASENAME}.backup${DB_EXTENSION}`;
const RECOVERY_DIR = path.join(DATA_DIR, "recovery");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const storeRuntime = {
  initialized: false,
  migrationSource: "",
  initializationMode: "existing",
};

function ensureDbFile() {
  ensureDirectory(DATA_DIR);

  if (fs.existsSync(DB_FILE)) {
    if (!storeRuntime.initialized) {
      markRuntimeInitialized("existing");
    }
    return;
  }

  const migratedFrom = migrateLegacyDbIfNeeded();

  if (migratedFrom) {
    storeRuntime.migrationSource = migratedFrom;
    markRuntimeInitialized("migrated");
    return;
  }

  writeJsonFileAtomic(DB_FILE, buildDbSnapshot(DEFAULT_DB));
  markRuntimeInitialized("default");
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

  writeJsonFileAtomic(DB_FILE, snapshot);
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

function detectMountedDataDir() {
  const candidates = ["/data"];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {}
  }

  return "";
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
    if (!fs.existsSync(DB_FILE)) {
      return;
    }

    fs.copyFileSync(DB_FILE, BACKUP_DB_FILE);
    createSnapshotCopy(DB_FILE);
  } catch {}
}

function createSnapshotCopy(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }

    ensureDirectory(SNAPSHOT_DIR);
    const snapshotName = `db.${formatSnapshotTimestamp(new Date())}${DB_EXTENSION}`;
    const snapshotPath = path.join(SNAPSHOT_DIR, snapshotName);
    fs.copyFileSync(filePath, snapshotPath);
    pruneSnapshotCopies();
  } catch {}
}

function pruneSnapshotCopies() {
  try {
    const snapshotFiles = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter((fileName) => fileName.endsWith(DB_EXTENSION))
      .sort((left, right) => right.localeCompare(left));

    snapshotFiles.slice(SNAPSHOT_LIMIT).forEach((fileName) => {
      try {
        fs.unlinkSync(path.join(SNAPSHOT_DIR, fileName));
      } catch {}
    });
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

function writeJsonFileAtomic(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  const tempFilePath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(tempFilePath, JSON.stringify(payload, null, 2));
    fs.renameSync(tempFilePath, filePath);
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {}
  }
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

function migrateLegacyDbIfNeeded() {
  const seedSource = findBestSeedSource();

  if (!seedSource) {
    return "";
  }

  const snapshot = buildDbSnapshot(readDbFile(seedSource), DEFAULT_DB);
  writeJsonFileAtomic(DB_FILE, snapshot);
  createSnapshotCopy(DB_FILE);
  return seedSource;
}

function findBestSeedSource() {
  const uniqueCandidates = Array.from(
    new Set(
      [
        process.env.LEGACY_DB_FILE,
        process.env.LEGACY_DB_BACKUP_FILE,
        BACKUP_DB_FILE,
        DEFAULT_DB_FILE,
        DEFAULT_BACKUP_DB_FILE,
      ].filter(Boolean)
    )
  );
  const targetPath = path.resolve(DB_FILE);
  const validSources = [];

  uniqueCandidates.forEach((candidatePath) => {
    const resolvedPath = path.resolve(candidatePath);

    if (resolvedPath === targetPath || !fs.existsSync(resolvedPath)) {
      return;
    }

    try {
      const snapshot = buildDbSnapshot(readDbFile(resolvedPath), DEFAULT_DB);
      validSources.push({
        filePath: resolvedPath,
        score: scoreDbSnapshot(snapshot),
      });
    } catch {}
  });

  if (validSources.length === 0) {
    return "";
  }

  validSources.sort((left, right) => right.score - left.score);
  return validSources[0].filePath;
}

function scoreDbSnapshot(snapshot) {
  const sellers = Array.isArray(snapshot && snapshot.sellers) ? snapshot.sellers : [];
  const tickets = Array.isArray(snapshot && snapshot.tickets) ? snapshot.tickets : [];
  const results = Array.isArray(snapshot && snapshot.results) ? snapshot.results : [];
  const activeSellerCount = sellers.filter((seller) => seller && seller.active !== false).length;
  const customSellerCount = sellers.filter(
    (seller) =>
      seller &&
      seller.username &&
      !DEFAULT_DB.sellers.some((defaultSeller) => defaultSeller.username === seller.username)
  ).length;
  const customAdmin =
    snapshot &&
    snapshot.admin &&
    snapshot.admin.username &&
    snapshot.admin.username !== DEFAULT_DB.admin.username
      ? 2
      : 0;
  const customMaster =
    snapshot &&
    snapshot.master &&
    snapshot.master.username &&
    snapshot.master.username !== DEFAULT_DB.master.username
      ? 2
      : 0;

  return (
    sellers.length * 10 +
    activeSellerCount * 4 +
    customSellerCount * 12 +
    tickets.length * 3 +
    results.length * 2 +
    customAdmin +
    customMaster
  );
}

function formatSnapshotTimestamp(dateValue) {
  return dateValue.toISOString().replace(/[:.]/g, "-");
}

function markRuntimeInitialized(mode) {
  storeRuntime.initialized = true;
  if (!storeRuntime.initializationMode || storeRuntime.initializationMode === "existing") {
    storeRuntime.initializationMode = mode;
    return;
  }

  if (mode !== "existing") {
    storeRuntime.initializationMode = mode;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStorageInfo() {
  ensureDbFile();

  const resolvedAppRoot = path.resolve(APP_ROOT);
  const resolvedDbFile = path.resolve(DB_FILE);
  const insideAppBundle =
    resolvedDbFile === resolvedAppRoot || resolvedDbFile.startsWith(`${resolvedAppRoot}${path.sep}`);

  return {
    appRoot: APP_ROOT,
    dataDir: DATA_DIR,
    dbFile: DB_FILE,
    backupDbFile: BACKUP_DB_FILE,
    snapshotDir: SNAPSHOT_DIR,
    usingBundledStorage: insideAppBundle,
    usingExternalStorage: !insideAppBundle,
    initializationMode: storeRuntime.initializationMode,
    migrationSource: storeRuntime.migrationSource,
    snapshotLimit: SNAPSHOT_LIMIT,
  };
}

module.exports = {
  BACKUP_DB_FILE,
  DATA_DIR,
  DB_FILE,
  DEFAULT_DATA_DIR,
  getDb,
  getStorageInfo,
  updateDb,
  writeDb,
};
