const os = require("os");

const FRONTEND_PORT = process.env.FRONTEND_PORT || 3000;
const BACKEND_PORT = process.env.BACKEND_PORT || 4000;

const addresses = getNetworkAddresses();

console.log("Lottery App LAN Setup");
console.log("");
console.log(`Frontend local: http://localhost:${FRONTEND_PORT}`);
console.log(`Backend local:  http://localhost:${BACKEND_PORT}`);

if (addresses.length === 0) {
  console.log("");
  console.log("No external IPv4 address found. Connect to Wi-Fi or Ethernet first.");
  process.exit(0);
}

console.log("");
console.log("Open from mobile on the same Wi-Fi:");
addresses.forEach((address) => {
  console.log(`Frontend LAN: http://${address}:${FRONTEND_PORT}`);
  console.log(`Backend LAN:  http://${address}:${BACKEND_PORT}`);
});

console.log("");
console.log("Run these commands:");
console.log("1. npm run server");
console.log("2. npm run start:lan");

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const results = new Set();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      results.add(entry.address);
    });
  });

  return [...results];
}
