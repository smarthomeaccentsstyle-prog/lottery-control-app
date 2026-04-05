import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const STORAGE_KEY = "seller-panel-state-v3";
const SESSION_KEY = "lottery-panel-session-v1";

beforeEach(() => {
  localStorage.clear();
});

test("renders login screen by default", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);

  act(() => {
    const root = createRoot(container);
    root.render(<App />);
  });

  expect(container.textContent).toContain("Admin Login");
  expect(container.textContent).toContain("Seller");
});

test("renders seller panel with seller session", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      username: "seller1",
      sellerName: "Seller One",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  act(() => {
    const root = createRoot(container);
    root.render(<App />);
  });

  expect(container.textContent).toContain("Seller Panel");
});

test("renders ticket store with saved ticket format", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "seller",
      username: "seller1",
      sellerName: "Seller One",
    })
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tickets: [
        {
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
          items: [
            { type: "single3", num: "1", qty: 1, label: "3rd House 1", total: 11, profit: 0.9 },
            { type: "single3", num: "3", qty: 2, label: "3rd House 3", total: 22, profit: 1.8 },
            { type: "single4", num: "1", qty: 1, label: "4th House 1", total: 11, profit: 0.9 },
            { type: "single4", num: "3", qty: 2, label: "4th House 3", total: 22, profit: 1.8 },
            { type: "juri", num: "12", qty: 1, label: "Juri 12", total: 10, profit: 2.65 },
            { type: "juri", num: "21", qty: 1, label: "Juri 21", total: 10, profit: 2.65 },
          ],
        },
      ],
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

  act(() => {
    const root = createRoot(container);
    root.render(<App />);
  });

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
});

test("renders admin panel with admin session", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      role: "admin",
      username: "admin",
    })
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  act(() => {
    const root = createRoot(container);
    root.render(<App />);
  });

  expect(container.textContent).toContain("Risk Board");
  expect(container.textContent).toContain("Risk Control");
});
