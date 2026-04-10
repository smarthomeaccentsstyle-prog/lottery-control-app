import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import { load, save } from "./untils/storage.js";
import {
  AUTH_EXPIRED_EVENT,
  BACKEND_TIMEOUT_MESSAGE,
  BACKEND_UNAVAILABLE_MESSAGE,
  changePasswordApi,
  fetchBootstrap,
  fetchResultsApi,
  fetchReportSummaryApi,
  fetchSellersApi,
  fetchTicketsApi,
  loginApi,
  logoutApi,
  mapResultsToLookup,
  verifySessionApi,
  createTicketApi,
  updateTicketApi,
} from "./untils/api.js";
import LoginScreen from "./components/LoginScreen.js";
import AdminPanel from "./components/AdminPanel.js";
import MasterPanel from "./components/MasterPanel.js";
import SellerFastEntryBoard from "./components/SellerFastEntryBoard.js";
import TicketFormat from "./components/TicketFormat.js";
import {
  PANEL_SESSION_KEY,
  SELLER_LIST_KEY,
  SELLER_PANEL_STORAGE_KEY,
  getSellerCommissionSettings,
} from "./untils/adminStorage.js";
import {
  normalizeFastMode,
  normalizeSingleDraft,
  parseFastJuriText,
} from "./untils/fastEntry.js";

const SINGLE_RATE = 11;
const SINGLE_PAYOUT = 100;
const JURI_RATE = 10;
const JURI_PAYOUT = 600;

const tabs = [
  "New Ticket",
  "Ticket Store",
  "Claims",
  "Dashboard",
  "Results",
  "Reports",
  "Due",
  "Account",
];

const drawOptions = [
  { value: "11:00", label: "11:00 AM", cutoff: "11:10" },
  { value: "13:00", label: "1:00 PM", cutoff: "12:58" },
  { value: "15:00", label: "3:00 PM", cutoff: "15:10" },
  { value: "18:00", label: "6:00 PM", cutoff: "17:58" },
  { value: "19:00", label: "7:00 PM", cutoff: "19:10" },
  { value: "20:00", label: "8:00 PM", cutoff: "19:58" },
];

const reportRanges = ["Daily", "Weekly", "Monthly", "Yearly"];
const sellerMobileTabLabels = {
  Dashboard: "Home",
  "New Ticket": "New",
  "Ticket Store": "Store",
  Reports: "Reports",
  Claims: "Claims",
  Results: "Result",
  Due: "Due",
};
const sellerMobileDockTabs = [
  "New Ticket",
  "Ticket Store",
  "Claims",
  "Dashboard",
  "Results",
];

const emptySingle = () => Array(10).fill("");
const emptyPasswordChangeForm = () => ({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

function buildPreviewSummaryFromItems(items = []) {
  const safeItems = Array.isArray(items) ? items : [];

  return {
    singleQty: safeItems
      .filter((item) => item.category !== "juri")
      .reduce((sum, item) => sum + item.qty, 0),
    juriQty: safeItems
      .filter((item) => item.category === "juri")
      .reduce((sum, item) => sum + item.qty, 0),
    total: safeItems.reduce((sum, item) => sum + item.total, 0),
    commission: safeItems.reduce((sum, item) => sum + item.profit, 0),
  };
}

function calculateEffectivePaidAmount(total, paymentMode, paidAmount) {
  const numeric = sanitizeNumber(paidAmount);

  if (paymentMode === "Paid") {
    return total;
  }

  if (paymentMode === "Unpaid") {
    return 0;
  }

  return Math.min(numeric, total);
}

function buildEntryDraftSnapshot({ third, fourth, juriText, commissionSettings }) {
  const normalizedThird = normalizeSingleDraft(third);
  const normalizedFourth = normalizeSingleDraft(fourth);
  const normalizedJuriText = String(juriText || "");
  const parsedJuri = parseJuriInput(normalizedJuriText, commissionSettings);
  const items = buildPreviewItems(
    normalizedThird,
    normalizedFourth,
    parsedJuri.entries,
    commissionSettings
  );

  return {
    third: normalizedThird,
    fourth: normalizedFourth,
    juriText: normalizedJuriText,
    parsedJuri,
    items,
    summary: buildPreviewSummaryFromItems(items),
  };
}

function SellerPanel({ session, onLogout, sellerSyncToken }) {
  const defaultBookingSelection = useMemo(() => getNextAvailableDrawSelection(), []);
  const persisted = useMemo(
    () =>
      load(SELLER_PANEL_STORAGE_KEY, {
        tickets: [],
        winResults: {},
        third: emptySingle(),
        fourth: emptySingle(),
        juriText: "",
        activeEntryMode: "third",
        customerName: "",
        customerPhone: "",
        date: defaultBookingSelection.date,
        drawTime: defaultBookingSelection.drawTime,
        paymentMode: "Paid",
        paidAmount: "",
      }),
    [defaultBookingSelection.date, defaultBookingSelection.drawTime]
  );

  const [activeTab, setActiveTab] = useState("New Ticket");
  const [tickets, setTickets] = useState(() => normalizeTickets(persisted.tickets));
  const [winResults, setWinResults] = useState(persisted.winResults || {});
  const [third, setThird] = useState(() => normalizeSingleDraft(persisted.third));
  const [fourth, setFourth] = useState(() => normalizeSingleDraft(persisted.fourth));
  const [juriText, setJuriText] = useState(() => String(persisted.juriText || ""));
  const [customerName, setCustomerName] = useState(persisted.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(persisted.customerPhone || "");
  const [drawTime, setDrawTime] = useState(
    persisted.drawTime || defaultBookingSelection.drawTime
  );
  const [date, setDate] = useState(() =>
    getNextValidBookingDate(
      persisted.date || defaultBookingSelection.date,
      persisted.drawTime || defaultBookingSelection.drawTime
    )
  );
  const [editingTicketId, setEditingTicketId] = useState(null);
  const [paymentMode, setPaymentMode] = useState(persisted.paymentMode || "Paid");
  const [paidAmount, setPaidAmount] = useState(persisted.paidAmount || "");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketFilter, setTicketFilter] = useState("ALL");
  const [claimTicketSearch, setClaimTicketSearch] = useState("");
  const [claimDeskNotice, setClaimDeskNotice] = useState(null);
  const [resultDate, setResultDate] = useState(() => getTodayString());
  const [reportRange, setReportRange] = useState("Daily");
  const [syncMessage, setSyncMessage] = useState("");
  const [reportSummaryMap, setReportSummaryMap] = useState(() => buildEmptyReportSummaryMap());
  const [activeEntryMode, setActiveEntryMode] = useState(() =>
    normalizeFastMode(persisted.activeEntryMode)
  );
  const [lastSavedTicketId, setLastSavedTicketId] = useState(null);
  const [passwordForm, setPasswordForm] = useState(() => emptyPasswordChangeForm());
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [ticketActionNotice, setTicketActionNotice] = useState(null);
  const [entryUiToken, setEntryUiToken] = useState(0);
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
      third,
      fourth,
      juriText,
      activeEntryMode,
      customerName,
      customerPhone,
      date,
      drawTime,
      paymentMode,
      paidAmount,
    });
  }, [
    activeEntryMode,
    customerName,
    customerPhone,
    date,
    drawTime,
    fourth,
    juriText,
    paidAmount,
    paymentMode,
    third,
    tickets,
    winResults,
  ]);

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
  const currentEntryDraft = useMemo(
    () =>
      buildEntryDraftSnapshot({
        third,
        fourth,
        juriText,
        commissionSettings: sellerCommissionSettings,
      }),
    [fourth, juriText, sellerCommissionSettings, third]
  );
  const parsedJuri = currentEntryDraft.parsedJuri;
  const previewItems = currentEntryDraft.items;
  const previewSummary = currentEntryDraft.summary;
  const draftTicketLayout = useMemo(() => buildTicketLayout(previewItems), [previewItems]);

  const effectivePaidAmount = useMemo(
    () => calculateEffectivePaidAmount(previewSummary.total, paymentMode, paidAmount),
    [paidAmount, paymentMode, previewSummary.total]
  );

  const currentDue = Math.max(previewSummary.total - effectivePaidAmount, 0);
  const latestTicketSaveRef = useRef(null);

  latestTicketSaveRef.current = {
    currentEntryDraft,
    sellerCommissionSettings,
    editingTicketId,
    paymentMode,
    paidAmount,
    customerName,
    customerPhone,
    effectiveTicketDate,
    drawTime,
    tickets,
    sessionUsername: session && session.username ? session.username : "",
  };

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
  const effectiveResultDate = resultDate || todayString;
  const resultBoard = useMemo(
    () =>
      drawOptions.map((slot) => {
        const slotTickets = activeTickets.filter(
          (ticket) => ticket.date === effectiveResultDate && ticket.drawTime === slot.value
        );
        const resultNumber = winResults[buildResultKey(effectiveResultDate, slot.value)] || "";
        const winningTickets = resultNumber
          ? slotTickets.filter((ticket) => getStoredResultInfo(ticket, winResults).payout > 0)
          : [];
        const claimReadyTickets = winningTickets.filter((ticket) => !ticket.claimed);
        const claimedWinningTickets = winningTickets.filter((ticket) => ticket.claimed);
        const claimReadyPayout = claimReadyTickets.reduce(
          (sum, ticket) => sum + getStoredResultInfo(ticket, winResults).payout,
          0
        );

        let statusTone = "pending";
        let statusLabel = "Waiting";
        let statusMessage = "Waiting for admin result confirmation. Winning claims will open after confirm.";

        if (resultNumber) {
          if (claimReadyTickets.length > 0) {
            statusTone = "ready";
            statusLabel = "Claim Ready";
            statusMessage = `Admin confirmed result. ${claimReadyTickets.length} winning ticket(s) can be claimed now.`;
          } else if (claimedWinningTickets.length > 0) {
            statusTone = "claimed";
            statusLabel = "Claimed";
            statusMessage = `Admin confirmed result. All ${claimedWinningTickets.length} winning ticket(s) already claimed.`;
          } else {
            statusTone = "confirmed";
            statusLabel = "Confirmed";
            statusMessage = "Admin confirmed result. No winning tickets for this draw.";
          }
        }

        return {
          value: slot.value,
          label: slot.label,
          ticketCount: slotTickets.length,
          resultNumber,
          winnerCount: winningTickets.length,
          claimReadyCount: claimReadyTickets.length,
          claimedWinningCount: claimedWinningTickets.length,
          claimReadyPayout,
          statusTone,
          statusLabel,
          statusMessage,
        };
      }),
    [activeTickets, effectiveResultDate, winResults]
  );
  const resultBoardSummary = useMemo(
    () => ({
      confirmedCount: resultBoard.filter((slot) => Boolean(slot.resultNumber)).length,
      pendingCount: resultBoard.filter((slot) => !slot.resultNumber).length,
      claimReadyCount: resultBoard.reduce((sum, slot) => sum + slot.claimReadyCount, 0),
      claimReadyPayout: resultBoard.reduce((sum, slot) => sum + slot.claimReadyPayout, 0),
    }),
    [resultBoard]
  );

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
  const lastSavedTicket = useMemo(() => {
    if (!lastSavedTicketId) {
      return null;
    }

    return tickets.find((ticket) => String(ticket.id) === String(lastSavedTicketId)) || null;
  }, [lastSavedTicketId, tickets]);

  const reportMetrics = reportSummaryMap[reportRange] || emptyReportMetrics();

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
  const claimLookupValue = claimTicketSearch.trim();
  const claimLookupTicket = useMemo(() => {
    if (!claimLookupValue) {
      return null;
    }

    return tickets.find((ticket) => String(ticket.id) === claimLookupValue) || null;
  }, [claimLookupValue, tickets]);
  const claimLookupResultInfo = useMemo(() => {
    if (!claimLookupTicket) {
      return null;
    }

    return getStoredResultInfo(claimLookupTicket, winResults);
  }, [claimLookupTicket, winResults]);
  const claimLookupState = useMemo(() => {
    if (!claimLookupValue) {
      return null;
    }

    if (!claimLookupTicket) {
      return {
        tone: "missing",
        title: "Ticket not found",
        message: "Check the printed ticket ID and try again.",
      };
    }

    if (claimLookupTicket.cancelled) {
      return {
        tone: "blocked",
        title: "Cancelled ticket",
        message: "Cancelled ticket cannot be claimed.",
      };
    }

    if (claimLookupTicket.claimed) {
      return {
        tone: "claimed",
        title: "Already claimed",
        message: "One ticket ID can be claimed only once.",
      };
    }

    if (!claimLookupResultInfo || !claimLookupResultInfo.winningNumber) {
      return {
        tone: "pending",
        title: "Result not ready",
        message: "Admin result is not available yet for this ticket.",
      };
    }

    if (!claimLookupResultInfo.payout) {
      return {
        tone: "loss",
        title: "Sorry, next time.",
        message: "This ticket did not win for the selected result.",
      };
    }

    return {
      tone: "winner",
      title: "Winner found",
      message: "This ticket is ready for claim now.",
    };
  }, [claimLookupResultInfo, claimLookupTicket, claimLookupValue]);

  const dueTickets = useMemo(
    () => activeTickets.filter((ticket) => ticket.dueAmount > 0),
    [activeTickets]
  );
  const cancellableTicketCount = useMemo(
    () => activeTickets.filter((ticket) => canCancelTicket(ticket)).length,
    [activeTickets]
  );
  const pendingClaimAmount = useMemo(
    () =>
      claimableTickets.reduce((sum, ticket) => sum + Number(ticket.resultInfo.payout || 0), 0),
    [claimableTickets]
  );

  const buildResolvedEntryDraft = useCallback((draftOverride = null) => {
    const latest = latestTicketSaveRef.current || {};

    return draftOverride
      ? buildEntryDraftSnapshot({
          third: draftOverride.third,
          fourth: draftOverride.fourth,
          juriText: draftOverride.juriText,
          commissionSettings: latest.sellerCommissionSettings || sellerCommissionSettings,
        })
      : latest.currentEntryDraft || currentEntryDraft;
  }, [currentEntryDraft, sellerCommissionSettings]);

  const sellerPriorityActions = useMemo(
    () => [
      {
        title: "New Ticket",
        hint: `${formatDrawTime(drawTime)} for ${effectiveTicketDate}`,
        value: `${previewItems.length} item(s)`,
        action: () => setActiveTab("New Ticket"),
        active: activeTab === "New Ticket",
      },
      {
        title: "Cancel Tickets",
        hint: "Open ticket list before cutoff",
        value: `${cancellableTicketCount} open`,
        action: () => {
          setTicketFilter("OPEN");
          setActiveTab("Ticket Store");
        },
        active: activeTab === "Ticket Store",
      },
      {
        title: "Claim Tickets",
        hint: "Winning tickets ready now",
        value: `${claimableTickets.length} | ${formatCurrency(pendingClaimAmount)}`,
        action: () => setActiveTab("Claims"),
        active: activeTab === "Claims",
      },
    ],
    [
      activeTab,
      cancellableTicketCount,
      claimableTickets.length,
      drawTime,
      effectiveTicketDate,
      pendingClaimAmount,
      previewItems.length,
    ]
  );

  const clearForm = useCallback(() => {
    const nextSelection = getNextAvailableDrawSelection();
    setThird(emptySingle());
    setFourth(emptySingle());
    setJuriText("");
    setCustomerName("");
    setCustomerPhone("");
    setDate(nextSelection.date);
    setDrawTime(nextSelection.drawTime);
    setEditingTicketId(null);
    setPaymentMode("Paid");
    setPaidAmount("");
    setTicketActionNotice(null);
    setLastSavedTicketId(null);
    setEntryUiToken((current) => current + 1);
  }, []);

  const createTicket = useCallback(async (draftOverride = null) => {
    const latest = latestTicketSaveRef.current || {};
    const resolvedDraft = buildResolvedEntryDraft(draftOverride);
    const itemsToSave = resolvedDraft.items;
    const summaryToSave = resolvedDraft.summary;

    if (itemsToSave.length === 0) {
      setTicketActionNotice({
        tone: "warning",
        message: "Enter at least one ticket row before saving.",
      });
      return {
        ok: false,
        message: "Enter at least one ticket row before saving.",
      };
    }

    const editingId = latest.editingTicketId;
    const wasEditing = Boolean(editingId);
    const currentTimestamp = new Date().toISOString();
    const nextTicketId = editingId || Date.now();
    const paidAmountForTicket = calculateEffectivePaidAmount(
      summaryToSave.total,
      latest.paymentMode,
      latest.paidAmount
    );
    const dueAmountForTicket = Math.max(summaryToSave.total - paidAmountForTicket, 0);
    const nextTicket = {
      sellerUsername: latest.sessionUsername || "",
      customerName: String(latest.customerName || "").trim() || "Walk-in Customer",
      customerPhone: String(latest.customerPhone || "").trim(),
      date: latest.effectiveTicketDate,
      drawTime: latest.drawTime,
      paymentMode: latest.paymentMode,
      paidAmount: paidAmountForTicket,
      dueAmount: dueAmountForTicket,
      items: itemsToSave,
      total: summaryToSave.total,
      commission: summaryToSave.commission,
      claimed: false,
      payout: 0,
      winningNumber: "",
      cancelled: false,
      cancelledAt: "",
      updatedAt: currentTimestamp,
    };

    if (editingId) {
      const editableTicket = (latest.tickets || []).find((ticket) => ticket.id === editingId);

      if (!editableTicket) {
        setTicketActionNotice({
          tone: "warning",
          message: "Ticket not found for editing.",
        });
        clearForm();
        return {
          ok: false,
          message: "Ticket not found for editing.",
        };
      }

      if (!canEditTicket(editableTicket)) {
        setTicketActionNotice({
          tone: "warning",
          message: "This ticket is locked. Edit is allowed only before last entry time.",
        });
        clearForm();
        return {
          ok: false,
          message: "This ticket is locked. Edit is allowed only before last entry time.",
        };
      }

      try {
        await updateTicketApi(editingId, nextTicket);
      } catch (error) {
        const message = error.message || "Ticket update failed";
        setTicketActionNotice({
          tone: "warning",
          message,
        });
        return {
          ok: false,
          message,
        };
      }
    } else {
      try {
        await createTicketApi({
          id: nextTicketId,
          ...nextTicket,
          createdAt: currentTimestamp,
        });
      } catch (error) {
        const message = error.message || "Ticket save failed";
        setTicketActionNotice({
          tone: "warning",
          message,
        });
        return {
          ok: false,
          message,
        };
      }
    }

    await syncSellerData({ forceApply: true });
    clearForm();
    setLastSavedTicketId(wasEditing ? null : nextTicketId);
    setTicketActionNotice({
      tone: "success",
      message: wasEditing ? "Ticket updated. Ready for the next entry." : "Ticket saved. Ready for the next entry.",
    });
    setActiveTab(wasEditing ? "Ticket Store" : "New Ticket");
    return {
      ok: true,
      ticketId: nextTicketId,
      wasEditing,
    };
  }, [buildResolvedEntryDraft, clearForm, syncSellerData]);

  const claimTicket = async (ticketId, options = {}) => {
    const { silent = false } = options;
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      const message = "Ticket not found";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }

    if (ticket.cancelled) {
      const message = "Cancelled ticket cannot be claimed";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }

    if (ticket.claimed) {
      const message = "Already claimed";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }

    const resultInfo = getStoredResultInfo(ticket, winResults);

    if (!resultInfo.winningNumber) {
      const message = "Admin result is not available yet";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }

    if (!resultInfo.payout) {
      const message = "This ticket is not a winner";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }

    try {
      await updateTicketApi(ticketId, {
        claimed: true,
        payout: resultInfo.payout,
        winningNumber: resultInfo.winningNumber,
      });
      if (!silent) {
        window.alert(`Payout ₹${resultInfo.payout}`);
      }
      await syncSellerData({ forceApply: true });
      return {
        ok: true,
        payout: resultInfo.payout,
        winningNumber: resultInfo.winningNumber,
      };
    } catch (error) {
      const message = error.message || "Claim update failed";
      if (!silent) {
        window.alert(message);
      }
      return { ok: false, message };
    }
  };

  const handleClaimTicketSearchChange = (event) => {
    setClaimDeskNotice(null);
    setClaimTicketSearch(event.target.value.replace(/\D/g, ""));
  };

  const clearClaimDesk = () => {
    setClaimDeskNotice(null);
    setClaimTicketSearch("");
  };

  const claimTicketFromDesk = async () => {
    if (!claimLookupTicket || !claimLookupResultInfo || !claimLookupResultInfo.payout) {
      return;
    }

    const outcome = await claimTicket(claimLookupTicket.id, {
      silent: true,
    });

    if (outcome && outcome.ok) {
      setClaimDeskNotice({
        tone: "winner",
        title: "Claim completed",
        message: `Ticket #${claimLookupTicket.id} claimed for ${formatCurrency(outcome.payout)}.`,
      });
      setClaimTicketSearch("");
      return;
    }

    setClaimDeskNotice({
      tone: "blocked",
      title: "Claim failed",
      message: outcome && outcome.message ? outcome.message : "Claim update failed.",
    });
  };

  const startEditTicket = (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    if (!canEditTicket(ticket)) {
      window.alert("Ticket is locked. Edit is allowed only before last entry time.");
      return;
    }

    const formState = ticketToFormState(ticket);
    setLastSavedTicketId(null);
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
    setNewTicketEntryMethod("manual");
    setActiveEntryMode(
      formState.third.some(Boolean) ? "third" : formState.fourth.some(Boolean) ? "fourth" : "juri"
    );
    setTicketActionNotice(null);
    setEntryUiToken((current) => current + 1);
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
      window.alert("Ticket can only be cancelled before last entry time.");
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

  const handleSellerPasswordChange = async () => {
    const currentPassword = passwordForm.currentPassword.trim();
    const newPassword = passwordForm.newPassword.trim();
    const confirmPassword = passwordForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      window.alert("Current password, new password and confirm password are required");
      return;
    }

    if (newPassword.length < 4) {
      window.alert("New password must be at least 4 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      window.alert("New password and confirm password must match");
      return;
    }

    try {
      setPasswordLoading(true);
      await changePasswordApi({
        currentPassword,
        newPassword,
      });
      setPasswordForm(emptyPasswordChangeForm());
      window.alert("Seller password updated");
    } catch (error) {
      window.alert(error.message || "Password update failed");
    } finally {
      setPasswordLoading(false);
    }
  };

  const printTicket = (ticketId) => {
    const ticket = tickets.find((currentTicket) => currentTicket.id === ticketId);

    if (!ticket) {
      window.alert("Ticket not found");
      return;
    }

    openTicketPrintWindow(buildTicketPrintMarkup(ticket, buildTicketLayout(ticket.items)));
  };

  const printDraftTicket = () => {
    if (previewItems.length === 0) {
      window.alert("Enter at least one ticket row before printing.");
      return;
    }

    openTicketPrintWindow(
      buildTicketPrintMarkup(
        {
          id: "Draft",
          customerName: customerName.trim() || "Walk-in Customer",
          customerPhone: customerPhone.trim(),
          date: effectiveTicketDate,
          drawTime,
          paymentMode,
          total: previewSummary.total,
          paidAmount: effectivePaidAmount,
          dueAmount: currentDue,
        },
        draftTicketLayout,
        {
          documentTitle: "Draft Ticket",
          sheetTitle: "Ticket Preview",
          ticketLabel: "Draft Ticket",
        }
      )
    );
  };

  const openTicketPrintWindow = (printMarkup) => {
    const printWindow = window.open("", "_blank", "width=420,height=720");

    if (!printWindow) {
      window.alert("Allow pop-up to print ticket");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(printMarkup);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
    };
  };
  const isFocusedEntryView = activeTab === "New Ticket";
  return (
    <div className="app seller-app">
      <div className="container">
        {isFocusedEntryView ? (
          <div className="glass-card seller-speed-header">
            <div className="seller-speed-copy">
              <h1>Seller Panel</h1>
              <p>Fast mobile ticket entry with manual typing, live totals, and the same stable save flow.</p>
            </div>
            <div className="seller-speed-actions">
              <div className="seller-speed-switcher">
                <span>Section</span>
                <select
                  aria-label="Switch seller panel section"
                  value={activeTab}
                  onChange={(event) => setActiveTab(event.target.value)}
                >
                  {tabs.map((tab) => (
                    <option key={`speed-${tab}`} value={tab}>
                      {tab}
                    </option>
                  ))}
                </select>
              </div>
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
        ) : (
          <>
            <div className="hero">
              <div className="hero-row">
                <div>
                  <h1>Seller Panel</h1>
                  <p>
                    Mobile seller panel for ticket entry, results, claim, due and reprint.
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

            <div className="seller-priority-strip" aria-label="Seller priority actions">
              {sellerPriorityActions.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className={`seller-priority-card ${item.active ? "active" : ""}`}
                  onClick={item.action}
                >
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>

            <div className="glass-card seller-tabs-nav">
              <div className="mobile-tab-switcher">
                <span>Quick navigation</span>
                <select
                  aria-label="Switch seller panel section"
                  value={activeTab}
                  onChange={(event) => setActiveTab(event.target.value)}
                >
                  {tabs.map((tab) => (
                    <option key={`mobile-${tab}`} value={tab}>
                      {tab}
                    </option>
                  ))}
                </select>
              </div>

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
          </>
        )}

        {activeTab === "Dashboard" && (
          <>
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
          </>
        )}

        {activeTab === "Results" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Game Results</h2>
              <span>Only admin confirmed results appear here. After confirm, all winning claims become available in the claim desk.</span>
            </div>

            <div className="results-toolbar">
              <div className="result-date-card">
                <label htmlFor="seller-result-date">Result Date</label>
                <input
                  id="seller-result-date"
                  type="date"
                  value={effectiveResultDate}
                  onChange={(event) => setResultDate(event.target.value)}
                />
                <p>Choose any date to check each game result and claim readiness.</p>
              </div>

              <div className="mini-summary">
                <MiniBox label="Confirmed" value={resultBoardSummary.confirmedCount} />
                <MiniBox label="Claim Ready" value={resultBoardSummary.claimReadyCount} premium />
                <MiniBox label="Ready Payout" value={formatCurrency(resultBoardSummary.claimReadyPayout)} />
              </div>
            </div>

            <div className="result-grid">
              {resultBoard.map((slot) => (
                <div key={`${effectiveResultDate}-${slot.value}`} className={`result-card seller-result-card ${slot.statusTone}`}>
                  <div className="result-card-top">
                    <div>
                      <strong>{slot.label}</strong>
                      <span>{effectiveResultDate}</span>
                    </div>
                    <span className={`result-tag ${slot.statusTone}`}>{slot.statusLabel}</span>
                  </div>

                  <div className="result-number-display">{slot.resultNumber || "--"}</div>
                  <p className="result-note">{slot.statusMessage}</p>

                  <div className="result-meta-strip">
                    <div className="result-stat">
                      <span>Tickets</span>
                      <strong>{slot.ticketCount}</strong>
                    </div>
                    <div className="result-stat">
                      <span>Winners</span>
                      <strong>{slot.winnerCount}</strong>
                    </div>
                    <div className="result-stat">
                      <span>Claim Payout</span>
                      <strong>{formatCurrency(slot.claimReadyPayout)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "New Ticket" && (
          <>
            <div className="glass-card fast-entry-card">
              <SellerFastEntryBoard
                activeEntryMode={activeEntryMode}
                bookingDateAdjusted={bookingDateAdjusted}
                currentDue={currentDue}
                customerName={customerName}
                customerPhone={customerPhone}
                date={date}
                drawOptions={drawOptions}
                drawTime={drawTime}
                editingTicketId={editingTicketId}
                effectivePaidAmount={effectivePaidAmount}
                effectiveTicketDate={effectiveTicketDate}
                entryUiToken={entryUiToken}
                formatCurrency={formatCurrency}
                formatDrawTime={formatDrawTime}
                formatEntryCutoffTime={formatEntryCutoffTime}
                fourth={fourth}
                juriText={juriText}
                lastSavedTicket={lastSavedTicket}
                lastSavedTicketId={lastSavedTicketId}
                maxBookingDate={getLatestAllowedBookingDate()}
                onActiveEntryModeChange={setActiveEntryMode}
                onCustomerNameChange={setCustomerName}
                onCustomerPhoneChange={setCustomerPhone}
                onDateChange={(nextDate) =>
                  setDate(getNextValidBookingDate(nextDate, drawTime))
                }
                onDismissSavedTicket={() => setLastSavedTicketId(null)}
                onDrawTimeChange={(nextDrawTime) => {
                  setDrawTime(nextDrawTime);
                  setDate((current) => getNextValidBookingDate(current, nextDrawTime));
                }}
                onFourthChange={setFourth}
                onJuriTextChange={setJuriText}
                onPaidAmountChange={(nextValue) =>
                  setPaidAmount(nextValue.replace(/[^\d]/g, ""))
                }
                onPaymentModeChange={setPaymentMode}
                onPrintDraft={printDraftTicket}
                onPrintSavedTicket={() => printTicket(lastSavedTicketId)}
                onReset={clearForm}
                onSave={createTicket}
                onThirdChange={setThird}
                paidAmount={paidAmount}
                parsedJuri={parsedJuri}
                paymentMode={paymentMode}
                previewItems={previewItems}
                previewLayout={draftTicketLayout}
                previewSummary={previewSummary}
                third={third}
                ticketActionNotice={ticketActionNotice}
                todayString={todayString}
              />
            </div>
          </>
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

            <div className="action-bar seller-mobile-toolbar">
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
                            ? `Ticket is locked because last entry time ${formatEntryCutoffTime(ticket.drawTime)} is over. Edit and cancel are disabled.`
                            : `Ticket is open. You can still edit or cancel it before ${formatEntryCutoffTime(ticket.drawTime)}.`}
                        </p>
                      )}
                      <p className="saved-line">
                        Win Number: {resultInfo.winningNumber || "--"} | Potential Payout{" "}
                        {formatCurrency(resultInfo.payout)}
                      </p>
                      <TicketFormat layout={ticketLayout} compact />

                      <div className="inline-actions ticket-card-actions">
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
                            Reprint
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

        {activeTab === "Claims" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Claim By Ticket ID</h2>
              <span>Enter the printed ticket ID. Winning ticket can be claimed once, others show sorry next time.</span>
            </div>

            <div className="claims-workspace">
              <div className="claim-summary-grid">
                <MiniBox label="Ready Claims" value={claimableTickets.length} />
                <MiniBox label="Pending Payout" value={formatCurrency(pendingClaimAmount)} premium />
              </div>

              <div className="claim-desk-card">
                <label className="claim-input-label" htmlFor="claim-ticket-id">
                  Printed Ticket ID
                </label>
                <div className="claim-search-row">
                  <input
                    id="claim-ticket-id"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Enter printed ticket ID"
                    value={claimTicketSearch}
                    onChange={handleClaimTicketSearchChange}
                  />
                  <button type="button" className="outline-btn" onClick={clearClaimDesk}>
                    Clear ID
                  </button>
                </div>
                <p className="claim-helper-copy">
                  One ticket ID, one claim. If ticket does not win, seller sees sorry next time.
                </p>
              </div>

              {claimDeskNotice ? (
                <div className={`claim-status-card ${claimDeskNotice.tone}`}>
                  <div className="claim-status-top">
                    <div>
                      <span className={`claim-status-badge ${claimDeskNotice.tone}`}>
                        {claimDeskNotice.title}
                      </span>
                      <h3>{claimDeskNotice.title}</h3>
                      <p>{claimDeskNotice.message}</p>
                    </div>
                  </div>
                </div>
              ) : claimLookupState ? (
                <div className={`claim-status-card ${claimLookupState.tone}`}>
                  <div className="claim-status-top">
                    <div>
                      <span className={`claim-status-badge ${claimLookupState.tone}`}>
                        {claimLookupState.title}
                      </span>
                      <h3>
                        {claimLookupTicket ? `Ticket #${claimLookupTicket.id}` : "Claim Lookup"}
                      </h3>
                      <p>{claimLookupState.message}</p>
                    </div>
                    <div className="claim-status-value">
                      <strong>
                        {claimLookupResultInfo && claimLookupResultInfo.payout
                          ? formatCurrency(claimLookupResultInfo.payout)
                          : "--"}
                      </strong>
                      <span>Payout</span>
                    </div>
                  </div>

                  {claimLookupTicket ? (
                    <>
                      <div className="claim-status-grid">
                        <PreviewBox label="Customer" value={claimLookupTicket.customerName || "Walk-in Customer"} />
                        <PreviewBox label="Date" value={claimLookupTicket.date} />
                        <PreviewBox label="Draw" value={formatDrawTime(claimLookupTicket.drawTime)} />
                        <PreviewBox
                          label="Win Number"
                          value={
                            claimLookupResultInfo && claimLookupResultInfo.winningNumber
                              ? claimLookupResultInfo.winningNumber
                              : "--"
                          }
                        />
                      </div>

                      <TicketFormat layout={buildTicketLayout(claimLookupTicket.items)} compact />

                      {claimLookupState.tone === "winner" ? (
                        <div className="claim-status-actions">
                          <button type="button" onClick={claimTicketFromDesk}>
                            Claim Ticket
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="claim-empty-state">
                  <strong>Ready for fast claim</strong>
                  <span>Type the printed ticket ID to check winner, already claimed, or sorry next time.</span>
                </div>
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

        {activeTab === "Account" && (
          <div className="glass-card">
            <div className="section-header">
              <h2>Account Security</h2>
              <span>Change your own seller password here. If you forget the old password, ask admin to reset it.</span>
            </div>

            <div className="glass-panel">
              <div className="panel-title-row">
                <strong>Change Seller Password</strong>
                <span>{passwordLoading ? "Saving..." : session && session.username ? session.username : "Seller login"}</span>
              </div>

              <p className="security-note">
                Seller can change only with the current password. Forgot old password means admin must set a new one for that seller.
              </p>

              <div className="form-row">
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  placeholder="Current Password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="current-password"
                  spellCheck={false}
                />
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  placeholder="New Password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="Confirm New Password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>

              <div className="footer-actions">
                <button type="button" onClick={handleSellerPasswordChange}>
                  Save New Password
                </button>
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => setPasswordForm(emptyPasswordChangeForm())}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="seller-mobile-dock" aria-label="Seller quick navigation">
          {sellerMobileDockTabs.map((tab) => (
            <button
              key={`seller-dock-${tab}`}
              type="button"
              className={`seller-dock-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
            >
              {sellerMobileTabLabels[tab] || tab}
            </button>
          ))}
        </nav>
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

function parseJuriInput(input, commissionSettings) {
  const parsed = parseFastJuriText(input);

  return {
    entries: parsed.entries.map((item) => {
      const qty = Number(item.qty);

      return {
        category: "juri",
        type: "juri",
        label: `Juri ${item.num}`,
        num: item.num,
        qty,
        total: qty * JURI_RATE,
        profit: qty * commissionSettings.juri,
      };
    }),
    invalid: parsed.invalid,
  };
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
      const index = Number(item.num);
      third[index] = String((Number(third[index] || 0) || 0) + Number(item.qty || 0));
      return;
    }

    if (item.type === "single4") {
      const index = Number(item.num);
      fourth[index] = String((Number(fourth[index] || 0) || 0) + Number(item.qty || 0));
      return;
    }

    if (item.type === "juri") {
      juriEntries.push(`${item.num}-${item.qty}`);
    }
  });

  return {
    third,
    fourth,
    juriText: parseFastJuriText(juriEntries.join(", "))
      .entries
      .map((item) => `${item.num}-${item.qty}`)
      .join(", "),
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

function buildTicketPrintMarkup(ticket, layout, options = {}) {
  const ticketLabel = options.ticketLabel || `Ticket #${ticket.id}`;
  const documentTitle = options.documentTitle || ticketLabel;
  const sheetTitle = options.sheetTitle || "Customer Ticket";
  const lines = [
    ticketLabel,
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
    <title>${escapeHtml(documentTitle)}</title>
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
      <h1>${escapeHtml(sheetTitle)}</h1>
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

function getNextAvailableDrawSelection(baseDate = getTodayString()) {
  let candidate = parseDateString(baseDate) || parseDateString(getTodayString());

  while (candidate) {
    const nextOpenDraw = drawOptions.find(
      (option) => !isDrawClosedForDate(candidate, option.value)
    );

    if (nextOpenDraw) {
      return {
        date: formatDate(candidate),
        drawTime: nextOpenDraw.value,
      };
    }

    candidate = addDays(candidate, 1);
  }

  return {
    date: getTodayString(),
    drawTime: drawOptions[0].value,
  };
}

function getLatestAllowedBookingDate() {
  const today = parseDateString(getTodayString()) || new Date();
  return formatDate(addDays(today, 1));
}

function getNextValidBookingDate(dateString, drawTime) {
  const today = parseDateString(getTodayString());
  const tomorrow = parseDateString(getLatestAllowedBookingDate());
  let candidate = parseDateString(dateString) || today;

  if (candidate < today) {
    candidate = new Date(today);
  }

  if (candidate > tomorrow) {
    candidate = new Date(tomorrow);
  }

  if (isDrawClosedForDate(candidate, drawTime)) {
    candidate = new Date(tomorrow);
  }

  return formatDate(candidate);
}

function isDrawClosedForDate(dateValue, drawTime) {
  return getEntryCutoffMoment(dateValue, drawTime) <= new Date();
}

function getEntryCutoffMoment(dateValue, drawTime) {
  return new Date(`${formatDate(dateValue)}T${getEntryCutoffValue(drawTime)}:00`);
}

function getEntryCutoffValue(drawTime) {
  const match = drawOptions.find((option) => option.value === drawTime);
  return match && match.cutoff ? match.cutoff : drawTime;
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
  if (!ticket || !ticket.date || !ticket.drawTime) {
    return false;
  }

  const ticketDate = parseDateString(ticket.date);

  if (!ticketDate) {
    return false;
  }

  return new Date() > getEntryCutoffMoment(ticketDate, ticket.drawTime);
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

function formatEntryCutoffTime(value) {
  return formatTimeValue(getEntryCutoffValue(value));
}

function formatTimeValue(value) {
  const [hourText = "0", minuteText = "00"] = String(value || "").split(":");
  const hour = Number(hourText) || 0;
  const minute = leftPad(String(Number(minuteText) || 0), 2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minute} ${suffix}`;
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

function getAccessMode() {
  if (typeof window === "undefined" || !window.location) {
    return "seller";
  }

  const pathname = window.location.pathname.toLowerCase();

  if (pathname === "/krishna" || pathname.startsWith("/krishna/")) {
    return "master";
  }

  if (pathname.startsWith("/admin")) {
    return "admin";
  }

  return "seller";
}

function isBackendOfflineError(message) {
  return (
    message === BACKEND_UNAVAILABLE_MESSAGE ||
    message === BACKEND_TIMEOUT_MESSAGE
  );
}

export default function App() {
  const accessMode = getAccessMode();
  const [session, setSession] = useState(() => load(PANEL_SESSION_KEY, null));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState("");
  const [backendState, setBackendState] = useState("checking");
  const [sessionRestorePending, setSessionRestorePending] = useState(() =>
    Boolean(load(PANEL_SESSION_KEY, null))
  );
  const [sellerSyncToken, setSellerSyncToken] = useState(0);
  const hasSession = Boolean(session);
  const sessionToken = session && session.token ? session.token : "";

  const applyBootstrapData = useCallback((response) => {
    save(SELLER_LIST_KEY, response.sellers || []);
    setSellerSyncToken((current) => current + 1);
    setBackendState("ready");
    setBackendStatus("");
  }, []);

  const clearSavedSession = useCallback(() => {
    try {
      localStorage.removeItem(PANEL_SESSION_KEY);
    } catch {}

    setSessionRestorePending(false);
    setSession(null);
  }, []);

  const markBackendOffline = useCallback(
    (clearSessionOnFail = false) => {
      setBackendState("offline");
      setBackendStatus("Backend is offline. Start the server, then tap retry.");

      if (clearSessionOnFail) {
        clearSavedSession();
      }
    },
    [clearSavedSession]
  );

  useEffect(() => {
    let active = true;

    const loadBootstrapData = async () => {
      const shouldRestoreExistingSession = Boolean(
        session && session.role === accessMode && session.token
      );

      try {
        setBackendState("checking");
        setSessionRestorePending(shouldRestoreExistingSession);
        const response = await fetchBootstrap();

        if (!active) {
          return;
        }

        applyBootstrapData(response);

        if (hasSession) {
          if (!sessionToken) {
            setSessionRestorePending(false);
            clearSavedSession();
            setBackendStatus("Session expired. Please login again.");
            return;
          }

          const verifyResponse = await verifySessionApi();

          if (!active) {
            return;
          }

          save(PANEL_SESSION_KEY, verifyResponse.session);
          setSession(verifyResponse.session);
          setSessionRestorePending(false);
        } else {
          setSessionRestorePending(false);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setSessionRestorePending(false);

        if (isBackendOfflineError(error && error.message)) {
          markBackendOffline(true);
          return;
        }

        clearSavedSession();
        setBackendState("ready");
        setBackendStatus(
          error && error.message ? error.message : "Session expired. Please login again."
        );
      }
    };

    loadBootstrapData();

    return () => {
      active = false;
    };
  }, [applyBootstrapData, clearSavedSession, hasSession, markBackendOffline, sessionToken]);

  useEffect(() => {
    const handleAuthExpired = (event) => {
      clearSavedSession();
      setPassword("");
      setSessionRestorePending(false);
      setBackendState("ready");
      setBackendStatus(
        event && event.detail && event.detail.message
          ? event.detail.message
          : "Session expired. Please login again."
      );
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);

    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [clearSavedSession]);

  const handleRetry = async () => {
    try {
      setBackendState("checking");
      setSessionRestorePending(false);
      const response = await fetchBootstrap();
      applyBootstrapData(response);
    } catch {
      markBackendOffline(false);
    }
  };

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    let nextSession = null;

    if (!trimmedUsername || !trimmedPassword) {
      setBackendStatus("Enter username and password.");
      return;
    }

    try {
      setAuthLoading(true);
      setBackendStatus("");
      const response = await loginApi({
        role: accessMode,
        username: trimmedUsername,
        password: trimmedPassword,
      });
      nextSession = response.session;
      save(PANEL_SESSION_KEY, nextSession);

      if (accessMode === "admin" || accessMode === "master") {
        const sellerResponse = await fetchSellersApi();
        save(SELLER_LIST_KEY, sellerResponse.sellers || []);
      }

      setSellerSyncToken((current) => current + 1);
      setSession(nextSession);
      setPassword("");
      setSessionRestorePending(false);
      setBackendState("ready");
      setBackendStatus("");
    } catch (error) {
      if (nextSession) {
        clearSavedSession();
      }

      const message = error.message || "Login failed. Please try again.";
      setBackendStatus(message);
      setBackendState(isBackendOfflineError(message) ? "offline" : "ready");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {}

    clearSavedSession();
    setPassword("");
    setBackendStatus("");
  };

  useEffect(() => {
    setUsername("");
    setPassword("");
    setBackendStatus("");
  }, [accessMode]);

  useEffect(() => {
    if (session && session.role !== accessMode) {
      clearSavedSession();
    }
  }, [accessMode, clearSavedSession, session]);

  if (session && session.role === accessMode && sessionRestorePending) {
    return (
      <LoginScreen
        role={accessMode}
        username=""
        setUsername={setUsername}
        password=""
        setPassword={setPassword}
        onLogin={handleLogin}
        onRetry={backendState === "offline" ? handleRetry : undefined}
        loading
        statusMessage={backendStatus}
        restoringSession
        sessionLabel={session.sellerName || session.username || accessMode}
      />
    );
  }

  if (!session || backendState !== "ready" || session.role !== accessMode) {
    return (
      <LoginScreen
        role={accessMode}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        onLogin={handleLogin}
        onRetry={backendState === "offline" ? handleRetry : undefined}
        loading={authLoading || backendState === "checking"}
        statusMessage={backendStatus}
      />
    );
  }

  if (session.role === "admin") {
    return <AdminPanel session={session} onLogout={handleLogout} />;
  }

  if (session.role === "master") {
    return <MasterPanel session={session} onLogout={handleLogout} />;
  }

  return (
    <SellerPanel
      session={session}
      onLogout={handleLogout}
      sellerSyncToken={sellerSyncToken}
    />
  );
}
