const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_DB } = require("./models");
const { hashPassword } = require("./passwords");
const { buildBackupExportPayload, buildReadinessReport, toPublicReadinessReport } = require("./runtime");

test("readiness report warns when storage is bundled and default credentials remain", () => {
  const db = {
    ...DEFAULT_DB,
    master: {
      ...DEFAULT_DB.master,
      password: hashPassword(DEFAULT_DB.master.password),
    },
    admins: [
      {
        ...DEFAULT_DB.admin,
        password: hashPassword(DEFAULT_DB.admin.password),
      },
    ],
    sellers: DEFAULT_DB.sellers.map((seller) => ({
      ...seller,
      password: hashPassword(seller.password),
    })),
  };

  const report = buildReadinessReport({
    db,
    storage: {
      usingExternalStorage: false,
      writable: true,
    },
    bodySizeLimitBytes: 256 * 1024,
    sessionTtlHours: 24,
  });

  assert.equal(report.status, "warning");
  assert.equal(report.checks.persistentStorage.ok, false);
  assert.equal(report.checks.defaultMasterCredentials.ok, false);
  assert.equal(report.checks.defaultAdminCredentials.ok, false);
  assert.equal(report.checks.defaultSellerCredentials.ok, false);
});

test("backup exports keep schema metadata and strip live sessions", () => {
  const payload = buildBackupExportPayload({
    db: {
      ...DEFAULT_DB,
      sessions: [
        {
          role: "seller",
          username: "seller1",
          tokenHash: "secret",
          expiresAt: "2026-04-18T00:00:00.000Z",
        },
      ],
      meta: {
        schemaVersion: 2,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      },
    },
    storage: {
      usingExternalStorage: true,
      initializationMode: "existing",
      migrationSource: "",
    },
  }, {
    now: new Date("2026-04-17T10:00:00.000Z"),
  });

  assert.equal(payload.format, "lottery-app-backup");
  assert.equal(payload.schemaVersion, 2);
  assert.deepEqual(payload.db.sessions, []);
  assert.equal(payload.db.meta.schemaVersion, 2);
  assert.equal(payload.db.meta.exportedAt, "2026-04-17T10:00:00.000Z");
});

test("public readiness redacts detailed credential findings", () => {
  const fullReport = buildReadinessReport({
    db: {
      ...DEFAULT_DB,
      master: {
        ...DEFAULT_DB.master,
        password: hashPassword(DEFAULT_DB.master.password),
      },
    },
    storage: {
      usingExternalStorage: true,
      writable: true,
    },
    bodySizeLimitBytes: 256 * 1024,
  });

  const publicReport = toPublicReadinessReport(fullReport);

  assert.equal(publicReport.status, "warning");
  assert.equal(publicReport.checks.defaultMasterCredentials, undefined);
  assert.equal(
    publicReport.warnings.some((warning) => warning.key === "security"),
    true
  );
});
