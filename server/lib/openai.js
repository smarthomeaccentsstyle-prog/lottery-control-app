const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

loadLocalEnvFiles();

const OPENAI_API_BASE_URL = String(process.env.OPENAI_API_BASE_URL || "").trim();
const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

let cachedClient = null;

function getOpenAiApiKey() {
  const apiKey = String(process.env[OPENAI_API_KEY_ENV] || "").trim();

  if (!apiKey) {
    throw new Error(`${OPENAI_API_KEY_ENV} is not configured on the server.`);
  }

  return apiKey;
}

function getOpenAiScanStatus() {
  const apiKey = String(process.env[OPENAI_API_KEY_ENV] || "").trim();
  const model = String(process.env.OPENAI_SCAN_MODEL || "gpt-4.1").trim();

  if (!apiKey) {
    return {
      available: false,
      model,
      message: `${OPENAI_API_KEY_ENV} is not configured on the server.`,
    };
  }

  return {
    available: true,
    model,
    message: "",
  };
}

function getOpenAiClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const options = {
    apiKey: getOpenAiApiKey(),
  };

  if (OPENAI_API_BASE_URL) {
    options.baseURL = OPENAI_API_BASE_URL;
  }

  cachedClient = new OpenAI(options);
  return cachedClient;
}

async function createOpenAiResponse(payload) {
  return getOpenAiClient().responses.create(payload);
}

function loadLocalEnvFiles() {
  const rootDir = path.resolve(__dirname, "..", "..");
  const envFiles = [".env", ".env.local"];

  envFiles.forEach((fileName) => {
    const filePath = path.join(rootDir, fileName);

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      parseEnvContent(content);
    } catch {
      // Ignore env-file read errors and continue with existing process env.
    }
  });
}

function parseEnvContent(content) {
  String(content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex <= 0) {
        return;
      }

      const rawKey = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const key = rawKey.replace(/^export\s+/, "").trim();

      if (!key || process.env[key] !== undefined) {
        return;
      }

      const value = rawValue.replace(/^['"]|['"]$/g, "");
      process.env[key] = value;
    });
}

module.exports = {
  OPENAI_API_KEY_ENV,
  createOpenAiResponse,
  getOpenAiApiKey,
  getOpenAiClient,
  getOpenAiScanStatus,
};
