const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || resolveApiBaseUrl();

export async function fetchBootstrap() {
  const response = await apiRequest("/bootstrap");
  return response;
}

export async function loginApi(payload) {
  const response = await apiRequest("/auth/login", {
    method: "POST",
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

async function apiRequest(pathname, options = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = {};

  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(payload.message || "API request failed");
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
