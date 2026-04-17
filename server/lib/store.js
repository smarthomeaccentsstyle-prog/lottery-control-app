const fs = require("fs");
const path = require("path");

const {
  DEFAULT_DB,
  DB_SCHEMA_VERSION,
  normalizeAdmin,
  normalizeSeller,
  normalizeTicket,
} = require("./models");
const { getSellerOwnerAdminId } = require("./access");
const { normalizeSessionList } = require("./sessionStore");

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

  writeJsonFileAtomic(DB_FILE, finalizeDbSnapshot(DEFAULT_DB, DEFAULT_DB));
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
  const snapshot = finalizeDbSnapshot(buildDbSnapshot(db, fallback), fallback);

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
    fs.mkdirSync(directoryPath, {
      recursive: true,
      mode: 0o700,
    });
  }
}

function updateDb(updater, options = {}) {
  const current = getDb();
  const next = updater(current) || current;
  return writeDb(next, current, options);
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
  const serializedPayload = JSON.stringify(payload, null, 2);
  let fileDescriptor = null;

  try {
    fileDescriptor = fs.openSync(tempFilePath, "w", 0o600);
    fs.writeFileSync(fileDescriptor, serializedPayload, "utf8");
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = null;
    fs.renameSync(tempFilePath, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (fileDescriptor !== null) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {}
    }

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
  const legacyAdmin = mergeCredentials(source.admin, base.admin, DEFAULT_DB.admin);
  const sourceAdmins =
    Array.isArray(source.admins) && source.admins.length > 0
      ? source.admins
      : isPlainObject(source.admin)
        ? [legacyAdmin]
        : base.admins;
  const admins = normalizeAdminList(sourceAdmins, base.admins, legacyAdmin);
  const primaryAdmin = admins[0] || normalizeAdmin(legacyAdmin, 0);

  return {
    ...base,
    ...source,
    master: mergeCredentials(source.master, base.master, DEFAULT_DB.master),
    admin: primaryAdmin,
    admins,
    sellers: normalizeSellerList(source.sellers, base.sellers, primaryAdmin),
    sessions: normalizeSessionList(source.sessions, {
      pruneExpired: false,
    }),
    tickets: normalizeTicketList(source.tickets, base.tickets),
    results: Array.isArray(source.results)
      ? source.results
      : Array.isArray(base.results)
        ? base.results
        : [],
    settings: mergeSettings(source.settings, base.settings, DEFAULT_DB.settings),
    meta: normalizeDbMeta(source.meta, base.meta, DEFAULT_DB.meta),
  };
}

function normalizeAdminList(list, fallback = [], legacyAdmin = DEFAULT_DB.admin) {
  const source = Array.isArray(list) && list.length > 0 ? list : [];
  const fallbackList = Array.isArray(fallback) && fallback.length > 0 ? fallback : [];
  const input = source.length > 0 ? source : fallbackList;

  return (input.length > 0 ? input : [legacyAdmin]).map((admin, index) =>
    normalizeAdmin(admin, index)
  );
}

function normalizeSellerList(list, fallback = [], primaryAdmin = null) {
  const source = Array.isArray(list) ? list : Array.isArray(fallback) ? fallback : [];
  const primaryAdminId = primaryAdmin ? primaryAdmin.id : null;

  return source.map((seller, index) => {
    const normalizedSellerInput =
      seller && typeof seller === "object"
        ? {
            ...seller,
            ownerAdminId: getSellerOwnerAdminId(seller, primaryAdminId),
          }
        : seller;

    return normalizeSeller(normalizedSellerInput, index);
  });
}

function normalizeTicketList(list, fallback = []) {
  const source = Array.isArray(list) ? list : Array.isArray(fallback) ? fallback : [];
  return source.map((ticket, index) => normalizeTicket(ticket, index));
}

function normalizeDbMeta(input, fallback, defaults) {
  const defaultMeta = isPlainObject(defaults) ? defaults : {};
  const fallbackMeta = isPlainObject(fallback) ? fallback : {};
  const inputMeta = isPlainObject(input) ? input : {};

  return {
    ...defaultMeta,
    ...fallbackMeta,
    ...inputMeta,
    schemaVersion:
      Number(inputMeta.schemaVersion || fallbackMeta.schemaVersion || defaultMeta.schemaVersion) > 0
        ? Number(inputMeta.schemaVersion || fallbackMeta.schemaVersion || defaultMeta.schemaVersion)
        : DB_SCHEMA_VERSION,
    createdAt: String(inputMeta.createdAt || fallbackMeta.createdAt || defaultMeta.createdAt || ""),
    updatedAt: String(inputMeta.updatedAt || fallbackMeta.updatedAt || defaultMeta.updatedAt || ""),
  };
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

function finalizeDbSnapshot(snapshot = {}, fallback = DEFAULT_DB) {
  const now = new Date().toISOString();
  const normalizedSnapshot = buildDbSnapshot(snapshot, fallback);
  const createdAt =
    normalizedSnapshot.meta && normalizedSnapshot.meta.createdAt
      ? normalizedSnapshot.meta.createdAt
      : now;

  return {
    ...normalizedSnapshot,
    meta: {
      ...normalizedSnapshot.meta,
      schemaVersion:
        Number(normalizedSnapshot.meta && normalizedSnapshot.meta.schemaVersion) > 0
          ? Number(normalizedSnapshot.meta.schemaVersion)
          : DB_SCHEMA_VERSION,
      createdAt,
      updatedAt: now,
    },
  };
}

function migrateLegacyDbIfNeeded() {
  const seedSource = findBestSeedSource();

  if (!seedSource) {
    return "";
  }

  const snapshot = finalizeDbSnapshot(readDbFile(seedSource), DEFAULT_DB);
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
  const adminAccounts =
    snapshot && Array.isArray(snapshot.admins) && snapshot.admins.length > 0
      ? snapshot.admins
      : snapshot && snapshot.admin
        ? [snapshot.admin]
        : [];
  const customAdmin = adminAccounts.some(
    (admin) =>
      admin &&
      admin.username &&
      admin.username !== DEFAULT_DB.admin.username
  )
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
    writable: isDataDirectoryWritable(),
    usingBundledStorage: insideAppBundle,
    usingExternalStorage: !insideAppBundle,
    initializationMode: storeRuntime.initializationMode,
    migrationSource: storeRuntime.migrationSource,
    snapshotLimit: SNAPSHOT_LIMIT,
  };
}

function syncDirectory(directoryPath) {
  let directoryHandle = null;

  try {
    directoryHandle = fs.openSync(directoryPath, "r");
    fs.fsyncSync(directoryHandle);
  } catch {} finally {
    if (directoryHandle !== null) {
      try {
        fs.closeSync(directoryHandle);
      } catch {}
    }
  }
}

function isDataDirectoryWritable() {
  ensureDirectory(DATA_DIR);
  const probeFile = path.join(DATA_DIR, `.write-check-${process.pid}-${Date.now()}`);

  try {
    fs.writeFileSync(probeFile, "ok", {
      mode: 0o600,
    });
    fs.unlinkSync(probeFile);
    return true;
  } catch {
    return false;
  }
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
