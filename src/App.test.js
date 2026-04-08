import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const STORAGE_KEY = "seller-panel-state-v3";
const SESSION_KEY = "lottery-panel-session-v1";
const REAL_DATE = Date;
const DEFAULT_SELLER = {
  id: 1,
  name: "Seller One",
  mobile: "",
  username: "seller1",
  password: "1234",
  active: true,
  singleCommission: 0.9,
  juriCommission: 2.65,
};
const PUBLIC_SELLER = {
  id: DEFAULT_SELLER.id,
  name: DEFAULT_SELLER.name,
  mobile: DEFAULT_SELLER.mobile,
  username: DEFAULT_SELLER.username,
  active: DEFAULT_SELLER.active,
  singleCommission: DEFAULT_SELLER.singleCommission,
  juriCommission: DEFAULT_SELLER.juriCommission,
};

function createJsonResponse(payload, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => payload,
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createSuccessFetchMock() {
  return jest.fn((url) => {
    const endpoint = String(url);

    if (endpoint.includes("/bootstrap")) {
      return createJsonResponse({ sellers: [PUBLIC_SELLER] });
    }

    if (endpoint.includes("/auth/session")) {
      return createJsonResponse({
        session: JSON.parse(localStorage.getItem(SESSION_KEY)),
      });
    }

    if (endpoint.includes("/auth/logout")) {
      return createJsonResponse({ ok: true });
    }

    if (endpoint.includes("/auth/password")) {
      return createJsonResponse({ ok: true, message: "Password updated" });
    }

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets: [] });
    }

    if (endpoint.includes("/results")) {
      return createJsonResponse({ results: [] });
    }

    if (endpoint.includes("/reports/summary")) {
      return createJsonResponse({ report: {} });
    }

    if (endpoint.includes("/reports/seller")) {
      return createJsonResponse({ report: {} });
    }

    if (endpoint.includes("/dashboard/risk")) {
      return createJsonResponse({ riskBoard: {} });
    }

    if (endpoint.includes("/dashboard/overview")) {
      return createJsonResponse({
        overview: {
          sale: 5000,
          adminCollection: 4600,
          payout: 3100,
          commission: 400,
          outstanding: 250,
          profitLoss: 1500,
        },
      });
    }

    if (endpoint.includes("/master/admin")) {
      return createJsonResponse({ admin: { username: "saikat" } });
    }

    if (endpoint.includes("/sellers")) {
      return createJsonResponse({ sellers: [PUBLIC_SELLER] });
    }

    return createJsonResponse({});
  });
}

async function renderApp(container) {
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return root;
}

async function unmountApp(root) {
  await act(async () => {
    root.unmount();
  });
}

function setPathname(pathname) {
  window.history.pushState({}, "", pathname);
}

function mockSystemDate(isoString) {
  const fixedDate = new REAL_DATE(isoString);

  global.Date = class extends REAL_DATE {
    constructor(value) {
      return value ? new REAL_DATE(value) : new REAL_DATE(fixedDate);
    }

    static now() {
      return fixedDate.getTime();
    }

    static parse(value) {
      return REAL_DATE.parse(value);
    }

    static UTC(...args) {
      return REAL_DATE.UTC(...args);
    }
  };
}

function setInputValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  setPathname("/");
  global.fetch = createSuccessFetchMock();
});

afterEach(() => {
  jest.resetAllMocks();
  delete global.fetch;
  global.Date = REAL_DATE;
  setPathname("/");
});

test("renders seller login screen by default without demo credentials", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Seller Panel Login");
  expect(container.textContent).toContain("Seller");
  expect(container.textContent).not.toContain("Admin Login");
  expect(container.textContent).not.toContain("Admin Access");
  expect(container.textContent).not.toContain("Demo:");
  expect(container.textContent).not.toContain("Backend connected");
  await unmountApp(root);
});

test("renders admin login only on admin path", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/admin");
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Admin Login");
  expect(container.textContent).toContain("Admin Access");
  expect(container.textContent).not.toContain("Seller Panel Login");
  await unmountApp(root);
});

test("renders master login only on hidden krishna path", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/krishna");
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Master Panel Login");
  expect(container.textContent).toContain("Master Access");
  expect(container.textContent).not.toContain("Seller Panel Login");
  expect(container.textContent).not.toContain("Admin Login");
  await unmountApp(root);
});

test("does not expose master login on old master path", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/master");
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Seller Panel Login");
  expect(container.textContent).not.toContain("Master Panel Login");
  await unmountApp(root);
});

test("returns to login screen when backend is offline on startup", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = jest.fn(() => Promise.reject(new Error("offline")));
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Seller Panel Login");
  expect(container.textContent).toContain("Backend is offline");
  expect(container.textContent).not.toContain("Today Collection");
  await unmountApp(root);
});

test("renders seller panel with seller session", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Seller Panel");
  expect(container.textContent).toContain("Create New Ticket");
  expect(container.textContent).toContain("Scan Entry");
  await unmountApp(root);
});

test("keeps saved admin session on restore screen instead of flashing login", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/admin");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "admin",
      token: "admin-token",
      username: "admin",
    })
  );

  const bootstrapDeferred = createDeferred();
  const sessionDeferred = createDeferred();

  global.fetch = jest.fn((url) => {
    const endpoint = String(url);

    if (endpoint.includes("/bootstrap")) {
      return bootstrapDeferred.promise;
    }

    if (endpoint.includes("/auth/session")) {
      return sessionDeferred.promise;
    }

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets: [] });
    }

    if (endpoint.includes("/results")) {
      return createJsonResponse({ results: [] });
    }

    if (endpoint.includes("/sellers")) {
      return createJsonResponse({ sellers: [PUBLIC_SELLER] });
    }

    if (endpoint.includes("/dashboard/risk")) {
      return createJsonResponse({ riskBoard: {} });
    }

    if (endpoint.includes("/dashboard/overview")) {
      return createJsonResponse({ overview: {} });
    }

    if (endpoint.includes("/reports/seller")) {
      return createJsonResponse({ report: {} });
    }

    return createJsonResponse({});
  });

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Restoring Session");
  expect(container.textContent).not.toContain("Admin Login");

  await act(async () => {
    bootstrapDeferred.resolve(createJsonResponse({ sellers: [PUBLIC_SELLER] }));
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Restoring Session");

  await act(async () => {
    sessionDeferred.resolve(
      createJsonResponse({
        session: JSON.parse(localStorage.getItem(SESSION_KEY)),
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Risk Control");
  expect(container.textContent).not.toContain("Admin Login");
  await unmountApp(root);
});

test("shows seller self password change in account tab", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const accountButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Account"
  );

  await act(async () => {
    accountButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Account Security");
  expect(container.textContent).toContain("Change Seller Password");
  expect(container.textContent).toContain("Save New Password");
  await unmountApp(root);
});

test("opens new ticket with the next available draw by default", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T19:30:00");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Create New Ticket");
  expect(container.textContent).toContain("8:00 PM ticket entry is open for 2026-04-06 until 7:58 PM.");
  await unmountApp(root);
});

test("keeps 11 AM ticket open until 11:10 AM cutoff", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T11:05:00");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [],
      winResults: {},
      customerName: "",
      customerPhone: "",
      date: "2026-04-06",
      drawTime: "11:00",
      paymentMode: "Paid",
      paidAmount: "",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const bookingDateInput = container.querySelector('input[type="date"]');

  expect(container.textContent).toContain("11:00 AM ticket entry is open for 2026-04-06 until 11:10 AM.");
  expect(bookingDateInput.value).toBe("2026-04-06");
  await unmountApp(root);
});

test("moves expired draw booking to the next day", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T19:30:00");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [],
      winResults: {},
      customerName: "",
      customerPhone: "",
      date: "2026-04-06",
      drawTime: "19:00",
      paymentMode: "Paid",
      paidAmount: "",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const bookingDateInput = container.querySelector('input[type="date"]');

  expect(container.textContent).toContain("Booking For: 2026-04-07");
  expect(bookingDateInput.value).toBe("2026-04-07");
  await unmountApp(root);
});

test("moves 1 PM ticket to next day after 12:58 PM cutoff", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T12:59:00");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [],
      winResults: {},
      customerName: "",
      customerPhone: "",
      date: "2026-04-06",
      drawTime: "13:00",
      paymentMode: "Paid",
      paidAmount: "",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const bookingDateInput = container.querySelector('input[type="date"]');

  expect(container.textContent).toContain("Booking For: 2026-04-07");
  expect(bookingDateInput.value).toBe("2026-04-07");
  await unmountApp(root);
});

test("clamps seller booking date to only tomorrow when a later future date is stored", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T09:00:00");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [],
      winResults: {},
      customerName: "",
      customerPhone: "",
      date: "2026-04-10",
      drawTime: "11:00",
      paymentMode: "Paid",
      paidAmount: "",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const bookingDateInput = container.querySelector('input[type="date"]');

  expect(bookingDateInput.value).toBe("2026-04-07");
  expect(bookingDateInput.max).toBe("2026-04-07");
  expect(container.textContent).toContain("Booking For: 2026-04-07");
  await unmountApp(root);
});

test("renders ticket store with saved ticket format", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const savedTicket = {
    id: 1001,
    customerName: "Walk-in Customer",
    customerPhone: "",
    date: "2026-04-06",
    drawTime: "11:00",
    paymentMode: "Paid",
    paidAmount: 32,
    dueAmount: 0,
    total: 32,
    commission: 2.7,
    claimed: false,
    payout: 0,
    winningNumber: "",
    createdAt: "2026-04-05T12:00:00.000Z",
    sellerUsername: "seller1",
    items: [
      { type: "single3", num: "1", qty: 1, label: "3rd House 1", total: 11, profit: 0.9 },
      { type: "single3", num: "3", qty: 2, label: "3rd House 3", total: 22, profit: 1.8 },
      { type: "single4", num: "1", qty: 1, label: "4th House 1", total: 11, profit: 0.9 },
      { type: "single4", num: "3", qty: 2, label: "4th House 3", total: 22, profit: 1.8 },
      { type: "juri", num: "12", qty: 1, label: "Juri 12", total: 10, profit: 2.65 },
      { type: "juri", num: "21", qty: 1, label: "Juri 21", total: 10, profit: 2.65 },
    ],
  };
  const baseFetchMock = createSuccessFetchMock();
  global.fetch = jest.fn((url) => {
    if (String(url).includes("/tickets")) {
      return createJsonResponse({ tickets: [savedTicket] });
    }

    return baseFetchMock(url);
  });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [savedTicket],
      winResults: {},
      customerName: "",
      customerPhone: "",
      date: "2026-04-06",
      drawTime: "11:00",
      paymentMode: "Paid",
      paidAmount: "",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  const ticketStoreButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Ticket Store"
  );

  act(() => {
    ticketStoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(container.textContent).toContain("Ticket Store");
  expect(container.textContent).toContain("3rd");
  expect(container.textContent).toContain("4th");
  expect(container.textContent).toContain("12-21 -1");
  await unmountApp(root);
});

test("shows print option after saving a new ticket", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let tickets = [];
  const baseFetchMock = createSuccessFetchMock();
  const mockPrintWindow = {
    document: {
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn(),
    },
    focus: jest.fn(),
    print: jest.fn(),
    onload: null,
  };
  window.open = jest.fn(() => mockPrintWindow);

  global.fetch = jest.fn((url, options = {}) => {
    const endpoint = String(url);
    const method = options.method || "GET";

    if (endpoint.includes("/tickets") && method === "POST") {
      const payload = JSON.parse(options.body);
      tickets = [{ ...payload }];
      return createJsonResponse({ tickets });
    }

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets });
    }

    return baseFetchMock(url);
  });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const juriTextarea = container.querySelector('textarea[placeholder="45-5, 88-5, 04-10"]');

  await act(async () => {
    setTextareaValue(juriTextarea, "12-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const saveTicketButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Save Ticket"
  );

  await act(async () => {
    saveTicketButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("saved");
  expect(container.textContent).toContain("Print Ticket");

  const printTicketButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Print Ticket"
  );

  await act(async () => {
    printTicketButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(window.open).toHaveBeenCalled();
  expect(mockPrintWindow.document.write).toHaveBeenCalled();
  expect(mockPrintWindow.focus).toHaveBeenCalled();
  expect(typeof mockPrintWindow.onload).toBe("function");

  await unmountApp(root);
});

test("claims a winning ticket once from the ticket id claim desk", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const winningTicket = {
    id: 777001,
    customerName: "Lucky Buyer",
    customerPhone: "",
    date: "2026-04-06",
    drawTime: "11:00",
    paymentMode: "Paid",
    paidAmount: 10,
    dueAmount: 0,
    total: 10,
    commission: 2.65,
    claimed: false,
    payout: 0,
    winningNumber: "",
    createdAt: "2026-04-06T08:00:00.000Z",
    sellerUsername: "seller1",
    cancelled: false,
    cancelledAt: "",
    items: [{ type: "juri", num: "12", qty: 1, label: "Juri 12", total: 10, profit: 2.65 }],
  };
  const results = [{ date: "2026-04-06", drawTime: "11:00", winningNumber: "12" }];
  let tickets = [winningTicket];
  const baseFetchMock = createSuccessFetchMock();

  global.fetch = jest.fn((url, options = {}) => {
    const endpoint = String(url);
    const method = options.method || "GET";

    if (endpoint.includes(`/tickets/${winningTicket.id}`) && method === "PATCH") {
      tickets = tickets.map((ticket) =>
        ticket.id === winningTicket.id
          ? { ...ticket, claimed: true, payout: 600, winningNumber: "12" }
          : ticket
      );
      return createJsonResponse({ ticket: tickets[0] });
    }

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets });
    }

    if (endpoint.includes("/results")) {
      return createJsonResponse({ results });
    }

    return baseFetchMock(url);
  });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const claimsButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Claims"
  );

  await act(async () => {
    claimsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const claimInput = container.querySelector('input[placeholder="Enter printed ticket ID"]');

  await act(async () => {
    setInputValue(claimInput, String(winningTicket.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Winner found");
  expect(container.textContent).toContain("Lucky Buyer");
  expect(container.textContent).toContain("₹600");

  const claimTicketButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Claim Ticket"
  );

  await act(async () => {
    claimTicketButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Claim completed");
  expect(container.textContent).toContain("Claimed History");

  const refreshedClaimInput = container.querySelector('input[placeholder="Enter printed ticket ID"]');

  await act(async () => {
    setInputValue(refreshedClaimInput, String(winningTicket.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Already claimed");
  expect(container.textContent).toContain("One ticket ID can be claimed only once.");
  await unmountApp(root);
});

test("shows sorry next time for a non-winning claim lookup", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const losingTicket = {
    id: 777002,
    customerName: "Try Again",
    customerPhone: "",
    date: "2026-04-06",
    drawTime: "15:00",
    paymentMode: "Paid",
    paidAmount: 11,
    dueAmount: 0,
    total: 11,
    commission: 0.9,
    claimed: false,
    payout: 0,
    winningNumber: "",
    createdAt: "2026-04-06T12:00:00.000Z",
    sellerUsername: "seller1",
    cancelled: false,
    cancelledAt: "",
    items: [{ type: "single3", num: "5", qty: 1, label: "3rd House 5", total: 11, profit: 0.9 }],
  };
  const results = [{ date: "2026-04-06", drawTime: "15:00", winningNumber: "12" }];
  const baseFetchMock = createSuccessFetchMock();

  global.fetch = jest.fn((url) => {
    const endpoint = String(url);

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets: [losingTicket] });
    }

    if (endpoint.includes("/results")) {
      return createJsonResponse({ results });
    }

    return baseFetchMock(url);
  });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const claimsButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Claims"
  );

  await act(async () => {
    claimsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const claimInput = container.querySelector('input[placeholder="Enter printed ticket ID"]');

  await act(async () => {
    setInputValue(claimInput, String(losingTicket.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Sorry, next time.");
  expect(container.textContent).toContain("This ticket did not win for the selected result.");
  await unmountApp(root);
});

test("shows admin confirmed results as claim ready in the seller results tab", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockSystemDate("2026-04-06T19:30:00");
  const winningTicket = {
    id: 777003,
    customerName: "Result Winner",
    customerPhone: "",
    date: "2026-04-06",
    drawTime: "19:00",
    paymentMode: "Paid",
    paidAmount: 10,
    dueAmount: 0,
    total: 10,
    commission: 2.65,
    claimed: false,
    payout: 0,
    winningNumber: "",
    createdAt: "2026-04-06T18:00:00.000Z",
    sellerUsername: "seller1",
    cancelled: false,
    cancelledAt: "",
    items: [{ type: "juri", num: "12", qty: 1, label: "Juri 12", total: 10, profit: 2.65 }],
  };
  const results = [{ date: "2026-04-06", drawTime: "19:00", winningNumber: "12" }];
  const baseFetchMock = createSuccessFetchMock();

  global.fetch = jest.fn((url) => {
    const endpoint = String(url);

    if (endpoint.includes("/tickets")) {
      return createJsonResponse({ tickets: [winningTicket] });
    }

    if (endpoint.includes("/results")) {
      return createJsonResponse({ results });
    }

    return baseFetchMock(url);
  });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      token: "seller-token",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const resultsButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Results"
  );

  await act(async () => {
    resultsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Game Results");
  expect(container.textContent).toContain("7:00 PM");
  expect(container.textContent).toContain("Claim Ready");
  expect(container.textContent).toContain("Admin confirmed result. 1 winning ticket(s) can be claimed now.");
  expect(container.textContent).toContain("₹600.00");
  await unmountApp(root);
});

test("renders admin panel with admin session", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/admin");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "admin",
      token: "admin-token",
      username: "admin",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Risk Board");
  expect(container.textContent).toContain("Risk Control");
  expect(container.textContent).toContain("Seller Manage");
  expect(container.textContent).toContain("Reports");
  await unmountApp(root);
});

test("shows admin self password change in seller manage section", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/admin");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "admin",
      token: "admin-token",
      username: "admin",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const sellerManageButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Seller Manage"
  );

  await act(async () => {
    sellerManageButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("Admin Password");
  expect(container.textContent).toContain("Save Admin Password");
  expect(container.textContent).toContain("Master Panel");
  await unmountApp(root);
});

test("renders master panel with master session", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/krishna");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "master",
      token: "master-token",
      username: "krishna",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);

  expect(container.textContent).toContain("Master Panel");
  expect(container.textContent).toContain("Admin Business View");
  expect(container.textContent).toContain("Admin Control");
  expect(container.textContent).toContain("Seller Accounts");
  expect(container.textContent).toContain("Admin Username");
  expect(container.textContent).toContain("Highest Sale Seller");
  expect(container.textContent).toContain("Profit / Loss");
  await unmountApp(root);
});

test("keeps seller password blank while editing in master panel", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  setPathname("/krishna");
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "master",
      token: "master-token",
      username: "krishna",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = await renderApp(container);
  const editButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Edit"
  );

  await act(async () => {
    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const passwordInput = container.querySelector(
    'input[placeholder="Leave blank to keep current password"]'
  );

  expect(passwordInput).not.toBeNull();
  expect(passwordInput.value).toBe("");
  await unmountApp(root);
});
