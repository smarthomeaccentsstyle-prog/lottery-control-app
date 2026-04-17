const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getPathExtension,
  isStaticAssetPath,
  shouldServeAppShell,
} = require("./staticRouting");

test("detects static asset paths from build and public files", () => {
  assert.equal(isStaticAssetPath("/static/js/main.12345.js"), true);
  assert.equal(isStaticAssetPath("/manifest.json"), true);
  assert.equal(isStaticAssetPath("/favicon.ico"), true);
  assert.equal(isStaticAssetPath("/images/logo.webp"), true);
});

test("keeps app routes refreshable instead of treating them like files", () => {
  assert.equal(isStaticAssetPath("/"), false);
  assert.equal(isStaticAssetPath("/admin"), false);
  assert.equal(isStaticAssetPath("/admin/users"), false);
  assert.equal(isStaticAssetPath("/krishna"), false);
  assert.equal(isStaticAssetPath("/krishna/report/open"), false);
});

test("serves the app shell for direct browser refresh routes but not api paths", () => {
  assert.equal(shouldServeAppShell("/"), true);
  assert.equal(shouldServeAppShell("/admin"), true);
  assert.equal(shouldServeAppShell("/admin/dashboard"), true);
  assert.equal(shouldServeAppShell("/krishna"), true);
  assert.equal(shouldServeAppShell("/api/tickets"), false);
  assert.equal(shouldServeAppShell("/static/css/main.css"), false);
  assert.equal(shouldServeAppShell("/manifest.json"), false);
});

test("extracts file extensions without confusing route segments", () => {
  assert.equal(getPathExtension("/static/js/main.js"), ".js");
  assert.equal(getPathExtension("/admin/report"), "");
  assert.equal(getPathExtension("/seller.v2/dashboard"), "");
});
