const {
  clearMaintenanceState,
  getMaintenanceState,
  resolveMaintenanceFlagFile,
  writeMaintenanceState,
} = require("../server/lib/maintenance");

const command = String(process.argv[2] || "status").trim().toLowerCase();
const customMessage = process.argv.slice(3).join(" ").trim();

if (command === "on" || command === "enable") {
  const state = writeMaintenanceState(
    customMessage
      ? {
          message: customMessage,
        }
      : {}
  );

  console.log(`Maintenance mode enabled at ${resolveMaintenanceFlagFile()}`);
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

if (command === "off" || command === "disable") {
  clearMaintenanceState();
  console.log(`Maintenance mode disabled at ${resolveMaintenanceFlagFile()}`);
  console.log(JSON.stringify(getMaintenanceState(), null, 2));
  process.exit(0);
}

if (command === "status") {
  console.log(`Maintenance file: ${resolveMaintenanceFlagFile()}`);
  console.log(JSON.stringify(getMaintenanceState(), null, 2));
  process.exit(0);
}

console.error(
  "Usage: node scripts/maintenance-mode.js <on|off|status> [optional maintenance message]"
);
process.exit(1);
