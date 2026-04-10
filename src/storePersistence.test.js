const fs = require("fs");
const os = require("os");
const path = require("path");

const ORIGINAL_ENV = { ...process.env };
const tempRoots = [];

function makeTempRoot() {
  const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lottery-store-"));
  tempRoots.push(nextRoot);
  return nextRoot;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadStore(envOverrides = {}) {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    ...envOverrides,
  };

  return require("../server/lib/store");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();

  tempRoots.splice(0).forEach((rootPath) => {
    try {
      fs.rmSync(rootPath, { recursive: true, force: true });
    } catch {}
  });
});

test("migrates legacy data into external DATA_DIR on first boot", () => {
  const tempRoot = makeTempRoot();
  const persistentDir = path.join(tempRoot, "persistent-data");
  const legacyFile = path.join(tempRoot, "legacy", "db.json");

  writeJson(legacyFile, {
    master: {
      username: "owner",
      password: "secret",
    },
    admin: {
      username: "office",
      password: "1234",
    },
    sellers: [
      {
        id: 99,
        name: "Stored Seller",
        username: "storedseller",
        password: "abcd",
        active: true,
        singleCommission: 1,
        juriCommission: 3,
      },
    ],
    tickets: [
      {
        id: 501,
        sellerUsername: "storedseller",
        customerName: "Walk-in Customer",
        drawTime: "11:00",
        date: "2026-04-08",
        items: [],
      },
    ],
    results: [{ date: "2026-04-08", drawTime: "11:00", value: "45" }],
    settings: {
      rates: {
        singleSell: 11,
        singlePayout: 100,
        juriSell: 10,
        juriPayout: 600,
      },
    },
  });

  const store = loadStore({
    DATA_DIR: persistentDir,
    LEGACY_DB_FILE: legacyFile,
  });
  const db = store.getDb();
  const storage = store.getStorageInfo();

  expect(storage.usingExternalStorage).toBe(true);
  expect(storage.initializationMode).toBe("migrated");
  expect(path.resolve(storage.migrationSource)).toBe(path.resolve(legacyFile));
  expect(db.admin.username).toBe("office");
  expect(db.admins).toHaveLength(1);
  expect(db.admins[0].username).toBe("office");
  expect(db.admins[0].id).toBeTruthy();
  expect(db.sellers).toHaveLength(1);
  expect(db.sellers[0].username).toBe("storedseller");
  expect(fs.existsSync(path.join(persistentDir, "db.json"))).toBe(true);
});

test("keeps backup and rotating snapshots for future recovery", () => {
  const tempRoot = makeTempRoot();
  const dbFile = path.join(tempRoot, "store", "db.json");
  const store = loadStore({
    DB_FILE: dbFile,
    DB_SNAPSHOT_LIMIT: "3",
  });

  store.getDb();

  for (let index = 0; index < 5; index += 1) {
    store.updateDb((current) => {
      current.results = [
        ...current.results,
        {
          date: `2026-04-${String(index + 1).padStart(2, "0")}`,
          drawTime: "11:00",
          value: String(index).padStart(2, "0"),
        },
      ];
      return current;
    });
  }

  const backupFile = path.join(tempRoot, "store", "db.backup.json");
  const snapshotDir = path.join(tempRoot, "store", "snapshots");
  const snapshotFiles = fs
    .readdirSync(snapshotDir)
    .filter((fileName) => fileName.endsWith(".json"));

  expect(fs.existsSync(backupFile)).toBe(true);
  expect(snapshotFiles.length).toBeGreaterThan(0);
  expect(snapshotFiles.length).toBeLessThanOrEqual(3);
});
