const fs = require("fs");
const path = require("path");

const { buildBackupExportPayload } = require("../server/lib/runtime");
const { getDb, getStorageInfo } = require("../server/lib/store");

function main() {
  const storage = getStorageInfo();
  const outputArgument = String(process.argv[2] || "").trim();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultExportDirectory = path.join(storage.dataDir, "exports");
  const outputPath = outputArgument
    ? path.resolve(outputArgument)
    : path.join(defaultExportDirectory, `lottery-backup-${timestamp}.json`);
  const payload = buildBackupExportPayload({
    db: getDb(),
    storage,
  });

  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });

  console.log(`Backup export created at: ${outputPath}`);
}

main();
