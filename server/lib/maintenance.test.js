const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  clearMaintenanceState,
  getMaintenanceState,
  resolveMaintenanceFlagFile,
  writeMaintenanceState,
} = require("./maintenance");

test("file-backed maintenance mode can be enabled and cleared without touching app data", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lottery-maintenance-"));
  const maintenanceFile = path.join(tempDir, "maintenance.json");
  const previousMaintenanceFile = process.env.MAINTENANCE_FILE;
  const previousMaintenanceMode = process.env.MAINTENANCE_MODE;

  process.env.MAINTENANCE_FILE = maintenanceFile;
  delete process.env.MAINTENANCE_MODE;

  try {
    assert.equal(resolveMaintenanceFlagFile(), maintenanceFile);
    assert.equal(getMaintenanceState().enabled, false);

    const enabledState = writeMaintenanceState({
      message: "Deploy in progress",
    });

    assert.equal(enabledState.enabled, true);
    assert.equal(enabledState.message, "Deploy in progress");
    assert.equal(fs.existsSync(maintenanceFile), true);
    assert.equal(getMaintenanceState().enabled, true);
    assert.equal(getMaintenanceState().message, "Deploy in progress");

    clearMaintenanceState();

    assert.equal(fs.existsSync(maintenanceFile), false);
    assert.equal(getMaintenanceState().enabled, false);
  } finally {
    if (previousMaintenanceFile === undefined) {
      delete process.env.MAINTENANCE_FILE;
    } else {
      process.env.MAINTENANCE_FILE = previousMaintenanceFile;
    }

    if (previousMaintenanceMode === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previousMaintenanceMode;
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
});

test("environment maintenance mode overrides the file switch", () => {
  const previousMaintenanceMode = process.env.MAINTENANCE_MODE;
  process.env.MAINTENANCE_MODE = "true";

  try {
    assert.equal(getMaintenanceState().enabled, true);
  } finally {
    if (previousMaintenanceMode === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previousMaintenanceMode;
    }
  }
});
