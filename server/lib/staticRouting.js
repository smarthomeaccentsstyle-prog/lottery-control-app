const STATIC_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".png",
  ".svg",
  ".txt",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
  ".xml",
]);

function getPathExtension(pathname = "") {
  const normalizedPath = String(pathname || "").trim().toLowerCase();
  const lastDotIndex = normalizedPath.lastIndexOf(".");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  if (lastDotIndex <= lastSlashIndex) {
    return "";
  }

  return normalizedPath.slice(lastDotIndex);
}

function isStaticAssetPath(pathname = "") {
  const normalizedPath = String(pathname || "").trim().toLowerCase();

  if (!normalizedPath || normalizedPath === "/") {
    return false;
  }

  if (normalizedPath.startsWith("/static/")) {
    return true;
  }

  return STATIC_ASSET_EXTENSIONS.has(getPathExtension(normalizedPath));
}

function shouldServeAppShell(pathname = "") {
  const normalizedPath = String(pathname || "").trim().toLowerCase();

  if (!normalizedPath.startsWith("/")) {
    return false;
  }

  if (normalizedPath.startsWith("/api/")) {
    return false;
  }

  return !isStaticAssetPath(normalizedPath);
}

module.exports = {
  STATIC_ASSET_EXTENSIONS,
  getPathExtension,
  isStaticAssetPath,
  shouldServeAppShell,
};
