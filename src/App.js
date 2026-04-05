import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { load, save } from "./untils/storage.js";
import {
  clearResultApi,
  fetchBootstrap,
  fetchResultsApi,
  fetchReportSummaryApi,
  fetchSellersApi,
  fetchTicketsApi,
  loginApi,
  mapResultsToLookup,
  saveResultApi,
  createTicketApi,
  updateTicketApi,
} from "./untils/api.js";
import LoginScreen from "./components/LoginScreen.js";
import AdminPanel from "./components/AdminPanel.js";
import {
  PANEL_SESSION_KEY,
  SELLER_LIST_KEY,
  SELLER_PANEL_STORAGE_KEY,
  getSellerCommissionSettings,
} from "./untils/adminStorage.js";

const SINGLE_RATE = 11;
const SINGLE_PAYOUT = 100;
const JURI_RATE = 10;
const JURI_PAYOUT = 600;

const tabs = [
  "Dashboard",
  "New Ticket",
  "Ticket Store",
  "Reports",
  "Result Checker",
  "Claims",
  "Due",
];

const drawOptions = [
  { value: "11:00", label: "11:00 AM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "20:00", label: "8:00 PM" },
];

const reportRanges = ["Daily", "Weekly", "Monthly", "Yearly"];

const emptySingle = () => Array(10).fill("");
const emptyResultDrafts = () => buildResultDraftMap("");

function SellerPanel({ session, onLogout, sellerSyncToken }) {
  const persisted = useMemo(
    () =>
      load(SELLER_PANEL_STORAGE_KEY, {
        tickets: [],
        winResults: {},
        customerName: "",
        customerPhone: "",
        date: getTodayString(),
        drawTime: "11:00",
        paymentMode: "Paid",
        paidAmount: "",
      }),
    []
  );

  const [activeTab, setActiveTab] = useState("Dashboard");
  const [tickets, setTickets] = useState(() => normalizeTickets(persisted.tickets));
  const [winResults, setWinResults] = useState(persisted.winResults || {});
  const [third, setThird] = useState(emptySingle);
  const [fourth, setFourth] = useState(emptySingle);
  const [juriText, setJuriText] = useState("");
  const [customerName, setCustomerName] = useState(persisted.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(persisted.customerPhone || "");
  const [drawTime, setDrawTime] = useState(persisted.drawTime || "11:00");
  const [date, setDate] = useState(() =>
    getNextValidBookingDate(persisted.date || getTodayString(), persisted.drawTime || "11:00")
  );
  const [editingTicketId, setEditingTicketId] = useState(null);
  const [paymentMode, setPaymentMode] = useState(persisted.paymentMode || "Paid");
  const [paidAmount, setPaidAmount] = useState(persisted.paidAmount || "");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketFilter, setTicketFilter] = useState("ALL");
  const [reportRange, setReportRange] = useState("Daily");
  const [resultDate, setResultDate] = useState(getTodayString());
  const [resultDrafts, setResultDrafts] = useState(emptyResultDrafts);
  const [syncMessage, setSyncMessage] = useState("");
  const [reportSummaryMap, setReportSummaryMap] = useState(() => buildEmptyReportSummaryMap());
  const sellerSyncRef = useRef({
    ticketsSignature: buildSyncSignature(normalizeTickets(persisted.tickets)),
    resultsSignature: buildSyncSignature(persisted.winResults || {}),
    queued: null,
  });
  const todayString = getTodayString();
  const activeTickets = useMemo(
    () => tickets.filter((ticket) => !ticket.cancelled),
    [tickets]
  );

  useEffect(() => {
    save(SELLER_PANEL_STORAGE_KEY, {
      tickets,
      winResults,
      customerName,
      customerPhone,
      date,
      drawTime,
      paymentMode,
      paidAmount,
    });
  }, [tickets, winResults, customerName, customerPhone, date, drawTime, paymentMode, paidAmount]);

  useEffect(() => {
    setResultDrafts(buildResultDraftMap("", resultDate, winResults));
  }, [resultDate, winResults]);

  const canApplySellerSyncNow = useCallback(
    (forceApply = false) => {
      if (forceApply || activeTab !== "New Ticket") {
        return true;
      }

      if (typeof document === "undefined") {
        return true;
      }

      const activeElement = document.activeElement;

      if (!activeElement) {
        return true;
      }

      return !["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName);
    },
    [activeTab]
  );

  const flushQueuedSellerSync = useCallback(
    (forceApply = false) => {
      const queued = sellerSyncRef.current.queued;

      if (!queued || !canApplySellerSyncNow(forceApply)) {
        return;
      }

      sellerSyncRef.current = {
        ticketsSignature: queued.ticketsSignature,
        resultsSignature: queued.resultsSignature,
        queued: null,
      };
      setTickets(queued.tickets);
      setWinResults(queued.winResults);
    },
    [canApplySellerSyncNow]
  );

  const applySellerSyncPayload = useCallback(
    (nextTickets, nextWinResults, forceApply = false) => {
      const ticketsSignature = buildSyncSignature(nextTickets);
      const resultsSignature = buildSyncSignature(nextWinResults);

      if (
        sellerSyncRef.current.ticketsSignature === ticketsSignature &&
        sellerSyncRef.current.resultsSignature === resultsSignature
      ) {
        sellerSyncRef.current.queued = null;
        return;
      }

      if (!canApplySellerSyncNow(forceApply)) {
        sellerSyncRef.current.queued = {
          tickets: nextTickets,
          winResults: nextWinResults,
          ticketsSignature,
          resultsSignature,
        };
        return;
      }

      sellerSyncRef.current = {
        ticketsSignature,
        resultsSignature,
        queued: null,
      };
      setTickets(nextTickets);
      setWinResults(nextWinResults);
    },
    [canApplySellerSyncNow]
  );

  const syncSellerData = useCallback(async ({ forceApply = false } = {}) => {
    if (!session || !session.username) {
      return;
    }

    try {
      const [ticketsResponse, resultsResponse] = await Promise.all([
        fetchTicketsApi({ sellerUsername: session.username }),
        fetchResultsApi(),
      ]);

      applySellerSyncPayload(
        normalizeTickets(ticketsResponse.tickets || []),
        mapResultsToLookup(resultsResponse.results || []),
        forceApply
      );
      setSyncMessage("");
    } catch (error) {
      setSyncMessage(error.message || "Backend sync failed");
    }
  }, [applySellerSyncPayload, session]);

  useEffect(() => {
    flushQueuedSellerSync();
  }, [activeTab, flushQueuedSellerSync]);

  useEffect(() => {
    const handleFocusChange = () => {
      flushQueuedSellerSync();
    };

    window.addEventListener("focusout", handleFocusChange);
    window.addEventListener("pointerup", handleFocusChange);

    return () => {
      window.removeEventListener("focusout", handleFocusChange);
      window.removeEventListener("pointerup", handleFocusChange);
    };
  }, [flushQueuedSellerSync]);

  useEffect(() => {
    let active = true;

    const syncLoop = async () => {
      if (!active || (typeof document !== "undefined" && document.hidden)) {
        return;
      }

      await syncSellerData();
    };

    syncLoop();
    const intervalId = window.setInterval(syncLoop, 8000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [syncSellerData, sellerSyncToken]);

  useEffect(() => {
    let active = true;

    const loadReports = async () => {
      if (!session || !session.username) {
        return;
      }

      try {
        const responses = await Promise.all(
          reportRanges.map((range) =>
            fetchReportSummaryApi({
              sellerUsername: session.username,
              range,
              today: todayString,
            })
          )
        );

        if (!active) {
          return;
        }

        const nextMap = reportRanges.reduce((accumulator, range, index) => {
          accumulator[range] = responses[index].report || emptyReportMetrics();
          return accumulator;
        }, {});

        setReportSummaryMap(nextMap);
      } catch {}
    };

    loadReports();

    return () => {
      active = false;
    };
  }, [session, tickets, todayString, winResults]);

  const effectiveTicketDate = useMemo(
    () => getNextValidBookingDate(date, drawTime),
    [date, drawTime]
  );
  const bookingDateAdjusted = effectiveTicketDate !== date;

  const sellerCommissionSettings = useMemo(
    () => getSellerCommissionSettings(session && session.username),
    [session, sellerSyncToken]
  );
  const parsedJuri = useMemo(
    () => parseJuriInput(juriText, sellerCommissionSettings),
    [juriText, sellerCommissionSettings]
  );

  const previewItems = useMemo(
    () => buildPreviewItems(third, fourth, parsedJuri.entries, sellerCommissionSettings),
    [third, fourth, parsedJuri.entries, sellerCommissionSettings]
  );

  const previewSummary = useMemo(() => {
    const singleQty = previewItems
      .filter((item) => item.category !== "juri")
      .reduce((sum, item) => sum + item.qty, 0);
    const juriQty = previewItems
      .filter((item) => item.category === "juri")
      .reduce((sum, item) => sum + item.qty, 0);
    const total = previewItems.reduce((sum, item) => sum + item.total, 0);
    const commission = previewItems.reduce((sum, item) => sum + item.profit, 0);

    return {
      singleQty,
      juriQty,
      total,
      commission,
    };
  }, [previewItems]);
  const previewTicketLayout = useMemo(
    () => buildTicketLayout(previewItems),
    [previewItems]
  );

  const effectivePaidAmount = useMemo(() => {
    const numeric = sanitizeNumber(paidAmount);

    if (paymentMode === "Paid") {
      return previewSummary.total;
    }

    if (paymentMode === "Unpaid") {
      return 0;
    }

    return Math.min(numeric, previewSummary.total);
  }, [paidAmount, paymentMode, previewSummary.total]);

  const currentDue = Math.max(previewSummary.total - effectivePaidAmount, 0);

  const dashboardSummary = useMemo(() => {
    const todayTickets = activeTickets.filter((ticket) => ticket.date === todayString);

    return {
      collection: todayTickets.reduce((sum, ticket) => sum + ticket.total, 0),
      payout: todayTickets.reduce(
        (sum, ticket) => sum + getStoredResultInfo(ticket, winResults).payout,
        0
      ),
      commission: todayTickets.reduce((sum, ticket) => sum + ticket.commission, 0),
      outstanding: todayTickets.reduce((sum, ticket) => sum + ticket.dueAmount, 0),
      openTickets: todayTickets.filter((ticket) => !isLocked(ticket)).length,
      lockedTickets: todayTickets.filter((ticket) => isLocked(ticket)).length,
      claimedTickets: todayTickets.filter((ticket) => ticket.claimed).length,
    };
  }, [activeTickets, todayString, winResults]);

  const drawSummary = useMemo(() => {
    const todayTickets = activeTickets.filter((ticket) => ticket.date === todayString);

    return drawOptions.map((slot) => {
      const slotTickets = todayTickets.filter((ticket) => ticket.drawTime === slot.value);

      return {
        label: slot.label,
        count: slotTickets.length,
        sale: slotTickets.reduce((sum, ticket) => sum + ticket.total, 0),
        payout: slotTickets.reduce(
          (sum, ticket) => sum + getStoredResultInfo(ticket, winResults).payout,
          0
        ),
        result: winResults[buildResultKey(todayString, slot.value)] || "--",
      };
    });
  }, [activeTickets, todayString, winResults]);

  const filteredTickets = useMemo(() => {
    const query = ticketSearch.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesSearch =
        !query ||
        String(ticket.id).includes(query) ||
        safeLower(ticket.customerName).includes(query) ||
        safeLower(ticket.customerPhone).includes(query);

      const matchesFilter =
        ticketFilter === "ALL" ||
        getTicketStatus(ticket) === ticketFilter ||
        ticket.paymentMode === ticketFilter ||
        ticket.drawTime === ticketFilter;

      return matchesSearch && matchesFilter;
    });
  }, [ticketFilter, ticketSearch, tickets]);

  const reportMetrics = reportSummaryMap[reportRange] || emptyReportMetrics();

  const resultPreview = useMemo(
    () =>
      activeTickets
        .filter((ticket) => ticket.date === resultDate)
        .map((ticket) => {
          const resultInfo = getStoredResultInfo(ticket, winResults);
          return { ...ticket, resultInfo };
        })
        .filter((ticket) => ticket.resultInfo.payout > 0),
    [activeTickets, resultDate, winResults]
  );

  const claimableTickets = useMemo(
    () =>
      activeTickets
        .map((ticket) => ({
          ...ticket,
          resultInfo: getStoredResultInfo(ticket, winResults),
        }))
        .filter((ticket) => !ticket.claimed && ticket.resultInfo.payout > 0),
    [activeTickets, winResults]
  );

  const claimedTickets = useMemo(
    () =>
      activeTickets
        .filter((ticket) => ticket.claimed)
        .map((ticket) => ({
          ...ticket,
          resultInfo: getStoredResultInfo(ticket, winResults),
        })),
    [activeTickets, winResults]
  );

  const dueTickets = useMemo(
    () => activeTickets.filter((ticket) => ticket.dueAmount > 0),
    [activeTickets]
  );

  const updateSingle = (setter, index, value) => {
    setter((current) => {
      const next = [...current];
      next[index] = value.replace(/[^\d]/g, "");
      return next;
    });
  };

  const clearForm = () => {
    setThird(emptySingle());
    setFourth(emptySingle());
    setJuriText("");
    setCustomerName("");
    setCustomerPhone("");
    setDate(getNextValidBookingDate(todayString, "11:00"));
    setDrawTime("11:00");
    setEditingTicketId(null);
    setPaymentMode("Paid");
    setPaidAmount("");
  };

  const createTicket = async () => {
    if (previewItems.length === 0) {
      window.alert("Enter quantity first");
      return;
    }

    const currentTimestamp = new Date().toISOString();
    const nextTicket = {
      sellerUsername: session && session.username ? session.username : "",
      customerName: customerName.trim() || "Walk-in Customer",
      customerPhone: customerPhone.trim(),
      date: effectiveTicketDate,
      drawTime,
      paymentMode,
      paidAmount: effectivePaidAmount,
      dueAmount: currentDue,
      items: previewItems,
      total: previewSummary.total,
      commission: previewSummary.commission,
      claimed: false,
      payout: 0,
      winningNumber: "",
      cancelled: false,
      cancelledAt: "",
      updatedAt: currentTimestamp,
    };

    if (editingTicketId) {
      const editableTicket = tickets.find((ticket) => ticket.id === editingTicketId);

      if (!editableTicket) {
        window.alert("Ticket not found for editing");
        clearForm();
        return;
      }

      if (!canEditTicket(editableTicket)) {
        window.alert("This ticket is locked. You can only edit before draw time.");
        clearForm();
        return;
      }

      try {
        await updateTicketApi(editingTicketId, nextTicket);
      } catch (error) {
        window.alert(error.message || "Ticket update failed");
        return;
      }
    } else {
      try {
        await createTicketApi({
          id: Date.now(),
          ...nextTicket,
          createdAt: currentTimestamp,
        });
      } catch (error) {
        window.alert(error.message || "Ticket save failed");
        return;
      }
    }

    await syncSellerData({ forceApply: true });
    clearForm();
    setActiveTab("Ticket Store");
  };

  const saveWinNumber = async (slot) => {
    const rawValue = (resultDrafts[slot] || "").replace(/[^\d]/g, "").slice(0, 2);

    if (rawValue.length !== 2) {
      window.alert("Enter a valid 2 digit winning number");
      return;
    }

    const normalized = leftPad(rawValue, 2, "0");

    try {
      await saveResultApi({
        date: resultDate,
        drawTime: slot,
        winningNumber: normalized,
      });
      await syncSellerData({ forceApply: true });
    } catch (error) {
      window.alert(error.message || "Save win number failed");
    }
  };

  const clearWinNumber = async (slot) => {
    try {
      await clearResultApi({
        date: resultDate,
        drawTime: slot,
      });
      await syncSellerData({ forceApply: true });
      setResultDrafts((current) => ({ ...current, [slot]: "" }));
    } catch (error) {
      window.alert(error.message || "Clear win number failed");
    }
  };

  const claimTicket = async (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    if (ticket.cancelled) {
      window.alert("Cancelled ticket cannot be claimed");
      return;
    }

    if (ticket.claimed) {
      window.alert("Already claimed");
      return;
    }

    const resultInfo = getStoredResultInfo(ticket, winResults);

    if (!resultInfo.winningNumber) {
      window.alert("Add the win number first in Result Checker");
      return;
    }

    if (!resultInfo.payout) {
      window.alert("This ticket is not a winner");
      return;
    }

    try {
      await updateTicketApi(ticketId, {
        claimed: true,
        payout: resultInfo.payout,
        winningNumber: resultInfo.winningNumber,
      });
      window.alert(`Payout ₹${resultInfo.payout}`);
      await syncSellerData({ forceApply: true });
    } catch (error) {
      window.alert(error.message || "Claim update failed");
    }
  };

  const startEditTicket = (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    if (!canEditTicket(ticket)) {
      window.alert("Ticket is locked. Edit is allowed only before draw time.");
      return;
    }

    const formState = ticketToFormState(ticket);
    setThird(formState.third);
    setFourth(formState.fourth);
    setJuriText(formState.juriText);
    setCustomerName(ticket.customerName);
    setCustomerPhone(ticket.customerPhone);
    setDate(getNextValidBookingDate(ticket.date, ticket.drawTime));
    setDrawTime(ticket.drawTime);
    setPaymentMode(ticket.paymentMode);
    setPaidAmount(ticket.paymentMode === "Partial Paid" ? String(ticket.paidAmount || "") : "");
    setEditingTicketId(ticket.id);
    setActiveTab("New Ticket");
  };

  const cancelTicket = async (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    if (ticket.cancelled) {
      window.alert("Ticket already cancelled");
      return;
    }

    if (!canCancelTicket(ticket)) {
      window.alert("Ticket can only be cancelled before draw time.");
      return;
    }

    if (!window.confirm(`Cancel ticket #${ticket.id}?`)) {
      return;
    }

    try {
      await updateTicketApi(ticketId, {
        cancelled: true,
        cancelledAt: new Date().toISOString(),
      });
      await syncSellerData({ forceApply: true });
    } catch (error) {
      window.alert(error.message || "Cancel failed");
      return;
    }

    if (editingTicketId === ticketId) {
      clearForm();
    }
  };

  const printTicket = (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    const printWindow = window.open("", "_blank", "width=420,height=720");

    if (!printWindow) {
      window.alert("Allow pop-up to print ticket");
      return;
    }

    const ticketLayout = buildTicketLayout(ticket.items);
    const printMarkup = buildTicketPrintMarkup(ticket, ticketLayout);

    printWindow.document.open();
    printWindow.document.write(printMarkup);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  return (
    <div className="app">
      <div className="container">
        <div className="hero">
          <div className="hero-row">
            <div>
              <h1>Seller Panel</h1>
              <p>
                Daily ticket selling, cutoff lock, result checking, claim, due and print.
              </p>
            </div>
            <div className="hero-actions">
              {session && session.username ? (
                <div className="today-chip">Seller: {session.username}</div>
              ) : null}
              <div className="today-chip">Today: {todayString}</div>
              {syncMessage ? <div className="today-chip">{syncMessage}</div> : null}
              {onLogout ? (
                <button className="outline-btn hero-logout" onClick={onLogout}>
                  Logout
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="top-summary">
          <SummaryCard
            label="Today Collection"
            value={formatCurrency(dashboardSummary.collection)}
            hint="Active tickets only"
          />
          <SummaryCard
            label="Today Payout"
            value={formatCurrency(dashboardSummary.payout)}
            hint="Declared results"
          />
          <SummaryCard
            label="Commission"
            value={formatCurrency(dashboardSummary.commission)}
            hint="Seller margin"
          />
          <SummaryCard
            label="Outstanding Due"
            value={formatCurrency(dashboardSummary.outstanding)}
            hint="Unpaid + partial"
          />
          <SummaryCard
            label="Open Tickets"
            value={dashboardSummary.openTickets}
            hint="Unlocked"
          />
          <SummaryCard
            label="Locked Tickets"
            value={dashboardSummary.lockedTickets}
            hint="Past draw time"
          />
          <SummaryCard
            label="Claimed Tickets"
            value={dashboardSummary.claimedTickets}
            hint="Already claimed"
          />
        </div>

        <div className="glass-card">
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Dashboard" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Today Draw Summary</h2>
              <span>Daily sales, results and payout by draw slot.</span>
            </div>

            <div className="ticket-list">
              {drawSummary.map((slot) => (
                <div key={slot.label} className="saved-ticket">
                  <div className="saved-top">
                    <div>
                      <strong>{slot.label}</strong>
                      <span>{slot.count} ticket(s)</span>
                    </div>
                    <div className="saved-right">
                      <strong>{formatCurrency(slot.sale)}</strong>
                      <span>Payout {formatCurrency(slot.payout)}</span>
                    </div>
                  </div>
                  <p className="saved-line">Win Number: {slot.result}</p>
                </div>
              ))}
            </div>

            <div className="mini-summary">
              <MiniBox label="Today Sale" value={formatCurrency(dashboardSummary.collection)} />
              <MiniBox label="Commission" value={formatCurrency(dashboardSummary.commission)} />
              <MiniBox label="Outstanding Due" value={formatCurrency(dashboardSummary.outstanding)} />
            </div>
          </div>
        )}

        {activeTab === "New Ticket" && (
          <div className="workspace-grid ticket-workspace-grid">
            <div className="glass-card ticket-entry-card">
              <div className="section-header">
                <h2>{editingTicketId ? "Edit Ticket" : "Create New Ticket"}</h2>
                <span>
                  {editingTicketId
                    ? "Update the ticket before draw time. Locked tickets cannot be changed."
                    : "Enter 3rd House, 4th House and juri rows."}
                </span>
              </div>

              {editingTicketId ? (
                <div className="editing-banner">
                  <strong>Editing Ticket #{editingTicketId}</strong>
                  <span>You can still change or cancel it only until the selected draw time.</span>
                </div>
              ) : null}

              <div className="form-row three">
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Customer Name"
                  autoComplete="off"
                />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Customer Phone"
                  inputMode="numeric"
                  autoComplete="tel"
                />
                <input
                  type="date"
                  value={date}
                  onChange={(event) =>
                    setDate(getNextValidBookingDate(event.target.value, drawTime))
                  }
                />
              </div>

              <div className="form-row">
                <select
                  value={drawTime}
                  onChange={(event) => {
                    const nextDrawTime = event.target.value;
                    setDrawTime(nextDrawTime);
                    setDate((current) => getNextValidBookingDate(current, nextDrawTime));
                  }}
                >
                  {drawOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="booking-banner">
                <strong>Booking For: {effectiveTicketDate}</strong>
                <span>
                  {bookingDateAdjusted
                    ? `${formatDrawTime(drawTime)} draw is already over for ${date}. Ticket will go to ${effectiveTicketDate}.`
                    : `${formatDrawTime(drawTime)} draw is open for ${effectiveTicketDate}.`}
                </span>
              </div>

              <div className="input-layout">
                <HouseCard
                  title="3rd House"
                  values={third}
                  onChange={(index, value) => updateSingle(setThird, index, value)}
                />
                <HouseCard
                  title="4th House"
                  values={fourth}
                  onChange={(index, value) => updateSingle(setFourth, index, value)}
                />
              </div>

              <div className="glass-panel">
                <div className="panel-title-row">
                  <strong>Juri Bulk Entry</strong>
                  <span>Example: 45-5, 88-5, 04-10</span>
                </div>
                <textarea
                  className="bulk-textarea"
                  value={juriText}
                  onChange={(event) => setJuriText(event.target.value)}
                  placeholder="45-5, 88-5, 04-10"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {parsedJuri.invalid.length > 0 ? (
                  <p className="warning-line">
                    Ignored invalid entries: {parsedJuri.invalid.join(", ")}
                  </p>
                ) : (
                  <p className="success-line">All juri entries are valid.</p>
                )}
              </div>

              <div className="mini-summary">
                <MiniBox label="Single Qty" value={previewSummary.singleQty} />
                <MiniBox label="Juri Qty" value={previewSummary.juriQty} />
                <MiniBox
                  label="Ticket Sale"
                  value={formatCurrency(previewSummary.total)}
                  premium
                />
              </div>
            </div>

            <div className="glass-card ticket-save-card">
              <div className="section-header">
                <h2>Payment and Save</h2>
                <span>Select payment mode and save the ticket.</span>
              </div>

              <div className="form-row">
                <select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}>
                  <option value="Paid">Paid</option>
                  <option value="Partial Paid">Partial Paid</option>
                  <option value="Unpaid">Unpaid</option>
                </select>
              </div>

              <div className="form-row">
                <input
                  type="tel"
                  value={paidAmount}
                  onChange={(event) => setPaidAmount(event.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Paid Amount"
                  disabled={paymentMode !== "Partial Paid"}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>

              <div className="preview-grid compact">
                <PreviewBox label="Commission" value={formatCurrency(previewSummary.commission)} />
                <PreviewBox label="Paid" value={formatCurrency(effectivePaidAmount)} />
                <PreviewBox label="Due" value={formatCurrency(currentDue)} />
              </div>

              <div className="footer-actions ticket-save-actions">
                <button onClick={createTicket}>
                  {editingTicketId ? "Update Ticket" : "Save Ticket"}
                </button>
                <button className="outline-btn" onClick={clearForm}>
                  {editingTicketId ? "Close Edit" : "Reset"}
                </button>
              </div>

              <div className="entered-list ticket-entered-list">
                <div className="panel-title-row">
                  <strong>Entered Items</strong>
                  <span>{previewItems.length} item(s)</span>
                </div>
                {previewItems.length === 0 ? (
                  <p className="empty">No items yet.</p>
                ) : (
                  <TicketFormat layout={previewTicketLayout} />
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "Ticket Store" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Ticket Store</h2>
              <span>Search, filter, edit, cancel before cutoff and review every ticket from one place.</span>
            </div>

            <div className="status-guide">
              <MiniBox label="OPEN" value="Edit or cancel allowed" />
              <MiniBox label="LOCKED" value="Read only after draw time" />
              <MiniBox label="CANCELLED" value="Removed from active sale" />
            </div>

            <div className="action-bar">
              <input
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
                placeholder="Search by ticket, name, phone"
                autoComplete="off"
              />
              <select value={ticketFilter} onChange={(event) => setTicketFilter(event.target.value)}>
                <option value="ALL">ALL</option>
                <option value="OPEN">OPEN</option>
                <option value="LOCKED">LOCKED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="CLAIMED">CLAIMED</option>
                {drawOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="Paid">Paid</option>
                <option value="Partial Paid">Partial Paid</option>
                <option value="Unpaid">Unpaid</option>
              </select>
            </div>

            <div className="ticket-list">
              {filteredTickets.length === 0 ? (
                <p className="empty">No ticket found.</p>
              ) : (
                filteredTickets.map((ticket) => {
                  const resultInfo = getStoredResultInfo(ticket, winResults);
                  const ticketStatus = getTicketStatus(ticket);
                  const ticketLayout = buildTicketLayout(ticket.items);

                  return (
                    <div key={ticket.id} className="saved-ticket">
                      <div className="saved-top">
                        <div>
                          <strong>#{ticket.id}</strong>
                          <span>
                            {ticket.customerName} | {formatDrawTime(ticket.drawTime)} | {ticket.date}
                          </span>
                        </div>
                        <div className="saved-right">
                          <strong>{formatCurrency(ticket.total)}</strong>
                          <span className={`status-pill ${ticketStatus.toLowerCase()}`}>
                            {ticketStatus}
                          </span>
                        </div>
                      </div>

                      <p className="saved-line">
                        Payment: {ticket.paymentMode} | Paid {formatCurrency(ticket.paidAmount)} | Due{" "}
                        {formatCurrency(ticket.dueAmount)}
                      </p>
                      {ticket.cancelled ? (
                        <p className="saved-line">
                          Cancelled At: {formatDateTime(ticket.cancelledAt)} | Not counted in active sale,
                          claims or due.
                        </p>
                      ) : (
                        <p className="saved-line">
                          {ticketStatus === "LOCKED"
                            ? "Ticket is locked because draw time is over. Edit and cancel are disabled."
                            : "Ticket is open. You can still edit or cancel it before draw time."}
                        </p>
                      )}
                      <p className="saved-line">
                        Win Number: {resultInfo.winningNumber || "--"} | Potential Payout{" "}
                        {formatCurrency(resultInfo.payout)}
                      </p>
                      <TicketFormat layout={ticketLayout} compact />

                      <div className="inline-actions">
                        {canEditTicket(ticket) ? (
                          <button className="outline-btn" onClick={() => startEditTicket(ticket.id)}>
                            Edit
                          </button>
                        ) : null}
                        {canCancelTicket(ticket) ? (
                          <button className="outline-btn danger-btn" onClick={() => cancelTicket(ticket.id)}>
                            Cancel Ticket
                          </button>
                        ) : null}
                        {!ticket.cancelled && resultInfo.payout > 0 && !ticket.claimed ? (
                          <button onClick={() => claimTicket(ticket.id)}>Claim</button>
                        ) : null}
                        {!ticket.cancelled ? (
                          <button className="outline-btn" onClick={() => printTicket(ticket.id)}>
                            Print
                          </button>
                        ) : null}
                        {!ticket.cancelled ? (
                          <button className="outline-btn" onClick={() => setActiveTab("Result Checker")}>
                            Result Checker
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === "Reports" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Reports</h2>
              <span>Total sale, commission, payout and due for daily, weekly, monthly and yearly ranges.</span>
            </div>

            <div className="report-range-grid">
              {reportRanges.map((range) => (
                <button
                  key={range}
                  className={`report-range-btn ${reportRange === range ? "active" : ""}`}
                  onClick={() => setReportRange(range)}
                >
                  <span>{range}</span>
                  <strong>{formatCurrency((reportSummaryMap[range] || emptyReportMetrics()).sale)}</strong>
                </button>
              ))}
            </div>

            <div className="mini-summary report-grid">
              <MiniBox label="Total Sale" value={formatCurrency(reportMetrics.sale)} premium />
              <MiniBox label="Commission" value={formatCurrency(reportMetrics.commission)} />
              <MiniBox label="Payout" value={formatCurrency(reportMetrics.payout)} />
              <MiniBox label="Collection" value={formatCurrency(reportMetrics.collection)} />
              <MiniBox label="Outstanding Due" value={formatCurrency(reportMetrics.due)} />
              <MiniBox label="Claimed Payout" value={formatCurrency(reportMetrics.claimedPayout)} />
              <MiniBox label="Tickets" value={reportMetrics.ticketCount} />
              <MiniBox label="Winning Tickets" value={reportMetrics.winCount} />
              <MiniBox label="Claimed Tickets" value={reportMetrics.claimCount} />
            </div>

            <div className="report-panels">
              <div className="glass-panel">
                <div className="panel-title-row">
                  <strong>{reportRange} Payment Breakdown</strong>
                  <span>Paid, partial and unpaid summary</span>
                </div>
                <div className="report-list">
                  <div className="report-row">
                    <span>Paid Tickets</span>
                    <strong>{reportMetrics.paidCount}</strong>
                  </div>
                  <div className="report-row">
                    <span>Partial Paid</span>
                    <strong>{reportMetrics.partialCount}</strong>
                  </div>
                  <div className="report-row">
                    <span>Unpaid</span>
                    <strong>{reportMetrics.unpaidCount}</strong>
                  </div>
                  <div className="report-row">
                    <span>Average Sale</span>
                    <strong>{formatCurrency(reportMetrics.averageSale)}</strong>
                  </div>
                </div>
              </div>

              <div className="glass-panel">
                <div className="panel-title-row">
                  <strong>{reportRange} Draw Summary</strong>
                  <span>Sale, payout and commission by slot</span>
                </div>
                <div className="report-list">
                  {reportMetrics.slotSummary.map((slot) => (
                    <div key={`${reportRange}-${slot.label}`} className="report-slot-row">
                      <div>
                        <strong>{slot.label}</strong>
                        <span>{slot.count} ticket(s)</span>
                      </div>
                      <div className="saved-right">
                        <strong>{formatCurrency(slot.sale)}</strong>
                        <span>Comm. {formatCurrency(slot.commission)} | Payout {formatCurrency(slot.payout)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Result Checker" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Result Checker</h2>
              <span>Add win numbers by draw slot. Winning tickets update automatically after result entry.</span>
            </div>

            <div className="action-bar">
              <input
                type="date"
                value={resultDate}
                onChange={(event) => setResultDate(event.target.value)}
              />
            </div>

            <div className="result-grid">
              {drawOptions.map((option) => (
                <div key={`${resultDate}-${option.value}`} className="result-card">
                  <div className="result-card-top">
                    <div>
                      <strong>{option.label}</strong>
                      <span>Stored result: {winResults[buildResultKey(resultDate, option.value)] || "--"}</span>
                    </div>
                    <span className="result-tag">
                      {resultPreview.filter((ticket) => ticket.drawTime === option.value).length} winner(s)
                    </span>
                  </div>

                  <input
                    type="tel"
                    value={resultDrafts[option.value] || ""}
                    onChange={(event) =>
                      setResultDrafts((current) => ({
                        ...current,
                        [option.value]: event.target.value.replace(/[^\d]/g, "").slice(0, 2),
                      }))
                    }
                    placeholder="Win number"
                    inputMode="numeric"
                    autoComplete="off"
                  />

                  <div className="inline-actions">
                    <button onClick={() => saveWinNumber(option.value)}>Save Win Number</button>
                    <button className="outline-btn" onClick={() => clearWinNumber(option.value)}>
                      Clear
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="ticket-list">
              {resultPreview.length === 0 ? (
                <p className="empty">No winning tickets found for this date yet.</p>
              ) : (
                resultPreview.map((ticket) => (
                  <div key={`${ticket.id}-${ticket.resultInfo.winningNumber}`} className="saved-ticket">
                    <div className="saved-top">
                      <div>
                        <strong>#{ticket.id}</strong>
                        <span>
                          {ticket.customerName} | {formatDrawTime(ticket.drawTime)} | Win No. {ticket.resultInfo.winningNumber}
                        </span>
                      </div>
                      <div className="saved-right">
                        <strong>{formatCurrency(ticket.resultInfo.payout)}</strong>
                        <span>Auto result payout</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "Claims" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Winning Claims</h2>
              <span>Win number matched tickets appear here automatically after result entry.</span>
            </div>

            <div className="ticket-list">
              {claimableTickets.length === 0 ? (
                <p className="empty">No winning tickets ready for claim.</p>
              ) : (
                claimableTickets.map((ticket) => (
                  <div key={ticket.id} className="saved-ticket">
                    <div className="saved-top">
                      <div>
                        <strong>#{ticket.id}</strong>
                        <span>
                          {ticket.customerName} | {formatDrawTime(ticket.drawTime)} | Win No. {ticket.resultInfo.winningNumber}
                        </span>
                      </div>
                      <div className="saved-right">
                        <strong>{formatCurrency(ticket.resultInfo.payout)}</strong>
                        <span>Ready to claim</span>
                      </div>
                    </div>

                    <div className="inline-actions">
                      <button onClick={() => claimTicket(ticket.id)}>Mark Claimed</button>
                    </div>
                  </div>
                ))
              )}

              {claimedTickets.length > 0 && (
                <div className="glass-panel">
                  <div className="panel-title-row">
                    <strong>Claimed History</strong>
                    <span>{claimedTickets.length} ticket(s)</span>
                  </div>
                  <div className="report-list">
                    {claimedTickets.map((ticket) => (
                      <div key={`claimed-${ticket.id}`} className="report-slot-row">
                        <div>
                          <strong>#{ticket.id}</strong>
                          <span>{ticket.customerName} | Win No. {ticket.winningNumber || ticket.resultInfo.winningNumber || "--"}</span>
                        </div>
                        <div className="saved-right">
                          <strong>{formatCurrency(ticket.payout || ticket.resultInfo.payout)}</strong>
                          <span>Claimed</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "Due" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Due Management</h2>
              <span>Track unpaid and partially paid ticket amounts.</span>
            </div>

            <div className="ticket-list">
              {dueTickets.length === 0 ? (
                <p className="empty">No due records.</p>
              ) : (
                dueTickets.map((ticket) => (
                  <div key={ticket.id} className="saved-ticket">
                    <div className="saved-top">
                      <div>
                        <strong>{ticket.customerName}</strong>
                        <span>
                          #{ticket.id} | {formatDrawTime(ticket.drawTime)} | {ticket.date}
                        </span>
                      </div>
                      <div className="saved-right">
                        <strong>{formatCurrency(ticket.dueAmount)}</strong>
                        <span>Outstanding</span>
                      </div>
                    </div>

                    <p className="saved-line">
                      Total {formatCurrency(ticket.total)} | Paid {formatCurrency(ticket.paidAmount)} | Mode{" "}
                      {ticket.paymentMode}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function MiniBox({ label, value, premium = false }) {
  return (
    <div className={`mini-box ${premium ? "premium-mini" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewBox({ label, value }) {
  return (
    <div className="preview-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TicketFormat({ layout, compact = false }) {
  if (!layout.pairedRows.length && !layout.juriLines.length) {
    return null;
  }

  return (
    <div className={`ticket-format ${compact ? "compact-ticket-format" : ""}`}>
      <div className="ticket-format-grid">
        <div className="ticket-format-head">3rd</div>
        <div className="ticket-format-head">4th</div>
        {layout.pairedRows.length === 0 ? (
          <>
            <div className="ticket-format-cell empty-ticket-cell">--</div>
            <div className="ticket-format-cell empty-ticket-cell">--</div>
          </>
        ) : (
          layout.pairedRows.map((row, index) => (
            <React.Fragment key={`ticket-row-${index}`}>
              <div className={`ticket-format-cell ${!row.third ? "empty-ticket-cell" : ""}`}>
                {row.third || "--"}
              </div>
              <div className={`ticket-format-cell ${!row.fourth ? "empty-ticket-cell" : ""}`}>
                {row.fourth || "--"}
              </div>
            </React.Fragment>
          ))
        )}
      </div>

      {layout.juriLines.length > 0 ? (
        <div className="ticket-juri-block">
          <div className="ticket-format-head full-width-head">Juri</div>
          {layout.juriLines.map((line) => (
            <div key={line} className="ticket-juri-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {!compact ? (
        <div className="ticket-print-preview">
          <span>Ticket Print Format</span>
          <pre>{layout.printText}</pre>
        </div>
      ) : null}
    </div>
  );
}

function HouseCard({ title, values, onChange }) {
  return (
    <div className="glass-panel">
      <div className="panel-title-row">
        <strong>{title}</strong>
        <span>Tap quantity only</span>
      </div>
      <div className="single-grid">
        {values.map((value, index) => (
          <div key={`${title}-${index}`} className="single-box">
            <span>{index}</span>
            <input
              type="tel"
              value={value}
              onChange={(event) => onChange(index, event.target.value)}
              placeholder="0"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function parseJuriInput(input, commissionSettings) {
  const entries = [];
  const invalid = [];

  input
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      const match = token.match(/^(\d{2})-(\d+)$/);

      if (!match) {
        invalid.push(token);
        return;
      }

      const qty = Number(match[2]);

      if (!qty) {
        invalid.push(token);
        return;
      }

      entries.push({
        category: "juri",
        type: "juri",
        label: `Juri ${match[1]}`,
        num: match[1],
        qty,
        total: qty * JURI_RATE,
        profit: qty * commissionSettings.juri,
      });
    });

  return { entries, invalid };
}

function normalizeTickets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((ticket, index) => normalizeTicket(ticket, index)).filter(Boolean);
}

function normalizeTicket(ticket, index) {
  if (!ticket || typeof ticket !== "object") {
    return null;
  }

  const normalizedItems = normalizeItems(ticket.items);
  const computedTotal =
    typeof ticket.total === "number"
      ? ticket.total
      : normalizedItems.reduce((sum, item) => sum + item.total, 0);
  const computedCommission =
    typeof ticket.commission === "number"
      ? ticket.commission
      : normalizedItems.reduce((sum, item) => sum + item.profit, 0);

  return {
    id: ticket.id || Date.now() + index,
    customerName: typeof ticket.customerName === "string" ? ticket.customerName : "Walk-in Customer",
    customerPhone: typeof ticket.customerPhone === "string" ? ticket.customerPhone : "",
    date: typeof ticket.date === "string" ? ticket.date : getTodayString(),
    drawTime: typeof ticket.drawTime === "string" ? ticket.drawTime : "11:00",
    paymentMode: typeof ticket.paymentMode === "string" ? ticket.paymentMode : "Paid",
    paidAmount:
      typeof ticket.paidAmount === "number" ? ticket.paidAmount : sanitizeNumber(String(ticket.paidAmount || "")),
    dueAmount:
      typeof ticket.dueAmount === "number" ? ticket.dueAmount : sanitizeNumber(String(ticket.dueAmount || "")),
    items: normalizedItems,
    total: computedTotal,
    commission: computedCommission,
    claimed: Boolean(ticket.claimed),
    payout: typeof ticket.payout === "number" ? ticket.payout : 0,
    winningNumber: typeof ticket.winningNumber === "string" ? ticket.winningNumber : "",
    cancelled: Boolean(ticket.cancelled),
    cancelledAt: typeof ticket.cancelledAt === "string" ? ticket.cancelledAt : "",
    createdAt: typeof ticket.createdAt === "string" ? ticket.createdAt : new Date().toISOString(),
    updatedAt: typeof ticket.updatedAt === "string" ? ticket.updatedAt : "",
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const commissionSettings = getSellerCommissionSettings("");

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const qty = Number(item.qty) || 0;
      const type = typeof item.type === "string" ? item.type : inferItemType(item.category, item.label);
      const itemNumber =
        item.number !== undefined && item.number !== null
          ? item.number
          : item.digit !== undefined && item.digit !== null
            ? item.digit
            : "";
      const num =
        typeof item.num === "string"
          ? item.num
          : leftPad(String(itemNumber), type === "juri" ? 2 : 1, "0");

      if (!qty || !type || !num.trim()) {
        return null;
      }

      return {
        category: typeof item.category === "string" ? item.category : type,
        type,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label
            : buildItemLabel(type, num),
        num,
        qty,
        total:
          typeof item.total === "number"
            ? item.total
            : qty * (type === "juri" ? JURI_RATE : SINGLE_RATE),
        profit:
          typeof item.profit === "number"
            ? item.profit
            : qty *
              (type === "juri" ? commissionSettings.juri : commissionSettings.single),
      };
    })
    .filter(Boolean);
}

function inferItemType(category, label) {
  const source = `${category || ""} ${label || ""}`.toLowerCase();

  if (source.includes("juri")) {
    return "juri";
  }

  if (source.includes("4th")) {
    return "single4";
  }

  return "single3";
}

function buildItemLabel(type, num) {
  if (type === "juri") {
    return `Juri ${num}`;
  }

  if (type === "single4") {
    return `4th House ${num}`;
  }

  return `3rd House ${num}`;
}

function buildPreviewItems(third, fourth, juriEntries, commissionSettings) {
  const singleItems = [];

  third.forEach((qty, index) => {
    const numeric = Number(qty);

    if (!numeric) {
      return;
    }

    singleItems.push({
      category: "single3",
      type: "single3",
      label: `3rd House ${index}`,
      num: String(index),
      qty: numeric,
      total: numeric * SINGLE_RATE,
      profit: numeric * commissionSettings.single,
    });
  });

  fourth.forEach((qty, index) => {
    const numeric = Number(qty);

    if (!numeric) {
      return;
    }

    singleItems.push({
      category: "single4",
      type: "single4",
      label: `4th House ${index}`,
      num: String(index),
      qty: numeric,
      total: numeric * SINGLE_RATE,
      profit: numeric * commissionSettings.single,
    });
  });

  return [...singleItems, ...juriEntries];
}

function calculateTicketPayout(ticket, winningNumber) {
  return ticket.items.reduce((sum, item) => {
    if (item.type === "juri" && item.num === winningNumber) {
      return sum + item.qty * JURI_PAYOUT;
    }

    if (item.type === "single3" && item.num === winningNumber[0]) {
      return sum + item.qty * SINGLE_PAYOUT;
    }

    if (item.type === "single4" && item.num === winningNumber[1]) {
      return sum + item.qty * SINGLE_PAYOUT;
    }

    return sum;
  }, 0);
}

function getStoredResultInfo(ticket, winResults) {
  if (ticket.cancelled) {
    return {
      winningNumber: "",
      payout: 0,
    };
  }

  const winningNumber = winResults[buildResultKey(ticket.date, ticket.drawTime)] || "";
  return {
    winningNumber,
    payout: winningNumber ? calculateTicketPayout(ticket, winningNumber) : 0,
  };
}

function getTicketStatus(ticket) {
  if (ticket.cancelled) {
    return "CANCELLED";
  }

  if (ticket.claimed) {
    return "CLAIMED";
  }

  if (isLocked(ticket)) {
    return "LOCKED";
  }

  return "OPEN";
}

function canEditTicket(ticket) {
  return !ticket.cancelled && !ticket.claimed && !isLocked(ticket);
}

function canCancelTicket(ticket) {
  return !ticket.cancelled && !ticket.claimed && !isLocked(ticket);
}

function ticketToFormState(ticket) {
  const third = emptySingle();
  const fourth = emptySingle();
  const juriEntries = [];

  ticket.items.forEach((item) => {
    if (item.type === "single3") {
      third[Number(item.num)] = String(item.qty);
      return;
    }

    if (item.type === "single4") {
      fourth[Number(item.num)] = String(item.qty);
      return;
    }

    if (item.type === "juri") {
      juriEntries.push(`${item.num}-${item.qty}`);
    }
  });

  return {
    third,
    fourth,
    juriText: juriEntries.join(", "),
  };
}

function buildTicketLayout(items) {
  const thirdEntries = items
    .filter((item) => item.type === "single3")
    .sort((left, right) => Number(left.num) - Number(right.num))
    .map((item) => `${item.num}-${item.qty}`);

  const fourthEntries = items
    .filter((item) => item.type === "single4")
    .sort((left, right) => Number(left.num) - Number(right.num))
    .map((item) => `${item.num}-${item.qty}`);

  const pairedRows = Array.from(
    { length: Math.max(thirdEntries.length, fourthEntries.length) },
    (_, index) => ({
      third: thirdEntries[index] || "",
      fourth: fourthEntries[index] || "",
    })
  );

  const juriByQty = {};

  items
    .filter((item) => item.type === "juri")
    .sort((left, right) => Number(left.num) - Number(right.num))
    .forEach((item) => {
      const key = String(item.qty);
      const current = juriByQty[key] || [];
      current.push(item.num);
      juriByQty[key] = current;
    });

  const juriLines = Object.keys(juriByQty)
    .sort((left, right) => Number(left) - Number(right))
    .map((qty) => `${juriByQty[qty].join("-")} -${qty}`);

  const printLines = [];

  if (pairedRows.length > 0) {
    printLines.push(`${padPrintColumn("3rd")}${padPrintColumn("4th", false)}`);
    pairedRows.forEach((row) => {
      printLines.push(`${padPrintColumn(row.third || "--")}${padPrintColumn(row.fourth || "--", false)}`);
    });
  }

  if (juriLines.length > 0) {
    if (printLines.length > 0) {
      printLines.push("");
    }

    printLines.push("Juri");
    juriLines.forEach((line) => printLines.push(line));
  }

  return {
    pairedRows,
    juriLines,
    printText: printLines.join("\n") || "--",
  };
}

function padPrintColumn(value, pad = true) {
  return pad ? rightPad(String(value), 12, " ") : String(value);
}

function buildTicketPrintMarkup(ticket, layout) {
  const lines = [
    `Ticket #${ticket.id}`,
    `Customer: ${ticket.customerName || "Walk-in Customer"}`,
    `Phone: ${ticket.customerPhone || "--"}`,
    `Date: ${ticket.date}`,
    `Draw: ${formatDrawTime(ticket.drawTime)}`,
    `Payment: ${ticket.paymentMode}`,
    `Total: ${formatCurrency(ticket.total)}`,
    `Paid: ${formatCurrency(ticket.paidAmount)}`,
    `Due: ${formatCurrency(ticket.dueAmount)}`,
    "",
    layout.printText,
  ];

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ticket #${escapeHtml(String(ticket.id))}</title>
    <style>
      body {
        margin: 0;
        padding: 20px;
        font-family: "SF Mono", "Courier New", monospace;
        color: #111827;
        background: #ffffff;
      }
      .ticket-sheet {
        max-width: 360px;
        margin: 0 auto;
        border: 1px dashed #1f2937;
        padding: 18px;
      }
      h1 {
        margin: 0 0 14px;
        font-size: 22px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        line-height: 1.55;
        font-size: 15px;
      }
    </style>
  </head>
  <body>
    <div class="ticket-sheet">
      <h1>Customer Ticket</h1>
      <pre>${escapeHtml(lines.join("\n"))}</pre>
    </div>
  </body>
</html>`;
}

function emptyReportMetrics() {
  return {
    sale: 0,
    collection: 0,
    due: 0,
    commission: 0,
    payout: 0,
    claimedPayout: 0,
    ticketCount: 0,
    winCount: 0,
    claimCount: 0,
    paidCount: 0,
    partialCount: 0,
    unpaidCount: 0,
    averageSale: 0,
    slotSummary: drawOptions.map((slot) => ({
      label: slot.label,
      count: 0,
      sale: 0,
      commission: 0,
      payout: 0,
    })),
  };
}

function buildEmptyReportSummaryMap() {
  return reportRanges.reduce((accumulator, range) => {
    accumulator[range] = emptyReportMetrics();
    return accumulator;
  }, {});
}

function buildSyncSignature(value) {
  try {
    return JSON.stringify(value || null);
  } catch {
    return "";
  }
}

function isDateInRange(dateString, range, today) {
  const target = parseDateString(dateString);
  const current = parseDateString(today);

  if (!target || !current) {
    return false;
  }

  if (range === "Daily") {
    return isSameDate(target, current);
  }

  if (range === "Weekly") {
    const start = getWeekStart(current);
    return target >= start && target <= current;
  }

  if (range === "Monthly") {
    return (
      target.getFullYear() === current.getFullYear() &&
      target.getMonth() === current.getMonth()
    );
  }

  return target.getFullYear() === current.getFullYear();
}

function parseDateString(dateString) {
  const value = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function isSameDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getWeekStart(value) {
  const next = new Date(value);
  const diff = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

function getNextValidBookingDate(dateString, drawTime) {
  const today = parseDateString(getTodayString());
  let candidate = parseDateString(dateString) || today;

  if (candidate < today) {
    candidate = new Date(today);
  }

  while (isDrawClosedForDate(candidate, drawTime)) {
    candidate = addDays(candidate, 1);
  }

  return formatDate(candidate);
}

function isDrawClosedForDate(dateValue, drawTime) {
  const now = new Date();
  const drawMoment = new Date(`${formatDate(dateValue)}T${drawTime}:00`);
  return drawMoment <= now;
}

function addDays(dateValue, days) {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(dateValue) {
  const year = dateValue.getFullYear();
  const month = leftPad(String(dateValue.getMonth() + 1), 2, "0");
  const day = leftPad(String(dateValue.getDate()), 2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  const formatter = getIntlDateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return formatter ? formatter.format(parsed) : parsed.toLocaleString();
}

function sanitizeNumber(value) {
  return Number(value.replace(/[^\d]/g, "") || 0);
}

function buildResultDraftMap(defaultValue, dateValue, results) {
  return drawOptions.reduce((accumulator, option) => {
    const resultKey =
      dateValue && results ? results[buildResultKey(dateValue, option.value)] || defaultValue : defaultValue;
    accumulator[option.value] = resultKey;
    return accumulator;
  }, {});
}

function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function buildResultKey(date, drawTime) {
  return `${date}|${drawTime}`;
}

function getTodayString() {
  return formatDate(new Date());
}

function isLocked(ticket) {
  const now = new Date();
  const draw = new Date(`${ticket.date}T${ticket.drawTime}:00`);
  return now > draw;
}

function formatCurrency(value) {
  const formatter = getIntlNumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  return formatter ? formatter.format(value || 0) : `Rs ${Number(value || 0).toFixed(2)}`;
}

function formatDrawTime(value) {
  const match = drawOptions.find((option) => option.value === value);
  return match ? match.label : value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function leftPad(value, targetLength, fillCharacter) {
  let output = String(value);

  while (output.length < targetLength) {
    output = fillCharacter + output;
  }

  return output;
}

function rightPad(value, targetLength, fillCharacter) {
  let output = String(value);

  while (output.length < targetLength) {
    output += fillCharacter;
  }

  return output;
}

function getIntlDateTimeFormat(locale, options) {
  const globalIntl =
    typeof globalThis !== "undefined" && globalThis.Intl ? globalThis.Intl : null;

  return globalIntl ? new globalIntl.DateTimeFormat(locale, options) : null;
}

function getIntlNumberFormat(locale, options) {
  const globalIntl =
    typeof globalThis !== "undefined" && globalThis.Intl ? globalThis.Intl : null;

  return globalIntl ? new globalIntl.NumberFormat(locale, options) : null;
}

export default function App() {
  const [session, setSession] = useState(() => load(PANEL_SESSION_KEY, null));
  const [role, setRole] = useState("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState("");
  const [sellerSyncToken, setSellerSyncToken] = useState(0);

  useEffect(() => {
    let active = true;

    const loadBootstrapData = async () => {
      try {
        setBackendStatus("Connecting to backend...");
        const response = await fetchBootstrap();

        if (!active) {
          return;
        }

        save(SELLER_LIST_KEY, response.sellers || []);
        setSellerSyncToken((current) => current + 1);
        setBackendStatus("Backend connected");
      } catch {
        if (!active) {
          return;
        }

        setBackendStatus("Backend offline. Start `npm run server` first.");
      }
    };

    loadBootstrapData();

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      window.alert("Enter username and password");
      return;
    }

    try {
      setAuthLoading(true);
      const response = await loginApi({
        role,
        username: trimmedUsername,
        password: trimmedPassword,
      });
      const sellerResponse = await fetchSellersApi();
      const nextSession = response.session;

      save(SELLER_LIST_KEY, sellerResponse.sellers || []);
      setSellerSyncToken((current) => current + 1);
      save(PANEL_SESSION_KEY, nextSession);
      setSession(nextSession);
      setPassword("");
      setBackendStatus("Backend connected");
    } catch (error) {
      window.alert(error.message || "Login failed");
      setBackendStatus("Backend offline or login failed. Check `npm run server`.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(PANEL_SESSION_KEY);
    } catch {}

    setSession(null);
    setPassword("");
  };

  if (!session) {
    return (
      <LoginScreen
        role={role}
        setRole={setRole}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        onLogin={handleLogin}
        loading={authLoading}
        statusMessage={backendStatus}
      />
    );
  }

  if (session.role === "admin") {
    return <AdminPanel session={session} onLogout={handleLogout} />;
  }

  return <SellerPanel session={session} onLogout={handleLogout} sellerSyncToken={sellerSyncToken} />;
}
