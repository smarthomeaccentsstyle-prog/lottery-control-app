import { PANEL_SESSION_KEY } from "./adminStorage.js";
import { load } from "./storage.js";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || resolveApiBaseUrl();
const REQUEST_TIMEOUT_MS = 6000;
export const AUTH_EXPIRED_EVENT = "lottery-auth-expired";

export const BACKEND_UNAVAILABLE_MESSAGE = "Unable to reach the backend server.";
export const BACKEND_TIMEOUT_MESSAGE = "The backend took too long to respond.";

export async function fetchBootstrap() {
  const response = await apiRequest("/bootstrap");
  return response;
}

export async function loginApi(payload) {
  const response = await apiRequest("/auth/login", {
    method: "POST",
    body: payload,
    suppressAuthFailureEvent: true,
  });
  return response;
}

export async function verifySessionApi() {
  const response = await apiRequest("/auth/session");
  return response;
}

export async function logoutApi() {
  const response = await apiRequest("/auth/logout", {
    method: "POST",
    suppressAuthFailureEvent: true,
  });
  return response;
}

export async function changePasswordApi(payload) {
  const response = await apiRequest("/auth/password", {
    method: "PATCH",
    body: payload,
  });
  return response;
}

export async function fetchSellersApi() {
  const response = await apiRequest("/sellers");
  return response;
}

export async function fetchTicketsApi(filters = {}) {
  const response = await apiRequest(`/tickets${buildQueryString(filters)}`);
  return response;
}

export async function createTicketApi(payload) {
  const response = await apiRequest("/tickets", {
    method: "POST",
    body: payload,
  });
  return response;
}

export async function scanTicketApi(payload) {
  const response = await apiRequest("/scan-ticket", {
    method: "POST",
    body: payload,
  });
  return response;
}

export async function updateTicketApi(id, payload) {
  const response = await apiRequest(`/tickets/${id}`, {
    method: "PATCH",
    body: payload,
  });
  return response;
}

export async function fetchResultsApi(filters = {}) {
  const response = await apiRequest(`/results${buildQueryString(filters)}`);
  return response;
}

export async function fetchAdminOverviewApi() {
  const response = await apiRequest("/dashboard/overview");
  return response;
}

export async function fetchRiskBoardApi(filters = {}) {
  const response = await apiRequest(`/dashboard/risk${buildQueryString(filters)}`);
  return response;
}

export async function fetchReportSummaryApi(filters = {}) {
  const response = await apiRequest(`/reports/summary${buildQueryString(filters)}`);
  return response;
}

export async function fetchSellerReportApi(filters = {}) {
  const response = await apiRequest(`/reports/seller${buildQueryString(filters)}`);
  return response;
}

export async function saveResultApi(payload) {
  const response = await apiRequest("/results", {
    method: "PUT",
    body: payload,
  });
  return response;
}

export async function clearResultApi({ date, drawTime }) {
  const response = await apiRequest(
    `/results${buildQueryString({
      date,
      drawTime,
    })}`,
    {
      method: "DELETE",
    }
  );
  return response;
}

export async function createSellerApi(payload) {
  const response = await apiRequest("/sellers", {
    method: "POST",
    body: payload,
  });
  return response;
}

export async function updateSellerApi(id, payload) {
  const response = await apiRequest(`/sellers/${id}`, {
    method: "PATCH",
    body: payload,
  });
  return response;
}

export async function fetchMasterAdminApi() {
  const response = await apiRequest("/master/admin");
  return response;
}

export async function updateMasterAdminApi(payload) {
  const response = await apiRequest("/master/admin", {
    method: "PATCH",
    body: payload,
  });
  return response;
}

async function apiRequest(pathname, options = {}) {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId = null;

  if (controller && typeof globalThis.setTimeout === "function") {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${pathname}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(BACKEND_TIMEOUT_MESSAGE);
    }

    throw new Error(BACKEND_UNAVAILABLE_MESSAGE);
  } finally {
    if (timeoutId !== null && typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(timeoutId);
    }
  }

  let payload = {};

  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    const error = new Error(payload.message || "API request failed");
    error.status = response.status;

    if (response.status === 401 && !options.suppressAuthFailureEvent) {
      clearStoredSession();
      dispatchAuthExpired(error.message);
    }

    throw error;
  }

  return payload;
}

function buildQueryString(filters = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, value);
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

export function mapResultsToLookup(results = []) {
  return results.reduce((accumulator, result) => {
    if (!result || !result.date || !result.drawTime) {
      return accumulator;
    }

    accumulator[`${result.date}|${result.drawTime}`] = result.winningNumber || "";
    return accumulator;
  }, {});
}

export { API_BASE_URL };

function getAuthHeaders() {
  const session = load(PANEL_SESSION_KEY, null);
  const token = session && session.token ? session.token : "";

  return token ? { Authorization: `Bearer ${token}` } : {};
}

function clearStoredSession() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(PANEL_SESSION_KEY);
  } catch {}
}

function dispatchAuthExpired(message) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent(AUTH_EXPIRED_EVENT, {
        detail: { message },
      })
    );
  } catch {}
}

function resolveApiBaseUrl() {
  if (typeof window === "undefined" || !window.location) {
    return "http://localhost:4000/api";
  }

  const { hostname, origin, port } = window.location;

  if (port === "3000" || port === "3001" || port === "3002") {
    return `http://${hostname}:4000/api`;
  }

  return `${origin}/api`;
}
