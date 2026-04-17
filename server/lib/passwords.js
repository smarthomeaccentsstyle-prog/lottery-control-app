const crypto = require("crypto");

const PASSWORD_HASH_PREFIX = "scrypt$";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}${salt}$${hash}`;
}

function isPasswordHash(value) {
  return String(value || "").startsWith(PASSWORD_HASH_PREFIX);
}

function verifyPassword(password, storedPassword) {
  const normalizedPassword = String(password || "");
  const normalizedStoredPassword = String(storedPassword || "");

  if (!normalizedStoredPassword) {
    return false;
  }

  if (!isPasswordHash(normalizedStoredPassword)) {
    return normalizedPassword === normalizedStoredPassword;
  }

  const [, salt, expectedHash] = normalizedStoredPassword.split("$");

  if (!salt || !expectedHash) {
    return false;
  }

  try {
    const actualHash = crypto.scryptSync(normalizedPassword, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(expectedHash, "hex"),
      Buffer.from(actualHash, "hex")
    );
  } catch {
    return false;
  }
}

module.exports = {
  PASSWORD_HASH_PREFIX,
  hashPassword,
  isPasswordHash,
  verifyPassword,
};
