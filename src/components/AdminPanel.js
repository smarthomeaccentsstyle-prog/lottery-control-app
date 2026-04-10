import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BrandMark from "./BrandMark.js";
import { save } from "../untils/storage.js";
import {
  changePasswordApi,
  createSellerApi,
  fetchAdminOverviewApi,
  fetchResultsApi,
  fetchRiskBoardApi,
  fetchSellerReportApi,
  fetchSellersApi,
  fetchTicketsApi,
  mapResultsToLookup,
  saveResultApi,
  updateSellerApi,
} from "../untils/api.js";
import {
  DEFAULT_SELLERS,
  SELLER_LIST_KEY,
  getStoredSellers,
} from "../untils/adminStorage.js";

const SINGLE_RATE = 11;
const SINGLE_PAYOUT = 100;
const JURI_RATE = 10;
const JURI_PAYOUT = 600;

const drawOptions = [
  { value: "11:00", label: "11:00 AM", cutoff: "11:10" },
  { value: "13:00", label: "1:00 PM", cutoff: "12:58" },
  { value: "15:00", label: "3:00 PM", cutoff: "15:10" },
  { value: "18:00", label: "6:00 PM", cutoff: "17:58" },
  { value: "19:00", label: "7:00 PM", cutoff: "19:10" },
  { value: "20:00", label: "8:00 PM", cutoff: "19:58" },
];

const adminSections = [
  { value: "Risk Board", label: "Risk Board", shortLabel: "Risk" },
  { value: "Seller Manage", label: "Seller Manage", shortLabel: "Sellers" },
  { value: "Reports", label: "Reports", shortLabel: "Reports" },
];

const emptySellerForm = {
  name: "",
  mobile: "",
  username: "",
  password: "",
  singleCommission: String(DEFAULT_SELLERS[0].singleCommission),
  juriCommission: String(DEFAULT_SELLERS[0].juriCommission),
};
const emptyAdminPasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export default function AdminPanel({ session, onLogout }) {
  const todayString = getTodayString();
  const [activeSection, setActiveSection] = useState("Risk Board");
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [selectedDrawTime, setSelectedDrawTime] = useState(() => getDefaultAdminDrawTime());
  const [winningNumber, setWinningNumber] = useState("");
  const [sellerForm, setSellerForm] = useState(emptySellerForm);
  const [editingSellerId, setEditingSellerId] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(DEFAULT_SELLERS[0].id);
  const [sellerReportDate, setSellerReportDate] = useState(getTodayString());
  const [sellerReportDrawTime, setSellerReportDrawTime] = useState("ALL");
  const [sellers, setSellers] = useState(getStoredSellers);
  const [sellerState, setSellerState] = useState({
    tickets: [],
    winResults: {},
  });
  const [sellerLoading, setSellerLoading] = useState(false);
  const [sellerReportLoading, setSellerReportLoading] = useState(false);
  const [adminPasswordForm, setAdminPasswordForm] = useState(emptyAdminPasswordForm);
  const [adminPasswordLoading, setAdminPasswordLoading] = useState(false);
  const [riskBoard, setRiskBoard] = useState(() => buildRiskBoard([]));
  const [dashboardSummary, setDashboardSummary] = useState(() =>
    buildAdminDashboard([], {})
  );
  const [sellerTodayReport, setSellerTodayReport] = useState(() =>
    emptySellerReport()
  );
  const [sellerFilteredReport, setSellerFilteredReport] = useState(() =>
    emptySellerReport()
  );
  const adminSyncRef = useRef({
    sellerStateSignature: "",
    sellersSignature: "",
    riskSignature: "",
    overviewSignature: "",
    interactionUntil: 0,
  });

  const markInteraction = useCallback((duration = 1800) => {
    adminSyncRef.current.interactionUntil = Date.now() + duration;
  }, []);

  const shouldPauseAdminRefresh = useCallback(() => {
    if (typeof document !== "undefined") {
      if (document.hidden) {
        return true;
      }

      const activeElement = document.activeElement;

      if (
        activeSection === "Seller Manage" &&
        activeElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName)
      ) {
        return true;
      }
    }

    if (sellerLoading || sellerReportLoading || adminPasswordLoading) {
      return true;
    }

    return Date.now() < adminSyncRef.current.interactionUntil;
  }, [activeSection, adminPasswordLoading, sellerLoading, sellerReportLoading]);

  const syncAdminData = useCallback(async ({ force = false } = {}) => {
    if (!force && shouldPauseAdminRefresh()) {
      return;
    }

    try {
      const [ticketsResponse, resultsResponse, sellersResponse] = await Promise.all([
        fetchTicketsApi(),
        fetchResultsApi(),
        fetchSellersApi(),
      ]);
      const nextSellerState = {
        tickets: normalizeAdminTickets(ticketsResponse.tickets || []),
        winResults: mapResultsToLookup(resultsResponse.results || []),
      };
      const nextSellers = sellersResponse.sellers || [];
      const sellerStateSignature = buildStateSignature(nextSellerState);
      const sellersSignature = buildStateSignature(nextSellers);

      if (adminSyncRef.current.sellerStateSignature !== sellerStateSignature) {
        adminSyncRef.current.sellerStateSignature = sellerStateSignature;
        setSellerState(nextSellerState);
      }

      if (adminSyncRef.current.sellersSignature !== sellersSignature) {
        adminSyncRef.current.sellersSignature = sellersSignature;
        setSellers(nextSellers);
      }
    } catch {
    }
  }, [shouldPauseAdminRefresh]);

  useEffect(() => {
    let active = true;

    const syncLoop = async () => {
      if (!active) {
        return;
      }

      await syncAdminData();
    };

    syncAdminData({ force: true });
    const intervalId = window.setInterval(syncLoop, 10000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [syncAdminData]);

  useEffect(() => {
    const handlePointerInteraction = () => {
      markInteraction(1800);
    };
    const handleScrollInteraction = () => {
      markInteraction(900);
    };

    window.addEventListener("pointerdown", handlePointerInteraction, { passive: true });
    window.addEventListener("touchstart", handlePointerInteraction, { passive: true });
    window.addEventListener("keydown", handlePointerInteraction);
    window.addEventListener("scroll", handleScrollInteraction, { passive: true });
    window.addEventListener("focusin", handlePointerInteraction, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerInteraction);
      window.removeEventListener("touchstart", handlePointerInteraction);
      window.removeEventListener("keydown", handlePointerInteraction);
      window.removeEventListener("scroll", handleScrollInteraction);
      window.removeEventListener("focusin", handlePointerInteraction, true);
    };
  }, [markInteraction]);

  useEffect(() => {
    save(SELLER_LIST_KEY, sellers);
  }, [sellers]);

  useEffect(() => {
    if (!selectedSellerId && sellers[0]) {
      setSelectedSellerId(sellers[0].id);
      return;
    }

    if (selectedSellerId && !sellers.find((seller) => seller.id === selectedSellerId) && sellers[0]) {
      setSelectedSellerId(sellers[0].id);
    }
  }, [selectedSellerId, sellers]);

  useEffect(() => {
    const storedResult =
      sellerState.winResults[buildResultKey(selectedDate, selectedDrawTime)] || "";
    setWinningNumber(storedResult);
  }, [selectedDate, selectedDrawTime, sellerState.winResults]);

  const activeTickets = useMemo(
    () => normalizeAdminTickets(sellerState.tickets).filter((ticket) => !ticket.cancelled),
    [sellerState.tickets]
  );
  const localDashboardSummary = useMemo(
    () => buildAdminDashboard(activeTickets, sellerState.winResults),
    [activeTickets, sellerState.winResults]
  );

  const selectedDrawTickets = useMemo(
    () =>
      activeTickets.filter(
        (ticket) => ticket.date === selectedDate && ticket.drawTime === selectedDrawTime
      ),
    [activeTickets, selectedDate, selectedDrawTime]
  );

  useEffect(() => {
    const localRiskBoard = buildRiskBoard(selectedDrawTickets);
    const localRiskSignature = buildStateSignature(localRiskBoard);

    if (activeSection !== "Risk Board") {
      if (adminSyncRef.current.riskSignature !== localRiskSignature) {
        adminSyncRef.current.riskSignature = localRiskSignature;
        setRiskBoard(localRiskBoard);
      }
      return undefined;
    }

    let active = true;

    const loadRiskBoard = async (force = false) => {
      if (!force && shouldPauseAdminRefresh()) {
        return;
      }

      try {
        const response = await fetchRiskBoardApi({
          date: selectedDate,
          drawTime: selectedDrawTime,
        });

        if (!active) {
          return;
        }

        const nextRiskBoard = normalizeRiskBoardResponse(response.riskBoard);
        const nextSignature = buildStateSignature(nextRiskBoard);

        if (adminSyncRef.current.riskSignature !== nextSignature) {
          adminSyncRef.current.riskSignature = nextSignature;
          setRiskBoard(nextRiskBoard);
        }
      } catch {
        if (active && adminSyncRef.current.riskSignature !== localRiskSignature) {
          adminSyncRef.current.riskSignature = localRiskSignature;
          setRiskBoard(localRiskBoard);
        }
      }
    };

    loadRiskBoard(true);
    const intervalId = window.setInterval(loadRiskBoard, 8000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeSection, selectedDate, selectedDrawTime, selectedDrawTickets, shouldPauseAdminRefresh]);

  const highestRisk = useMemo(
    () => ({
      third:
        riskBoard.highestRisk && riskBoard.highestRisk.third
          ? riskBoard.highestRisk.third
          : getHighestRiskRow(riskBoard.thirdRows),
      fourth:
        riskBoard.highestRisk && riskBoard.highestRisk.fourth
          ? riskBoard.highestRisk.fourth
          : getHighestRiskRow(riskBoard.fourthRows),
      juri:
        riskBoard.highestRisk && riskBoard.highestRisk.juri
          ? riskBoard.highestRisk.juri
          : getHighestRiskRow(riskBoard.juriRows),
    }),
    [riskBoard]
  );
  const resultPressureRows = useMemo(
    () =>
      buildResultPressureRows(
        riskBoard.thirdRows,
        riskBoard.fourthRows,
        riskBoard.juriRows,
        riskBoard.collection
      ),
    [riskBoard.collection, riskBoard.fourthRows, riskBoard.juriRows, riskBoard.thirdRows]
  );
  const urgentResultRows = useMemo(
    () => resultPressureRows.filter((row) => row.totalRisk > 0).slice(0, 6),
    [resultPressureRows]
  );
  const topJuriRows = useMemo(
    () => getTopRiskRows(riskBoard.juriRows, 8),
    [riskBoard.juriRows]
  );

  const payoutExposure = Number(
    typeof riskBoard.payoutExposure === "number" && riskBoard.payoutExposure > 0
      ? riskBoard.payoutExposure
      : resultPressureRows[0]
        ? resultPressureRows[0].totalRisk
        : 0
  );
  const estimatedProfitLoss = Number(
    typeof riskBoard.adminNet === "number"
      ? riskBoard.adminNet
      : riskBoard.collection - payoutExposure
  );
  const drawStatus = estimatedProfitLoss >= 0 ? "SAFE" : "LOSS";
  const selectedDrawResult =
    sellerState.winResults[buildResultKey(selectedDate, selectedDrawTime)] || "";

  useEffect(() => {
    const localOverviewSignature = buildStateSignature(localDashboardSummary);

    if (activeSection !== "Reports") {
      if (adminSyncRef.current.overviewSignature !== localOverviewSignature) {
        adminSyncRef.current.overviewSignature = localOverviewSignature;
        setDashboardSummary(localDashboardSummary);
      }
      return undefined;
    }

    let active = true;

    const loadOverview = async (force = false) => {
      if (!force && shouldPauseAdminRefresh()) {
        return;
      }

      try {
        const response = await fetchAdminOverviewApi();

        if (!active) {
          return;
        }

        const nextOverview = normalizeAdminOverview(response.overview);
        const nextSignature = buildStateSignature(nextOverview);

        if (adminSyncRef.current.overviewSignature !== nextSignature) {
          adminSyncRef.current.overviewSignature = nextSignature;
          setDashboardSummary(nextOverview);
        }
      } catch {
        if (active && adminSyncRef.current.overviewSignature !== localOverviewSignature) {
          adminSyncRef.current.overviewSignature = localOverviewSignature;
          setDashboardSummary(localDashboardSummary);
        }
      }
    };

    loadOverview(true);
    const intervalId = window.setInterval(loadOverview, 10000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeSection, localDashboardSummary, shouldPauseAdminRefresh]);

  const selectedSeller = useMemo(
    () => sellers.find((seller) => seller.id === selectedSellerId) || sellers[0] || null,
    [selectedSellerId, sellers]
  );

  useEffect(() => {
    setSellerReportDate(todayString);
    setSellerReportDrawTime("ALL");
    setSellerFilteredReport(emptySellerReport());
  }, [selectedSellerId, todayString]);

  const sellerTickets = useMemo(() => {
    if (!selectedSeller) {
      return [];
    }

    return activeTickets.filter(
      (ticket) =>
        String(ticket.sellerUsername || "").toLowerCase() ===
        String(selectedSeller.username || "").toLowerCase()
    );
  }, [activeTickets, selectedSeller]);

  const sellerTodayTickets = useMemo(
    () => sellerTickets.filter((ticket) => ticket.date === todayString),
    [sellerTickets, todayString]
  );

  useEffect(() => {
    let active = true;

    const loadSellerToday = async () => {
      if (!selectedSeller || !selectedSeller.username) {
        setSellerTodayReport(emptySellerReport());
        return;
      }

      try {
        const response = await fetchSellerReportApi({
          sellerUsername: selectedSeller.username,
          date: todayString,
          drawTime: "ALL",
        });

        if (!active) {
          return;
        }

        setSellerTodayReport(normalizeSellerReport(response.report, selectedSeller));
      } catch {
        if (active) {
          setSellerTodayReport(
            buildLocalSellerReport(selectedSeller, sellerTodayTickets, sellerState.winResults)
          );
        }
      }
    };

    loadSellerToday();

    return () => {
      active = false;
    };
  }, [selectedSeller, todayString, sellerTodayTickets, sellerState.winResults]);

  const sellerReportTickets = useMemo(
    () =>
      sellerTickets.filter(
        (ticket) =>
          ticket.date === sellerReportDate &&
          (sellerReportDrawTime === "ALL" || ticket.drawTime === sellerReportDrawTime)
      ),
    [sellerReportDate, sellerReportDrawTime, sellerTickets]
  );

  useEffect(() => {
    let active = true;

    const loadSellerReport = async () => {
      if (!selectedSeller || !selectedSeller.username) {
        setSellerFilteredReport(emptySellerReport());
        return;
      }

      try {
        setSellerReportLoading(true);
        const response = await fetchSellerReportApi({
          sellerUsername: selectedSeller.username,
          date: sellerReportDate,
          drawTime: sellerReportDrawTime,
        });

        if (!active) {
          return;
        }

        setSellerFilteredReport(normalizeSellerReport(response.report, selectedSeller));
      } catch {
        if (active) {
          setSellerFilteredReport(
            buildLocalSellerReport(selectedSeller, sellerReportTickets, sellerState.winResults)
          );
        }
      } finally {
        if (active) {
          setSellerReportLoading(false);
        }
      }
    };

    loadSellerReport();

    return () => {
      active = false;
    };
  }, [
    selectedSeller,
    sellerReportDate,
    sellerReportDrawTime,
    sellerReportTickets,
    sellerState.winResults,
  ]);

  const selectedDrawWinningTickets = useMemo(
    () =>
      activeTickets
        .filter(
          (ticket) => ticket.date === selectedDate && ticket.drawTime === selectedDrawTime
        )
        .map((ticket) => ({
          ...ticket,
          payout: getTicketPayoutForResult(
            ticket,
            sellerState.winResults[buildResultKey(selectedDate, selectedDrawTime)] || ""
          ),
        }))
        .filter((ticket) => ticket.payout > 0),
    [activeTickets, selectedDate, selectedDrawTime, sellerState.winResults]
  );

  const drawReportRows = useMemo(
    () =>
      drawOptions.map((option) => {
        const drawTickets = activeTickets.filter(
          (ticket) => ticket.date === todayString && ticket.drawTime === option.value
        );
        const resultNumber =
          sellerState.winResults[buildResultKey(todayString, option.value)] || "";
        const payout = drawTickets.reduce(
          (sum, ticket) => sum + getTicketPayoutForResult(ticket, resultNumber),
          0
        );
        const sale = drawTickets.reduce((sum, ticket) => sum + ticket.total, 0);
        const adminCollection = drawTickets.reduce(
          (sum, ticket) => sum + ticket.total - ticket.commission,
          0
        );

        return {
          drawTime: option.value,
          label: option.label,
          tickets: drawTickets.length,
          sale,
          adminCollection,
          payout,
          resultNumber: resultNumber || "--",
        };
      }),
    [activeTickets, sellerState.winResults, todayString]
  );

  const sellerPerformanceRows = useMemo(
    () =>
      sellers
        .map((seller) => {
          const tickets = activeTickets.filter(
            (ticket) =>
              String(ticket.sellerUsername || "").toLowerCase() ===
              String(seller.username || "").toLowerCase()
          );

          return {
            seller,
            summary: buildSellerSummary(seller, tickets, sellerState.winResults),
          };
        })
        .sort((left, right) => right.summary.sale - left.summary.sale),
    [activeTickets, sellerState.winResults, sellers]
  );

  const handleSaveResult = async () => {
    const sanitized = leftPad(winningNumber.replace(/[^\d]/g, "").slice(0, 2), 2, "0");

    if (sanitized.length !== 2) {
      window.alert("Enter a valid 2 digit win number");
      return;
    }

    try {
      await saveResultApi({
        date: selectedDate,
        drawTime: selectedDrawTime,
        winningNumber: sanitized,
      });
      await syncAdminData({ force: true });
      setWinningNumber(sanitized);
      window.alert("Result saved");
    } catch (error) {
      window.alert(error.message || "Result save failed");
    }
  };

  const handleSaveSeller = async () => {
    const trimmedPassword = sellerForm.password.trim();
    const trimmed = {
      name: sellerForm.name.trim(),
      mobile: sellerForm.mobile.trim(),
      username: sellerForm.username.trim(),
      singleCommission: sanitizeDecimal(sellerForm.singleCommission),
      juriCommission: sanitizeDecimal(sellerForm.juriCommission),
    };

    if (!trimmed.name || !trimmed.username || (!editingSellerId && !trimmedPassword)) {
      window.alert("Name, username and password are required");
      return;
    }

    if (trimmed.singleCommission <= 0 || trimmed.juriCommission <= 0) {
      window.alert("Set valid single and juri commission");
      return;
    }

    const duplicate = sellers.find(
      (seller) =>
        seller.username.toLowerCase() === trimmed.username.toLowerCase() &&
        seller.id !== editingSellerId
    );

    if (duplicate) {
      window.alert("Username already exists");
      return;
    }

    try {
      setSellerLoading(true);

      const response = editingSellerId
        ? await updateSellerApi(editingSellerId, {
            ...trimmed,
            ...(trimmedPassword ? { password: trimmedPassword } : {}),
          })
        : await createSellerApi({
            ...trimmed,
            password: trimmedPassword,
            active: true,
          });

      adminSyncRef.current.sellersSignature = buildStateSignature(response.sellers || []);
      setSellers(response.sellers || []);
      if (editingSellerId) {
        setSelectedSellerId(editingSellerId);
      } else if (response.sellers && response.sellers.length > 0) {
        setSelectedSellerId(response.sellers[response.sellers.length - 1].id);
      }
    } catch (error) {
      window.alert(error.message || "Seller save failed");
      setSellerLoading(false);
      return;
    } finally {
      setSellerLoading(false);
    }

    setSellerForm(emptySellerForm);
    setEditingSellerId(null);
  };

  const startSellerEdit = (seller) => {
    setEditingSellerId(seller.id);
    setSellerForm({
      name: seller.name,
      mobile: seller.mobile,
      username: seller.username,
      password: "",
      singleCommission: String(seller.singleCommission),
      juriCommission: String(seller.juriCommission),
    });
    setSelectedSellerId(seller.id);
    setActiveSection("Seller Manage");
  };

  const toggleSellerActive = async (sellerId) => {
    const currentSeller = sellers.find((seller) => seller.id === sellerId);

    if (!currentSeller) {
      return;
    }

    try {
      setSellerLoading(true);
      const response = await updateSellerApi(sellerId, {
        active: !currentSeller.active,
      });
      adminSyncRef.current.sellersSignature = buildStateSignature(response.sellers || []);
      setSellers(response.sellers || []);
    } catch (error) {
      window.alert(error.message || "Seller update failed");
    } finally {
      setSellerLoading(false);
    }
  };

  const handleAdminPasswordChange = async () => {
    const currentPassword = adminPasswordForm.currentPassword.trim();
    const newPassword = adminPasswordForm.newPassword.trim();
    const confirmPassword = adminPasswordForm.confirmPassword.trim();

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
      setAdminPasswordLoading(true);
      await changePasswordApi({
        currentPassword,
        newPassword,
      });
      setAdminPasswordForm(emptyAdminPasswordForm);
      window.alert("Admin password updated");
    } catch (error) {
      window.alert(error.message || "Admin password update failed");
    } finally {
      setAdminPasswordLoading(false);
    }
  };

  const activeSellerCount = sellers.filter((seller) => seller.active).length;
  const selectedDrawWinningPayout = selectedDrawWinningTickets.reduce(
    (sum, ticket) => sum + ticket.payout,
    0
  );
  const selectedDrawSellerCount = new Set(
    selectedDrawTickets.map((ticket) => String(ticket.sellerUsername || "").toLowerCase())
  ).size;

  return (
    <div className="app admin-app">
      <div className="admin-shell admin-shell-compact">
        <div className="glass-card admin-command-center">
          <div className="admin-command-top">
            <div className="admin-brand">
              <BrandMark size="md" tagline="Premium ticket control system" />
              <span className="admin-chip">Admin</span>
              <h1>Risk Control</h1>
              <p>
                Main work stays on three screens only: risk board, seller manage, and reports.
              </p>
            </div>

            <div className="admin-command-actions">
              <div className="admin-command-pill">User: {session.username}</div>
              <div className="admin-command-pill">Today: {todayString}</div>
              <button className="outline-btn admin-logout" onClick={onLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="admin-priority-strip" aria-label="Admin quick actions">
            <button
              type="button"
              className={`admin-priority-card ${activeSection === "Risk Board" ? "active" : ""}`}
              onClick={() => setActiveSection("Risk Board")}
            >
              <span>Risk Board</span>
              <strong>{formatDrawTime(selectedDrawTime)}</strong>
              <small>{formatCurrency(payoutExposure)} exposure</small>
            </button>
            <button
              type="button"
              className={`admin-priority-card ${activeSection === "Seller Manage" ? "active" : ""}`}
              onClick={() => setActiveSection("Seller Manage")}
            >
              <span>Seller Manage</span>
              <strong>{activeSellerCount} active</strong>
              <small>{sellers.length} seller account(s)</small>
            </button>
            <button
              type="button"
              className={`admin-priority-card ${activeSection === "Reports" ? "active" : ""}`}
              onClick={() => setActiveSection("Reports")}
            >
              <span>Reports</span>
              <strong>{formatCurrency(dashboardSummary.adminCollection)}</strong>
              <small>Admin collection snapshot</small>
            </button>
          </div>

          <div className="admin-mobile-switcher">
            <span>Quick navigation</span>
            <select
              aria-label="Switch admin section"
              value={activeSection}
              onChange={(event) => setActiveSection(event.target.value)}
            >
              {adminSections.map((item) => (
                <option key={`mobile-${item.value}`} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-menu admin-section-menu">
            {adminSections.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`admin-menu-btn ${activeSection === item.value ? "active" : ""}`}
                onClick={() => setActiveSection(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <main className="admin-content admin-content-stack">
          {activeSection === "Risk Board" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Risk Board</h2>
                <span>Choose one draw, see the biggest danger instantly, and save the result from the same screen.</span>
              </div>

              <div className="admin-risk-toolbar">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />

                <div className="admin-draw-chip-row" role="tablist" aria-label="Choose draw time">
                  {drawOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`admin-draw-chip ${selectedDrawTime === option.value ? "active" : ""}`}
                      onClick={() => setSelectedDrawTime(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="admin-risk-headline">
                <strong>
                  {selectedDate} | {formatDrawTime(selectedDrawTime)}
                </strong>
                <span>
                  Result {selectedDrawResult || "--"} | Status {drawStatus} | Cutoff {formatTimeValue(getEntryCutoffValue(selectedDrawTime))} | {selectedDrawTickets.length} ticket(s)
                </span>
              </div>

              <div className="mini-summary admin-summary-grid admin-risk-summary-grid">
                <MiniStatCard
                  label="Admin Collection"
                  value={formatCurrency(riskBoard.collection)}
                  accent
                />
                <MiniStatCard
                  label="Payout Exposure"
                  value={formatCurrency(payoutExposure)}
                  status={payoutExposure > riskBoard.collection ? "danger" : "warning"}
                />
                <MiniStatCard
                  label="Admin Net"
                  value={formatCurrency(estimatedProfitLoss)}
                  status={estimatedProfitLoss >= 0 ? "safe" : "danger"}
                />
                <MiniStatCard label="Winning Tickets" value={selectedDrawWinningTickets.length} />
                <MiniStatCard label="Sellers In Draw" value={selectedDrawSellerCount} />
              </div>

              <ResultPressureBoard
                rows={urgentResultRows}
                collectionValue={riskBoard.collection}
              />

              <div className="admin-highlight-grid">
                <HighlightCard
                  title="Highest 3rd"
                  value={`${highestRisk.third.number} | ${formatCurrency(highestRisk.third.payoutRisk)}`}
                  tone={getRiskTone(highestRisk.third.payoutRisk, riskBoard.collection)}
                />
                <HighlightCard
                  title="Highest 4th"
                  value={`${highestRisk.fourth.number} | ${formatCurrency(highestRisk.fourth.payoutRisk)}`}
                  tone={getRiskTone(highestRisk.fourth.payoutRisk, riskBoard.collection)}
                />
                <HighlightCard
                  title="Highest Juri"
                  value={`${highestRisk.juri.number} | ${formatCurrency(highestRisk.juri.payoutRisk)}`}
                  tone={getRiskTone(highestRisk.juri.payoutRisk, riskBoard.collection)}
                />
              </div>

              <div className="glass-panel admin-result-panel">
                <div className="panel-title-row">
                  <strong>Result Update</strong>
                  <span>Same draw, same screen, one save action.</span>
                </div>

                <div className="action-bar admin-result-actions">
                  <input
                    type="tel"
                    value={winningNumber}
                    onChange={(event) =>
                      setWinningNumber(event.target.value.replace(/[^\d]/g, "").slice(0, 2))
                    }
                    inputMode="numeric"
                    placeholder="2 digit result"
                  />
                  <button type="button" onClick={handleSaveResult}>
                    Save Result
                  </button>
                </div>

                <div className="report-list">
                  <div className="report-row">
                    <span>Stored Result</span>
                    <strong>{selectedDrawResult || "--"}</strong>
                  </div>
                  <div className="report-row">
                    <span>Winning Tickets</span>
                    <strong>{selectedDrawWinningTickets.length}</strong>
                  </div>
                  <div className="report-row">
                    <span>Winning Payout</span>
                    <strong>{formatCurrency(selectedDrawWinningPayout)}</strong>
                  </div>
                </div>
              </div>

              <RiskSection
                title="3rd House"
                rows={riskBoard.thirdRows}
                collectionValue={riskBoard.collection}
              />
              <RiskSection
                title="4th House"
                rows={riskBoard.fourthRows}
                collectionValue={riskBoard.collection}
              />
              <JuriMiniBoard
                rows={riskBoard.juriRows}
                topRows={topJuriRows}
                collectionValue={riskBoard.collection}
              />
            </div>
          )}

          {activeSection === "Seller Manage" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Seller Manage</h2>
                <span>Pick a seller, review today activity, and see report details without extra show or hide steps.</span>
              </div>

              <div className="workspace-grid admin-manage-grid">
                <div className="glass-panel admin-seller-focus-panel">
                  <div className="panel-title-row">
                    <strong>{selectedSeller ? `${selectedSeller.name} Snapshot` : "Seller Snapshot"}</strong>
                    <span>
                      {selectedSeller
                        ? `${selectedSeller.username} | ${selectedSeller.mobile || "No mobile"}`
                        : "Choose a seller from the list"}
                    </span>
                  </div>

                  {selectedSeller ? (
                    <>
                      <div className="glass-panel seller-dashboard-hero admin-seller-hero">
                        <div>
                          <span className="seller-dashboard-kicker">Today Seller Summary</span>
                          <h3>{selectedSeller.name}</h3>
                          <p className="seller-dashboard-meta">
                            {selectedSeller.username} | {selectedSeller.mobile || "No mobile"} | Single Comm. {selectedSeller.singleCommission} | Juri Comm. {selectedSeller.juriCommission}
                          </p>
                        </div>

                        <div className="seller-dashboard-tags">
                          <span className={`status-pill ${selectedSeller.active ? "open" : "cancelled"}`}>
                            {selectedSeller.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                          <span className="status-pill claimed">
                            {sellerTodayReport.ticketCount} Today Tickets
                          </span>
                        </div>
                      </div>

                      <div className="mini-summary admin-summary-grid seller-summary-grid">
                        <MiniStatCard label="Today Seller Sale" value={formatCurrency(sellerTodayReport.sale)} accent />
                        <MiniStatCard label="Today Admin" value={formatCurrency(sellerTodayReport.adminCollection)} />
                        <MiniStatCard label="Today Comm." value={formatCurrency(sellerTodayReport.commission)} />
                        <MiniStatCard label="Today Payout" value={formatCurrency(sellerTodayReport.payout)} />
                        <MiniStatCard label="Today Admin Net" value={formatCurrency(sellerTodayReport.adminProfitLoss)} status={sellerTodayReport.adminProfitLoss >= 0 ? "safe" : "danger"} />
                      </div>

                      <div className="mini-summary admin-summary-grid seller-summary-grid">
                        <MiniStatCard label="Today Qty" value={sellerTodayReport.totalQty} />
                        <MiniStatCard label="Today Open" value={sellerTodayReport.openTickets} />
                        <MiniStatCard label="Today Locked" value={sellerTodayReport.lockedTickets} />
                        <MiniStatCard label="Today Claimed" value={sellerTodayReport.claimedTickets} />
                        <MiniStatCard label="Today Due" value={formatCurrency(sellerTodayReport.customerDue)} status={sellerTodayReport.customerDue > 0 ? "warning" : "safe"} />
                      </div>

                      <div className="glass-panel">
                        <div className="panel-title-row">
                          <strong>Seller Report</strong>
                          <span>Auto refreshes when you change seller, date, or draw.</span>
                        </div>

                        <div className="action-bar seller-report-actions">
                          <input
                            type="date"
                            value={sellerReportDate}
                            onChange={(event) => setSellerReportDate(event.target.value)}
                          />
                          <select
                            value={sellerReportDrawTime}
                            onChange={(event) => setSellerReportDrawTime(event.target.value)}
                          >
                            <option value="ALL">All Draws</option>
                            {drawOptions.map((option) => (
                              <option key={`seller-report-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {sellerReportLoading ? (
                          <p className="empty">Loading seller report...</p>
                        ) : sellerFilteredReport.ticketCount === 0 ? (
                          <p className="empty">No seller data found for this report filter.</p>
                        ) : (
                          <>
                            <div className="mini-summary admin-summary-grid seller-summary-grid">
                              <MiniStatCard label="Report Seller Sale" value={formatCurrency(sellerFilteredReport.sale)} accent />
                              <MiniStatCard label="Report Admin" value={formatCurrency(sellerFilteredReport.adminCollection)} />
                              <MiniStatCard label="Report Qty" value={sellerFilteredReport.totalQty} />
                              <MiniStatCard label="Report Tickets" value={sellerFilteredReport.ticketCount} />
                              <MiniStatCard label="Report Due" value={formatCurrency(sellerFilteredReport.customerDue)} status={sellerFilteredReport.customerDue > 0 ? "warning" : "safe"} />
                            </div>

                            <div className="ticket-list">
                              {sellerFilteredReport.tickets.map((ticket) => (
                                <div key={`seller-report-${ticket.id}`} className="saved-ticket">
                                  <div className="saved-top">
                                    <div>
                                      <strong>#{ticket.id}</strong>
                                      <span>
                                        {ticket.date} | {formatDrawTime(ticket.drawTime)}
                                      </span>
                                    </div>
                                    <div className="saved-right">
                                      <span className={`status-pill ${ticket.statusTone}`}>
                                        {ticket.statusLabel}
                                      </span>
                                    </div>
                                  </div>

                                  <p className="saved-line">
                                    Seller {formatCurrency(ticket.total)} | Admin {formatCurrency(ticket.adminCollection)} | Qty {ticket.totalQty} | Paid {formatCurrency(ticket.paidAmount)} | Due {formatCurrency(ticket.dueAmount)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="empty">No seller selected.</p>
                  )}
                </div>

                <div className="glass-panel admin-seller-list-panel">
                  <div className="panel-title-row">
                    <strong>Seller List</strong>
                    <span>{activeSellerCount} active seller(s)</span>
                  </div>

                  <div className="ticket-list">
                    {sellers.map((seller) => (
                      <div
                        key={seller.id}
                        className={`saved-ticket admin-seller-card ${selectedSeller && seller.id === selectedSeller.id ? "selected" : ""}`}
                      >
                        <div className="saved-top">
                          <div>
                            <strong>{seller.name}</strong>
                            <span>{seller.username} | {seller.mobile || "No mobile"}</span>
                          </div>
                          <div className="saved-right">
                            <span className={`status-pill ${seller.active ? "open" : "cancelled"}`}>
                              {seller.active ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </div>
                        </div>

                        <p className="saved-line">
                          Single Comm. {seller.singleCommission} | Juri Comm. {seller.juriCommission}
                        </p>

                        <div className="inline-actions">
                          <button
                            type="button"
                            className={`outline-btn ${selectedSeller && seller.id === selectedSeller.id ? "admin-selected-btn" : ""}`}
                            onClick={() => setSelectedSellerId(seller.id)}
                          >
                            {selectedSeller && seller.id === selectedSeller.id ? "Opened" : "Open"}
                          </button>
                          <button type="button" className="outline-btn" onClick={() => startSellerEdit(seller)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="outline-btn"
                            onClick={() => toggleSellerActive(seller.id)}
                          >
                            {seller.active ? "Pause" : "Activate"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-panel admin-seller-form-panel">
                  <div className="panel-title-row">
                    <strong>{editingSellerId ? "Edit Seller" : "Add Seller"}</strong>
                    <span>{sellerLoading ? "Saving..." : "Fast account setup"}</span>
                  </div>

                  <p className="security-note">
                    Seller can change a password only from the seller account screen with the current password.
                    If seller forgets it, admin can type a new password here while editing that seller.
                  </p>

                  <div className="form-row">
                    <input
                      value={sellerForm.name}
                      onChange={(event) =>
                        setSellerForm((current) => ({ ...current, name: event.target.value }))
                      }
                      autoCapitalize="words"
                      autoCorrect="off"
                      placeholder="Name"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={sellerForm.mobile}
                      onChange={(event) =>
                        setSellerForm((current) => ({ ...current, mobile: event.target.value }))
                      }
                      placeholder="Mobile"
                    />
                    <input
                      value={sellerForm.username}
                      onChange={(event) =>
                        setSellerForm((current) => ({
                          ...current,
                          username: event.target.value,
                        }))
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Username"
                    />
                    <input
                      type="password"
                      value={sellerForm.password}
                      onChange={(event) =>
                        setSellerForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={
                        editingSellerId
                          ? "Leave blank to keep current password"
                          : "Password"
                      }
                    />
                    <input
                      value={sellerForm.singleCommission}
                      onChange={(event) =>
                        setSellerForm((current) => ({
                          ...current,
                          singleCommission: event.target.value.replace(/[^\d.]/g, ""),
                        }))
                      }
                      placeholder="Single Commission"
                    />
                    <input
                      value={sellerForm.juriCommission}
                      onChange={(event) =>
                        setSellerForm((current) => ({
                          ...current,
                          juriCommission: event.target.value.replace(/[^\d.]/g, ""),
                        }))
                      }
                      placeholder="Juri Commission"
                    />
                  </div>

                  <div className="footer-actions">
                    <button type="button" onClick={handleSaveSeller}>
                      {editingSellerId ? "Update Seller" : "Add Seller"}
                    </button>
                    <button
                      type="button"
                      className="outline-btn"
                      onClick={() => {
                        setEditingSellerId(null);
                        setSellerForm(emptySellerForm);
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  <div className="admin-security-divider" />

                  <div className="panel-title-row">
                    <strong>Admin Password</strong>
                    <span>{adminPasswordLoading ? "Saving..." : "Change with current password"}</span>
                  </div>

                  <p className="security-note">
                    Admin can change the password here only with the current password.
                    If admin forgets the old password, reset it only from Master Panel.
                  </p>

                  <div className="form-row">
                    <input
                      type="password"
                      value={adminPasswordForm.currentPassword}
                      onChange={(event) =>
                        setAdminPasswordForm((current) => ({
                          ...current,
                          currentPassword: event.target.value,
                        }))
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="current-password"
                      spellCheck={false}
                      placeholder="Current Admin Password"
                    />
                    <input
                      type="password"
                      value={adminPasswordForm.newPassword}
                      onChange={(event) =>
                        setAdminPasswordForm((current) => ({
                          ...current,
                          newPassword: event.target.value,
                        }))
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder="New Admin Password"
                    />
                    <input
                      type="password"
                      value={adminPasswordForm.confirmPassword}
                      onChange={(event) =>
                        setAdminPasswordForm((current) => ({
                          ...current,
                          confirmPassword: event.target.value,
                        }))
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder="Confirm New Admin Password"
                    />
                  </div>

                  <div className="footer-actions">
                    <button type="button" onClick={handleAdminPasswordChange}>
                      Save Admin Password
                    </button>
                    <button
                      type="button"
                      className="outline-btn"
                      onClick={() => setAdminPasswordForm(emptyAdminPasswordForm)}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "Reports" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Reports</h2>
                <span>Keep reports simple: admin totals at the top, today by draw, then seller performance below.</span>
              </div>

              <div className="mini-summary admin-summary-grid admin-report-summary-grid">
                <MiniStatCard label="Total Sale" value={formatCurrency(dashboardSummary.sale)} accent />
                <MiniStatCard label="Admin Collection" value={formatCurrency(dashboardSummary.adminCollection)} />
                <MiniStatCard label="Actual Payout" value={formatCurrency(dashboardSummary.payout)} />
                <MiniStatCard label="Seller Comm." value={formatCurrency(dashboardSummary.commission)} />
                <MiniStatCard label="Outstanding" value={formatCurrency(dashboardSummary.outstanding)} status={dashboardSummary.outstanding > 0 ? "warning" : "safe"} />
                <MiniStatCard
                  label="Admin Profit / Loss"
                  value={formatCurrency(dashboardSummary.profitLoss)}
                  status={dashboardSummary.profitLoss >= 0 ? "safe" : "danger"}
                />
              </div>

              <div className="report-panels admin-report-grid">
                <div className="glass-panel">
                  <div className="panel-title-row">
                    <strong>Today By Draw</strong>
                    <span>{todayString}</span>
                  </div>

                  <div className="report-list">
                    {drawReportRows.map((row) => (
                      <div key={`admin-draw-report-${row.drawTime}`} className="report-slot-row">
                        <div>
                          <strong>{row.label}</strong>
                          <span>{row.tickets} ticket(s) | Result {row.resultNumber}</span>
                        </div>
                        <div className="saved-right">
                          <strong>{formatCurrency(row.adminCollection)}</strong>
                          <span>Sale {formatCurrency(row.sale)} | Payout {formatCurrency(row.payout)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-panel">
                  <div className="panel-title-row">
                    <strong>Seller Performance</strong>
                    <span>Sorted by seller sale</span>
                  </div>

                  <div className="report-list">
                    {sellerPerformanceRows.map(({ seller, summary }) => (
                      <div key={`seller-performance-${seller.id}`} className="report-slot-row">
                        <div>
                          <strong>{seller.name}</strong>
                          <span>
                            {seller.username} | {seller.active ? "Active" : "Inactive"} | {summary.ticketCount} ticket(s)
                          </span>
                        </div>
                        <div className="saved-right">
                          <strong>{formatCurrency(summary.sale)}</strong>
                          <span>Admin {formatCurrency(summary.adminCollection)} | Due {formatCurrency(summary.customerDue)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        <nav className="admin-mobile-dock" aria-label="Admin quick navigation">
          {adminSections.map((item) => (
            <button
              key={`admin-dock-${item.value}`}
              type="button"
              className={`admin-dock-btn ${activeSection === item.value ? "active" : ""}`}
              onClick={() => setActiveSection(item.value)}
              aria-current={activeSection === item.value ? "page" : undefined}
            >
              {item.shortLabel}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function ResultPressureBoard({ rows, collectionValue }) {
  const highestRow = rows[0] || createEmptyResultPressureRow(collectionValue);

  return (
    <div className="admin-risk-command-grid">
      <div
        className={`glass-panel admin-risk-command-card ${
          highestRow.totalRisk ? `admin-highlight-${highestRow.tone}` : ""
        }`}
      >
        <div className="panel-title-row">
          <strong>Highest Result Effect</strong>
          <span>{getResultBufferText(highestRow.totalRisk, collectionValue)}</span>
        </div>

        <div className="admin-risk-command-hero">
          <strong>{highestRow.number}</strong>
          <span>{formatCurrency(highestRow.totalRisk)}</span>
        </div>

        <p className="admin-risk-command-copy">
          3rd {highestRow.firstDigit} {formatCompactCurrency(highestRow.thirdRisk)} | 4th{" "}
          {highestRow.secondDigit} {formatCompactCurrency(highestRow.fourthRisk)} | Juri{" "}
          {highestRow.number} {formatCompactCurrency(highestRow.juriRisk)}
        </p>
      </div>

      <div className="glass-panel admin-risk-command-card">
        <div className="panel-title-row">
          <strong>Reduce Immediately</strong>
          <span>
            {rows.length ? `${rows.length} result number(s)` : "No active danger right now"}
          </span>
        </div>

        <div className="admin-risk-action-list">
          {rows.length ? (
            rows.map((row, index) => (
              <div
                key={`result-pressure-${row.number}`}
                className={`admin-risk-action admin-risk-${row.tone}`}
              >
                <div className="admin-risk-action-head">
                  <strong>
                    {index + 1}. {row.number}
                  </strong>
                  <span>{getRiskShareText(row.totalRisk, collectionValue)}</span>
                </div>
                <div className="admin-risk-action-meta">
                  <span>
                    3:{formatCompactCurrency(row.thirdRisk)} | 4:
                    {formatCompactCurrency(row.fourthRisk)} | J:
                    {formatCompactCurrency(row.juriRisk)}
                  </span>
                  <strong>{formatCompactCurrency(row.totalRisk)}</strong>
                </div>
              </div>
            ))
          ) : (
            <div className="admin-risk-empty">
              No risky result number yet for this draw. The board will light up as tickets enter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskSection({ title, rows, collectionValue = 0 }) {
  const rankedRows = [...rows].sort(sortRiskRows);
  const topRiskValue = rankedRows[0] ? rankedRows[0].payoutRisk : 0;

  return (
    <div className="glass-panel admin-risk-section">
      <div className="panel-title-row">
        <strong>{title}</strong>
        <span>Highest first for quick reduce action</span>
      </div>

      <div className="admin-risk-grid">
        {rankedRows.map((row) => {
          const tone = getRiskTone(row.payoutRisk, collectionValue);

          return (
            <div
              key={`${title}-${row.number}`}
              className={`admin-risk-card admin-risk-${tone}`}
            >
              <div className="admin-risk-card-top">
                <strong>{row.number}</strong>
                <span className={`admin-risk-chip admin-risk-chip-${tone}`}>
                  {getRiskChipLabel(row, tone, topRiskValue)}
                </span>
              </div>

              <div className="admin-risk-card-metrics">
                <span>Qty {row.totalQty}</span>
                <span>Sale {formatCompactCurrency(row.totalAmount)}</span>
              </div>

              <div className="admin-risk-card-footer">
                <strong>{formatCurrency(row.payoutRisk)}</strong>
                <span>{getRiskShareText(row.payoutRisk, collectionValue)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JuriMiniBoard({ rows, topRows, collectionValue = 0 }) {
  return (
    <div className="glass-panel admin-risk-section">
      <div className="panel-title-row">
        <strong>Juri 00-99</strong>
        <span>Mini map to see which juri number is getting hot</span>
      </div>

      {topRows.length > 0 && (
        <div className="admin-juri-top-strip">
          {topRows.map((row) => {
            const tone = getRiskTone(row.payoutRisk, collectionValue);

            return (
              <div
                key={`top-juri-${row.number}`}
                className={`admin-juri-top-chip admin-risk-${tone}`}
              >
                <span>Juri {row.number}</span>
                <strong>{formatCompactCurrency(row.payoutRisk)}</strong>
              </div>
            );
          })}
        </div>
      )}

      <div className="admin-juri-mini-grid">
        {rows.map((row) => {
          const tone = getRiskTone(row.payoutRisk, collectionValue);

          return (
            <div
              key={`juri-mini-${row.number}`}
              className={`admin-juri-mini-box admin-risk-${tone} ${
                row.payoutRisk > 0 ? "active" : ""
              }`}
            >
              <strong>{row.number}</strong>
              <div className="admin-juri-mini-meta">
                <span>Q{row.totalQty}</span>
                <small>{row.payoutRisk > 0 ? formatCompactCurrency(row.payoutRisk) : "Safe"}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniStatCard({ label, value, status = "", accent = false }) {
  return (
    <div className={`mini-box ${accent ? "premium-mini" : ""} ${status ? `admin-stat-${status}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HighlightCard({ title, value, tone = "" }) {
  return (
    <div className={`glass-panel admin-highlight-card ${tone ? `admin-highlight-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeAdminTickets(tickets) {
  if (!Array.isArray(tickets)) {
    return [];
  }

  const fallbackTimestamp = new Date().toISOString();

  return tickets.map((ticket, index) => ({
    id: ticket && ticket.id ? ticket.id : Date.now() + index,
    sellerUsername:
      ticket && ticket.sellerUsername ? ticket.sellerUsername : DEFAULT_SELLERS[0].username,
    customerName: ticket && ticket.customerName ? ticket.customerName : "Walk-in Customer",
    customerPhone: ticket && ticket.customerPhone ? ticket.customerPhone : "",
    date: ticket && ticket.date ? ticket.date : getTodayString(),
    drawTime: ticket && ticket.drawTime ? ticket.drawTime : "11:00",
    total: ticket && typeof ticket.total === "number" ? ticket.total : 0,
    paidAmount: ticket && typeof ticket.paidAmount === "number" ? ticket.paidAmount : 0,
    dueAmount: ticket && typeof ticket.dueAmount === "number" ? ticket.dueAmount : 0,
    commission: ticket && typeof ticket.commission === "number" ? ticket.commission : 0,
    claimed: Boolean(ticket && ticket.claimed),
    cancelled: Boolean(ticket && ticket.cancelled),
    items: Array.isArray(ticket && ticket.items) ? ticket.items : [],
    paidAmount: ticket && typeof ticket.paidAmount === "number" ? ticket.paidAmount : 0,
    createdAt:
      ticket && typeof ticket.createdAt === "string" ? ticket.createdAt : fallbackTimestamp,
    updatedAt:
      ticket && typeof ticket.updatedAt === "string"
        ? ticket.updatedAt
        : ticket && typeof ticket.createdAt === "string"
          ? ticket.createdAt
          : fallbackTimestamp,
  }));
}

function normalizeRiskBoardResponse(riskBoard) {
  const fallback = buildRiskBoard([]);

  return {
    thirdRows: Array.isArray(riskBoard && riskBoard.thirdRows) ? riskBoard.thirdRows : fallback.thirdRows,
    fourthRows: Array.isArray(riskBoard && riskBoard.fourthRows) ? riskBoard.fourthRows : fallback.fourthRows,
    juriRows: Array.isArray(riskBoard && riskBoard.juriRows) ? riskBoard.juriRows : fallback.juriRows,
    sellerCollection: Number(riskBoard && riskBoard.sellerCollection ? riskBoard.sellerCollection : 0),
    collection: Number(riskBoard && riskBoard.collection ? riskBoard.collection : 0),
    commission: Number(riskBoard && riskBoard.commission ? riskBoard.commission : 0),
    payoutExposure: Number(riskBoard && riskBoard.payoutExposure ? riskBoard.payoutExposure : 0),
    adminNet: Number(riskBoard && riskBoard.adminNet ? riskBoard.adminNet : 0),
    highestRisk: {
      third: normalizeRiskRow(riskBoard && riskBoard.highestRisk ? riskBoard.highestRisk.third : null),
      fourth: normalizeRiskRow(riskBoard && riskBoard.highestRisk ? riskBoard.highestRisk.fourth : null),
      juri: normalizeRiskRow(riskBoard && riskBoard.highestRisk ? riskBoard.highestRisk.juri : null),
    },
  };
}

function normalizeRiskRow(row) {
  return {
    number: row && row.number !== undefined ? row.number : "--",
    totalQty: Number(row && row.totalQty ? row.totalQty : 0),
    totalAmount: Number(row && row.totalAmount ? row.totalAmount : 0),
    payoutRisk: Number(row && row.payoutRisk ? row.payoutRisk : 0),
    tone: row && row.tone ? row.tone : "",
  };
}

function normalizeAdminOverview(overview) {
  return {
    sale: Number(overview && overview.sale ? overview.sale : 0),
    adminCollection: Number(overview && overview.adminCollection ? overview.adminCollection : 0),
    payout: Number(overview && overview.payout ? overview.payout : 0),
    commission: Number(overview && overview.commission ? overview.commission : 0),
    outstanding: Number(overview && overview.outstanding ? overview.outstanding : 0),
    profitLoss: Number(overview && overview.profitLoss ? overview.profitLoss : 0),
  };
}

function buildStateSignature(value) {
  try {
    return JSON.stringify(value || null);
  } catch {
    return "";
  }
}

function emptySellerReport() {
  return {
    seller: null,
    filters: {},
    sale: 0,
    adminCollection: 0,
    commission: 0,
    payout: 0,
    customerDue: 0,
    totalQty: 0,
    ticketCount: 0,
    openTickets: 0,
    lockedTickets: 0,
    claimedTickets: 0,
    adminProfitLoss: 0,
    tickets: [],
  };
}

function normalizeSellerReport(report, fallbackSeller = null) {
  const empty = emptySellerReport();
  const tickets = Array.isArray(report && report.tickets)
    ? report.tickets.map((ticket) => ({
        ...ticket,
        totalQty: Number(ticket && ticket.totalQty ? ticket.totalQty : 0),
        adminCollection: Number(
          ticket && ticket.adminCollection !== undefined
            ? ticket.adminCollection
            : Number(ticket && ticket.total ? ticket.total : 0) -
                Number(ticket && ticket.commission ? ticket.commission : 0)
        ),
        statusLabel:
          ticket && ticket.statusLabel ? ticket.statusLabel : getTicketStatus(ticket).label,
        statusTone:
          ticket && ticket.statusTone ? ticket.statusTone : getTicketStatus(ticket).tone,
      }))
    : [];

  return {
    seller: report && report.seller ? report.seller : fallbackSeller,
    filters: report && report.filters ? report.filters : {},
    sale: Number(report && report.sale ? report.sale : 0),
    adminCollection: Number(report && report.adminCollection ? report.adminCollection : 0),
    commission: Number(report && report.commission ? report.commission : 0),
    payout: Number(report && report.payout ? report.payout : 0),
    customerDue: Number(report && report.customerDue ? report.customerDue : 0),
    totalQty: Number(report && report.totalQty ? report.totalQty : 0),
    ticketCount: Number(report && report.ticketCount ? report.ticketCount : 0),
    openTickets: Number(report && report.openTickets ? report.openTickets : 0),
    lockedTickets: Number(report && report.lockedTickets ? report.lockedTickets : 0),
    claimedTickets: Number(report && report.claimedTickets ? report.claimedTickets : 0),
    adminProfitLoss: Number(
      report && report.profitLoss !== undefined ? report.profitLoss : empty.adminProfitLoss
    ),
    tickets,
  };
}

function buildLocalSellerReport(seller, tickets, winResults) {
  const summary = buildSellerSummary(seller, tickets, winResults);

  return {
    ...summary,
    seller,
    filters: {},
    tickets: [...tickets]
      .sort(
        (left, right) =>
          new Date(right.updatedAt || right.createdAt || 0).getTime() -
          new Date(left.updatedAt || left.createdAt || 0).getTime()
      )
      .map((ticket) => {
        const totalQty = ticket.items.reduce(
          (itemSum, item) => itemSum + (Number(item.qty) || 0),
          0
        );
        const status = getTicketStatus(ticket);

        return {
          ...ticket,
          totalQty,
          adminCollection: ticket.total - ticket.commission,
          statusLabel: status.label,
          statusTone: status.tone,
        };
      }),
  };
}

function buildRiskBoard(tickets) {
  const thirdRows = buildRiskRows(tickets, "single3", createDigitList(10), SINGLE_RATE, SINGLE_PAYOUT);
  const fourthRows = buildRiskRows(tickets, "single4", createDigitList(10), SINGLE_RATE, SINGLE_PAYOUT);
  const juriRows = buildRiskRows(tickets, "juri", createJuriList(), JURI_RATE, JURI_PAYOUT);
  const sellerCollection = tickets.reduce((sum, ticket) => sum + ticket.total, 0);
  const commission = tickets.reduce((sum, ticket) => sum + ticket.commission, 0);
  const collection = sellerCollection - commission;

  return {
    thirdRows,
    fourthRows,
    juriRows,
    sellerCollection,
    collection,
    commission,
  };
}

function buildRiskRows(tickets, itemType, numbers, rate, payoutRate) {
  return numbers.map((number) => {
    const totalQty = tickets.reduce((sum, ticket) => {
      const qty = ticket.items.reduce((itemSum, item) => {
        if (item.type !== itemType) {
          return itemSum;
        }

        return normalizeNumber(item.num, itemType === "juri" ? 2 : 1) === number
          ? itemSum + (Number(item.qty) || 0)
          : itemSum;
      }, 0);

      return sum + qty;
    }, 0);

    return {
      number,
      totalQty,
      totalAmount: totalQty * rate,
      payoutRisk: totalQty * payoutRate,
      tone: getRiskTone(totalQty * payoutRate, tickets.reduce((sum, ticket) => sum + ticket.total, 0)),
    };
  });
}

function buildResultPressureRows(thirdRows, fourthRows, juriRows, collectionValue) {
  const thirdLookup = buildRiskLookup(thirdRows);
  const fourthLookup = buildRiskLookup(fourthRows);
  const juriLookup = buildRiskLookup(juriRows);

  return createJuriList()
    .map((number) => {
      const firstDigit = number.charAt(0);
      const secondDigit = number.charAt(1);
      const thirdRow = thirdLookup[firstDigit] || normalizeRiskRow({ number: firstDigit });
      const fourthRow = fourthLookup[secondDigit] || normalizeRiskRow({ number: secondDigit });
      const juriRow = juriLookup[number] || normalizeRiskRow({ number });
      const totalRisk = thirdRow.payoutRisk + fourthRow.payoutRisk + juriRow.payoutRisk;

      return {
        number,
        firstDigit,
        secondDigit,
        thirdRisk: thirdRow.payoutRisk,
        fourthRisk: fourthRow.payoutRisk,
        juriRisk: juriRow.payoutRisk,
        totalQty: thirdRow.totalQty + fourthRow.totalQty + juriRow.totalQty,
        totalRisk,
        tone: getRiskTone(totalRisk, collectionValue),
      };
    })
    .sort(sortResultPressureRows);
}

function buildRiskLookup(rows) {
  return rows.reduce((lookup, row) => {
    lookup[String(row.number)] = normalizeRiskRow(row);
    return lookup;
  }, {});
}

function getTopRiskRows(rows, limit = 5) {
  return [...rows].filter((row) => row.payoutRisk > 0).sort(sortRiskRows).slice(0, limit);
}

function sortRiskRows(left, right) {
  if (right.payoutRisk !== left.payoutRisk) {
    return right.payoutRisk - left.payoutRisk;
  }

  if (right.totalQty !== left.totalQty) {
    return right.totalQty - left.totalQty;
  }

  return String(left.number).localeCompare(String(right.number));
}

function sortResultPressureRows(left, right) {
  if (right.totalRisk !== left.totalRisk) {
    return right.totalRisk - left.totalRisk;
  }

  if (right.juriRisk !== left.juriRisk) {
    return right.juriRisk - left.juriRisk;
  }

  return left.number.localeCompare(right.number);
}

function buildAdminDashboard(tickets, winResults) {
  const payout = tickets.reduce((sum, ticket) => {
    const winNumber = winResults[buildResultKey(ticket.date, ticket.drawTime)] || "";
    return sum + getTicketPayoutForResult(ticket, winNumber);
  }, 0);

  const sale = tickets.reduce((sum, ticket) => sum + ticket.total, 0);
  const commission = tickets.reduce((sum, ticket) => sum + ticket.commission, 0);
  const outstanding = tickets.reduce((sum, ticket) => sum + ticket.dueAmount, 0);
  const adminCollection = sale - commission;

  return {
    sale,
    adminCollection,
    payout,
    commission,
    outstanding,
    profitLoss: adminCollection - payout,
  };
}

function buildSellerSummary(seller, tickets, winResults) {
  if (!seller) {
    return {
      sale: 0,
      totalQty: 0,
      commission: 0,
      adminCollection: 0,
      outstanding: 0,
      adminProfitLoss: 0,
      payout: 0,
      openTickets: 0,
      lockedTickets: 0,
      claimedTickets: 0,
      customerDue: 0,
      ticketCount: 0,
    };
  }

  const payout = tickets.reduce((sum, ticket) => {
    const winNumber = winResults[buildResultKey(ticket.date, ticket.drawTime)] || "";
    return sum + getTicketPayoutForResult(ticket, winNumber);
  }, 0);

  const sale = tickets.reduce((sum, ticket) => sum + ticket.total, 0);
  const commission = tickets.reduce((sum, ticket) => sum + ticket.commission, 0);
  const adminCollection = sale - commission;
  const totalQty = tickets.reduce(
    (sum, ticket) =>
      sum + ticket.items.reduce((itemSum, item) => itemSum + (Number(item.qty) || 0), 0),
    0
  );
  const customerDue = tickets.reduce((sum, ticket) => sum + ticket.dueAmount, 0);

  return {
    sale,
    adminCollection,
    totalQty,
    commission,
    outstanding: customerDue,
    adminProfitLoss: adminCollection - payout,
    payout,
    openTickets: tickets.filter((ticket) => !ticket.claimed && !isLocked(ticket)).length,
    lockedTickets: tickets.filter((ticket) => !ticket.claimed && isLocked(ticket)).length,
    claimedTickets: tickets.filter((ticket) => ticket.claimed).length,
    customerDue,
    ticketCount: tickets.length,
  };
}

function getTicketPayoutForResult(ticket, winningNumber) {
  if (!winningNumber) {
    return 0;
  }

  return ticket.items.reduce((sum, item) => {
    if (item.type === "juri" && normalizeNumber(item.num, 2) === winningNumber) {
      return sum + (Number(item.qty) || 0) * JURI_PAYOUT;
    }

    if (item.type === "single3" && String(item.num) === winningNumber.charAt(0)) {
      return sum + (Number(item.qty) || 0) * SINGLE_PAYOUT;
    }

    if (item.type === "single4" && String(item.num) === winningNumber.charAt(1)) {
      return sum + (Number(item.qty) || 0) * SINGLE_PAYOUT;
    }

    return sum;
  }, 0);
}

function getHighestRiskRow(rows) {
  const sorted = [...rows].sort((left, right) => right.payoutRisk - left.payoutRisk);
  return sorted[0] || { number: "--", payoutRisk: 0 };
}

function createEmptyResultPressureRow(collectionValue = 0) {
  return {
    number: "--",
    firstDigit: "-",
    secondDigit: "-",
    thirdRisk: 0,
    fourthRisk: 0,
    juriRisk: 0,
    totalQty: 0,
    totalRisk: 0,
    tone: getRiskTone(0, collectionValue),
  };
}

function getRiskChipLabel(row, tone, topRiskValue) {
  if (!row.payoutRisk) {
    return "Safe";
  }

  if (row.payoutRisk === topRiskValue) {
    return "Highest";
  }

  if (tone === "danger") {
    return "Reduce";
  }

  if (tone === "warning") {
    return "Watch";
  }

  return "Open";
}

function getRiskShareText(riskValue, collectionValue) {
  if (!riskValue) {
    return "No pressure";
  }

  if (!collectionValue) {
    return "Waiting for collection";
  }

  return `${Math.round((riskValue / collectionValue) * 100)}% of collection`;
}

function getResultBufferText(riskValue, collectionValue) {
  if (!riskValue) {
    return "No active result danger";
  }

  if (!collectionValue) {
    return "Collection not ready yet";
  }

  const balance = collectionValue - riskValue;

  return balance >= 0
    ? `${formatCompactCurrency(balance)} buffer left`
    : `${formatCompactCurrency(Math.abs(balance))} over collection`;
}

function getTicketStatus(ticket) {
  if (ticket.claimed) {
    return { label: "CLAIMED", tone: "claimed" };
  }

  if (isLocked(ticket)) {
    return { label: "LOCKED", tone: "locked" };
  }

  return { label: "OPEN", tone: "open" };
}

function createDigitList(length) {
  return Array.from({ length }, (_, index) => String(index));
}

function createJuriList() {
  return Array.from({ length: 100 }, (_, index) => leftPad(String(index), 2, "0"));
}

function normalizeNumber(value, digits) {
  return leftPad(String(value || ""), digits, "0");
}

function getRiskTone(riskValue, collectionValue) {
  if (riskValue <= 0) {
    return "safe";
  }

  if (!collectionValue) {
    return "warning";
  }

  if (riskValue >= collectionValue) {
    return "danger";
  }

  if (riskValue >= collectionValue * 0.5) {
    return "warning";
  }

  return "safe";
}

function isLocked(ticket) {
  if (!ticket || !ticket.date || !ticket.drawTime) {
    return false;
  }

  const cutoffValue = getEntryCutoffValue(ticket.drawTime);
  const draw = new Date(`${ticket.date}T${cutoffValue}:00`);
  return new Date() > draw;
}

function buildResultKey(date, drawTime) {
  return `${date}|${drawTime}`;
}

function getTodayString() {
  return formatDate(new Date());
}

function getDefaultAdminDrawTime(referenceDate = new Date()) {
  const today = formatDate(referenceDate);
  const nextOpenDraw = drawOptions.find(
    (option) => new Date(`${today}T${getEntryCutoffValue(option.value)}:00`) >= referenceDate
  );

  return nextOpenDraw ? nextOpenDraw.value : drawOptions[drawOptions.length - 1].value;
}

function formatDate(dateValue) {
  const year = dateValue.getFullYear();
  const month = leftPad(String(dateValue.getMonth() + 1), 2, "0");
  const day = leftPad(String(dateValue.getDate()), 2, "0");
  return `${year}-${month}-${day}`;
}

function formatDrawTime(value) {
  const match = drawOptions.find((option) => option.value === value);
  return match ? match.label : value;
}

function getEntryCutoffValue(drawTime) {
  const match = drawOptions.find((option) => option.value === drawTime);
  return match && match.cutoff ? match.cutoff : drawTime;
}

function formatTimeValue(value) {
  const [hourText = "0", minuteText = "00"] = String(value || "").split(":");
  const hour = Number(hourText) || 0;
  const minute = leftPad(String(Number(minuteText) || 0), 2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minute} ${suffix}`;
}

function leftPad(value, targetLength, fillCharacter) {
  let output = String(value);

  while (output.length < targetLength) {
    output = fillCharacter + output;
  }

  return output;
}

function sanitizeDecimal(value) {
  return Number.parseFloat(value || "0") || 0;
}

function formatCurrency(value) {
  const globalIntl =
    typeof globalThis !== "undefined" && globalThis.Intl ? globalThis.Intl : null;

  if (!globalIntl) {
    return `Rs ${Number(value || 0).toFixed(2)}`;
  }

  return new globalIntl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  const absoluteAmount = Math.abs(amount);
  const globalIntl =
    typeof globalThis !== "undefined" && globalThis.Intl ? globalThis.Intl : null;

  if (!globalIntl) {
    return `Rs ${absoluteAmount.toFixed(0)}`;
  }

  const compact = new globalIntl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: absoluteAmount >= 1000 ? 1 : 0,
  }).format(absoluteAmount);

  return `${amount < 0 ? "-" : ""}₹${compact}`;
}

if (typeof window !== "undefined" && !window.localStorage.getItem(SELLER_LIST_KEY)) {
  save(SELLER_LIST_KEY, DEFAULT_SELLERS);
}
