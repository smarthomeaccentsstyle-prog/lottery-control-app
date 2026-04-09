const OpenAI = require("openai");

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

module.exports = {
  OPENAI_API_KEY_ENV,
  createOpenAiResponse,
  getOpenAiApiKey,
  getOpenAiClient,
};
