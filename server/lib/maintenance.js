const fs = require("fs");
const path = require("path");

const { DATA_DIR } = require("./store");

const DEFAULT_MAINTENANCE_TITLE = "Updating Server";
const DEFAULT_MAINTENANCE_MESSAGE = "Updating server maintenance. Please wait a short time.";
const DEFAULT_MAINTENANCE_COMPLETION_MESSAGE =
  "Refresh or reopen after update is complete.";
const DEFAULT_MAINTENANCE_ACTION_LABEL = "Refresh";
const DEFAULT_MAINTENANCE_RETRY_AFTER_SECONDS = 30;
const MAINTENANCE_FLAG_FILE_NAME = "maintenance.json";
const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function getMaintenanceState() {
  const fileState = readMaintenanceFile();
  const envState = readMaintenanceEnvState();
  const enabled = Boolean(fileState.enabled || envState.enabled);
  const source = envState.enabled ? "environment" : fileState.enabled ? "file" : "";

  return normalizeMaintenanceState(
    {
      ...fileState,
      ...envState,
      enabled,
      source,
    },
    { enabled }
  );
}

function writeMaintenanceState(input = {}) {
  const filePath = resolveMaintenanceFlagFile();
  const nextState = normalizeMaintenanceState(
    {
      ...input,
      enabled: true,
      updatedAt: new Date().toISOString(),
      source: "file",
    },
    { enabled: true }
  );

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

function clearMaintenanceState() {
  const filePath = resolveMaintenanceFlagFile();

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function resolveMaintenanceFlagFile() {
  const configuredPath = String(process.env.MAINTENANCE_FILE || "").trim();
  return configuredPath || path.join(DATA_DIR, MAINTENANCE_FLAG_FILE_NAME);
}

function readMaintenanceFile() {
  const filePath = resolveMaintenanceFlagFile();

  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readMaintenanceEnvState() {
  const retryAfterSeconds = normalizePositiveInteger(
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS,
    0
  );
  const envState = {
    enabled: isTruthy(process.env.MAINTENANCE_MODE),
  };

  assignOptionalEnvValue(envState, "title", "MAINTENANCE_TITLE");
  assignOptionalEnvValue(envState, "message", "MAINTENANCE_MESSAGE");
  assignOptionalEnvValue(
    envState,
    "completionMessage",
    "MAINTENANCE_COMPLETION_MESSAGE"
  );
  assignOptionalEnvValue(envState, "actionLabel", "MAINTENANCE_ACTION_LABEL");

  if (retryAfterSeconds > 0) {
    envState.retryAfterSeconds = retryAfterSeconds;
  }

  return envState;
}

function normalizeMaintenanceState(input = {}, options = {}) {
  const normalizedInput = input && typeof input === "object" ? input : {};
  const enabled =
    options.enabled !== undefined ? Boolean(options.enabled) : Boolean(normalizedInput.enabled);

  return {
    enabled,
    title: String(normalizedInput.title || DEFAULT_MAINTENANCE_TITLE),
    message: String(normalizedInput.message || DEFAULT_MAINTENANCE_MESSAGE),
    completionMessage: String(
      normalizedInput.completionMessage || DEFAULT_MAINTENANCE_COMPLETION_MESSAGE
    ),
    actionLabel: String(normalizedInput.actionLabel || DEFAULT_MAINTENANCE_ACTION_LABEL),
    retryAfterSeconds: normalizePositiveInteger(
      normalizedInput.retryAfterSeconds,
      DEFAULT_MAINTENANCE_RETRY_AFTER_SECONDS
    ),
    updatedAt: enabled ? String(normalizedInput.updatedAt || "") : "",
    source: enabled ? String(normalizedInput.source || "") : "",
  };
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.round(numericValue)
    : fallback;
}

function readOptionalEnvValue(key) {
  const value = String(process.env[key] || "").trim();
  return value || "";
}

function assignOptionalEnvValue(target, key, envKey) {
  const value = readOptionalEnvValue(envKey);

  if (value) {
    target[key] = value;
  }
}

function isTruthy(value) {
  return TRUTHY_VALUES.has(String(value || "").trim().toLowerCase());
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

module.exports = {
  DEFAULT_MAINTENANCE_ACTION_LABEL,
  DEFAULT_MAINTENANCE_COMPLETION_MESSAGE,
  DEFAULT_MAINTENANCE_MESSAGE,
  DEFAULT_MAINTENANCE_RETRY_AFTER_SECONDS,
  DEFAULT_MAINTENANCE_TITLE,
  clearMaintenanceState,
  getMaintenanceState,
  resolveMaintenanceFlagFile,
  writeMaintenanceState,
};
