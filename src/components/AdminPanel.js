import React, { useCallback, useEffect, useMemo, useState } from "react";

import { save } from "../untils/storage.js";
import {
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
  { value: "11:00", label: "11:00 AM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "20:00", label: "8:00 PM" },
];

const sidebarItems = [
  "Risk Board",
  "Results",
  "Sellers",
  "Dashboard",
];

const emptySellerForm = {
  name: "",
  mobile: "",
  username: "",
  password: "",
  singleCommission: String(DEFAULT_SELLERS[0].singleCommission),
  juriCommission: String(DEFAULT_SELLERS[0].juriCommission),
};

export default function AdminPanel({ session, onLogout }) {
  const todayString = getTodayString();
  const [activeSection, setActiveSection] = useState("Risk Board");
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [selectedDrawTime, setSelectedDrawTime] = useState("11:00");
  const [resultDate, setResultDate] = useState(getTodayString());
  const [resultDrawTime, setResultDrawTime] = useState("11:00");
  const [winningNumber, setWinningNumber] = useState("");
  const [sellerForm, setSellerForm] = useState(emptySellerForm);
  const [editingSellerId, setEditingSellerId] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(DEFAULT_SELLERS[0].id);
  const [sellerReportDate, setSellerReportDate] = useState(getTodayString());
  const [sellerReportDrawTime, setSellerReportDrawTime] = useState("ALL");
  const [showSellerReport, setShowSellerReport] = useState(false);
  const [sellers, setSellers] = useState(getStoredSellers);
  const [sellerState, setSellerState] = useState({
    tickets: [],
    winResults: {},
  });
  const [sellerLoading, setSellerLoading] = useState(false);
  const [sellerReportLoading, setSellerReportLoading] = useState(false);
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

  const syncAdminData = useCallback(async () => {
    try {
      const [ticketsResponse, resultsResponse, sellersResponse] = await Promise.all([
        fetchTicketsApi(),
        fetchResultsApi(),
        fetchSellersApi(),
      ]);

      setSellerState({
        tickets: normalizeAdminTickets(ticketsResponse.tickets || []),
        winResults: mapResultsToLookup(resultsResponse.results || []),
      });
      setSellers(sellersResponse.sellers || []);
    } catch {
    }
  }, []);

  useEffect(() => {
    let active = true;

    const syncLoop = async () => {
      if (!active) {
        return;
      }

      await syncAdminData();
    };

    syncLoop();
    const intervalId = window.setInterval(syncLoop, 4000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [syncAdminData]);

  useEffect(() => {
    let active = true;

    const loadSellers = async () => {
      try {
        setSellerLoading(true);
        const response = await fetchSellersApi();

        if (!active) {
          return;
        }

        setSellers(response.sellers || []);
      } catch {
      } finally {
        if (active) {
          setSellerLoading(false);
        }
      }
    };

    loadSellers();

    return () => {
      active = false;
    };
  }, []);

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
      sellerState.winResults[buildResultKey(resultDate, resultDrawTime)] || "";
    setWinningNumber(storedResult);
  }, [resultDate, resultDrawTime, sellerState.winResults]);

  const activeTickets = useMemo(
    () => normalizeAdminTickets(sellerState.tickets).filter((ticket) => !ticket.cancelled),
    [sellerState.tickets]
  );

  const selectedDrawTickets = useMemo(
    () =>
      activeTickets.filter(
        (ticket) => ticket.date === selectedDate && ticket.drawTime === selectedDrawTime
      ),
    [activeTickets, selectedDate, selectedDrawTime]
  );

  useEffect(() => {
    let active = true;

    const loadRiskBoard = async () => {
      try {
        const response = await fetchRiskBoardApi({
          date: selectedDate,
          drawTime: selectedDrawTime,
        });

        if (!active) {
          return;
        }

        setRiskBoard(normalizeRiskBoardResponse(response.riskBoard));
      } catch {
        if (active) {
          setRiskBoard(buildRiskBoard(selectedDrawTickets));
        }
      }
    };

    loadRiskBoard();
    const intervalId = window.setInterval(loadRiskBoard, 4000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [selectedDate, selectedDrawTime, selectedDrawTickets]);

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

  const payoutExposure = Number(
    typeof riskBoard.payoutExposure === "number"
      ? riskBoard.payoutExposure
      : highestRisk.third.payoutRisk +
          highestRisk.fourth.payoutRisk +
          highestRisk.juri.payoutRisk
  );
  const estimatedProfitLoss = Number(
    typeof riskBoard.adminNet === "number"
      ? riskBoard.adminNet
      : riskBoard.collection - payoutExposure
  );
  const drawStatus = estimatedProfitLoss >= 0 ? "SAFE" : "LOSS";

  useEffect(() => {
    let active = true;

    const loadOverview = async () => {
      try {
        const response = await fetchAdminOverviewApi();

        if (!active) {
          return;
        }

        setDashboardSummary(normalizeAdminOverview(response.overview));
      } catch {
        if (active) {
          setDashboardSummary(buildAdminDashboard(activeTickets, sellerState.winResults));
        }
      }
    };

    loadOverview();
    const intervalId = window.setInterval(loadOverview, 4000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeTickets, sellerState.winResults]);

  const selectedSeller = useMemo(
    () => sellers.find((seller) => seller.id === selectedSellerId) || sellers[0] || null,
    [selectedSellerId, sellers]
  );

  useEffect(() => {
    setSellerReportDate(todayString);
    setSellerReportDrawTime("ALL");
    setShowSellerReport(false);
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

    if (!showSellerReport) {
      setSellerFilteredReport(emptySellerReport());
      setSellerReportLoading(false);
      return () => {
        active = false;
      };
    }

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
    showSellerReport,
  ]);

  const resultWinningTickets = useMemo(
    () =>
      activeTickets
        .filter(
          (ticket) => ticket.date === resultDate && ticket.drawTime === resultDrawTime
        )
        .map((ticket) => ({
          ...ticket,
          payout: getTicketPayoutForResult(
            ticket,
            sellerState.winResults[buildResultKey(resultDate, resultDrawTime)] || ""
          ),
        }))
        .filter((ticket) => ticket.payout > 0),
    [activeTickets, resultDate, resultDrawTime, sellerState.winResults]
  );

  const handleSaveResult = async () => {
    const sanitized = leftPad(winningNumber.replace(/[^\d]/g, "").slice(0, 2), 2, "0");

    if (sanitized.length !== 2) {
      window.alert("Enter a valid 2 digit win number");
      return;
    }

    try {
      await saveResultApi({
        date: resultDate,
        drawTime: resultDrawTime,
        winningNumber: sanitized,
      });
      await syncAdminData();
      setWinningNumber(sanitized);
      window.alert("Result saved");
    } catch (error) {
      window.alert(error.message || "Result save failed");
    }
  };

  const handleSaveSeller = async () => {
    const trimmed = {
      name: sellerForm.name.trim(),
      mobile: sellerForm.mobile.trim(),
      username: sellerForm.username.trim(),
      password: sellerForm.password.trim(),
      singleCommission: sanitizeDecimal(sellerForm.singleCommission),
      juriCommission: sanitizeDecimal(sellerForm.juriCommission),
    };

    if (!trimmed.name || !trimmed.username || !trimmed.password) {
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
        ? await updateSellerApi(editingSellerId, trimmed)
        : await createSellerApi({
            ...trimmed,
            active: true,
          });

      setSellers(response.sellers || []);
      if (!editingSellerId && response.sellers && response.sellers[0]) {
        setSelectedSellerId(response.sellers[0].id);
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
      password: seller.password,
      singleCommission: String(seller.singleCommission),
      juriCommission: String(seller.juriCommission),
    });
    setActiveSection("Sellers");
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
      setSellers(response.sellers || []);
    } catch (error) {
      window.alert(error.message || "Seller update failed");
    } finally {
      setSellerLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="admin-shell">
        <aside className="glass-card admin-sidebar">
          <div className="admin-brand">
            <span className="admin-chip">Admin</span>
            <h1>Risk Control</h1>
            <p>
              Logged in as {session.username}. Open the draw and see danger numbers
              instantly.
            </p>
          </div>

          <div className="admin-menu">
            {sidebarItems.map((item) => (
              <button
                key={item}
                className={`admin-menu-btn ${activeSection === item ? "active" : ""}`}
                onClick={() => setActiveSection(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <button className="outline-btn admin-logout" onClick={onLogout}>
            Logout
          </button>
        </aside>

        <main className="admin-content">
          {activeSection === "Risk Board" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Risk Board</h2>
                <span>See dangerous numbers for the selected date and draw time.</span>
              </div>

              <div className="action-bar">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
                <select
                  value={selectedDrawTime}
                  onChange={(event) => setSelectedDrawTime(event.target.value)}
                >
                  {drawOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mini-summary admin-summary-grid">
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
                <MiniStatCard
                  label="Draw Status"
                  value={drawStatus}
                  status={drawStatus === "SAFE" ? "safe" : "danger"}
                />
              </div>

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

              <RiskSection title="3rd House" rows={riskBoard.thirdRows} />
              <RiskSection title="4th House" rows={riskBoard.fourthRows} />
              <RiskSection title="Juri" rows={riskBoard.juriRows} dense />
            </div>
          )}

          {activeSection === "Results" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Result Entry</h2>
                <span>Select date, draw time and save the winning number.</span>
              </div>

              <div className="action-bar">
                <input
                  type="date"
                  value={resultDate}
                  onChange={(event) => setResultDate(event.target.value)}
                />
                <select
                  value={resultDrawTime}
                  onChange={(event) => setResultDrawTime(event.target.value)}
                >
                  {drawOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={winningNumber}
                  onChange={(event) =>
                    setWinningNumber(event.target.value.replace(/[^\d]/g, "").slice(0, 2))
                  }
                  inputMode="numeric"
                  placeholder="Winning Number"
                />
                <button onClick={handleSaveResult}>Save Result</button>
              </div>

              <div className="mini-summary admin-summary-grid">
                <MiniStatCard
                  label="Stored Result"
                  value={sellerState.winResults[buildResultKey(resultDate, resultDrawTime)] || "--"}
                />
                <MiniStatCard
                  label="Winning Tickets"
                  value={resultWinningTickets.length}
                />
                <MiniStatCard
                  label="Payout"
                  value={formatCurrency(
                    resultWinningTickets.reduce((sum, ticket) => sum + ticket.payout, 0)
                  )}
                />
              </div>

              <div className="ticket-list">
                {resultWinningTickets.length === 0 ? (
                  <p className="empty">No winning tickets for this draw yet.</p>
                ) : (
                  resultWinningTickets.map((ticket) => (
                    <div key={`admin-win-${ticket.id}`} className="saved-ticket">
                      <div className="saved-top">
                        <div>
                          <strong>#{ticket.id}</strong>
                          <span>
                            {ticket.customerName} | {formatDrawTime(ticket.drawTime)} | {ticket.date}
                          </span>
                        </div>
                        <div className="saved-right">
                          <strong>{formatCurrency(ticket.payout)}</strong>
                          <span>Winning payout</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeSection === "Sellers" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Seller Management</h2>
                <span>Add, edit and activate sellers, then tap a seller to view seller-only totals.</span>
              </div>

              <div className="workspace-grid admin-workspace-grid">
                <div className="glass-panel admin-seller-dashboard-panel">
                  <div className="panel-title-row">
                    <strong>{editingSellerId ? "Edit Seller" : "Add Seller"}</strong>
                    <span>{sellerLoading ? "Syncing..." : `${sellers.length} seller(s)`}</span>
                  </div>

                  <div className="form-row">
                    <input
                      value={sellerForm.name}
                      onChange={(event) =>
                        setSellerForm((current) => ({ ...current, name: event.target.value }))
                      }
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
                      placeholder="Password"
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
                    <button onClick={handleSaveSeller}>
                      {editingSellerId ? "Update Seller" : "Add Seller"}
                    </button>
                    <button
                      className="outline-btn"
                      onClick={() => {
                        setEditingSellerId(null);
                        setSellerForm(emptySellerForm);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="glass-panel">
                  <div className="panel-title-row">
                    <strong>Seller List</strong>
                    <span>Tap edit or activate</span>
                  </div>

                  <div className="ticket-list">
                    {sellers.map((seller) => (
                      <div key={seller.id} className="saved-ticket">
                        <div className="saved-top">
                          <div>
                            <strong>{seller.name}</strong>
                            <span>
                              {seller.username} | {seller.mobile || "No mobile"}
                            </span>
                          </div>
                          <div className="saved-right">
                            <span
                              className={`status-pill ${seller.active ? "open" : "cancelled"}`}
                            >
                              {seller.active ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </div>
                        </div>

                        <p className="saved-line">
                          Single Comm. {seller.singleCommission} | Juri Comm. {seller.juriCommission}
                        </p>

                        <div className="inline-actions">
                          <button className="outline-btn" onClick={() => startSellerEdit(seller)}>
                            Edit
                          </button>
                          <button
                            className={`outline-btn ${selectedSeller && seller.id === selectedSeller.id ? "admin-selected-btn" : ""}`}
                            onClick={() => setSelectedSellerId(seller.id)}
                          >
                            View
                          </button>
                          <button
                            className="outline-btn"
                            onClick={() => toggleSellerActive(seller.id)}
                          >
                            {seller.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-panel">
                  <div className="panel-title-row">
                    <strong>{selectedSeller ? `${selectedSeller.name} Dashboard` : "Seller Dashboard"}</strong>
                    <span>Tap seller from list to change details</span>
                  </div>

                  {selectedSeller ? (
                    <>
                      <div className="glass-panel seller-dashboard-hero">
                        <div>
                          <span className="seller-dashboard-kicker">Today Seller Summary</span>
                          <h3>{selectedSeller.name}</h3>
                          <p className="seller-dashboard-meta">
                            {selectedSeller.username} | {selectedSeller.mobile || "No mobile"} | Single Comm. {selectedSeller.singleCommission} | Juri Comm. {selectedSeller.juriCommission} | Date {todayString}
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
                            <span>Previous data stays hidden until you select date and draw time</span>
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
                            <button onClick={() => setShowSellerReport(true)}>Show Report</button>
                            <button
                              className="outline-btn"
                              onClick={() => setShowSellerReport(false)}
                            >
                              Hide Report
                            </button>
                          </div>

                          {!showSellerReport ? (
                            <p className="empty">
                              Showing today summary only. Select date and draw time, then tap
                              report when you need old data.
                            </p>
                          ) : sellerReportLoading ? (
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
              </div>
            </div>
          )}

          {activeSection === "Dashboard" && (
            <div className="glass-card">
              <div className="section-header">
                <h2>Dashboard</h2>
                <span>Admin totals only. Seller drilldown is inside Seller Management.</span>
              </div>

              <div className="mini-summary admin-summary-grid">
                <MiniStatCard label="Admin Collection" value={formatCurrency(dashboardSummary.adminCollection)} accent />
                <MiniStatCard label="Actual Payout" value={formatCurrency(dashboardSummary.payout)} />
                <MiniStatCard label="Seller Comm. Paid" value={formatCurrency(dashboardSummary.commission)} />
                <MiniStatCard label="Seller Outstanding" value={formatCurrency(dashboardSummary.outstanding)} status={dashboardSummary.outstanding > 0 ? "warning" : "safe"} />
                <MiniStatCard
                  label="Admin Profit / Loss"
                  value={formatCurrency(dashboardSummary.profitLoss)}
                  status={dashboardSummary.profitLoss >= 0 ? "safe" : "danger"}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RiskSection({ title, rows, dense = false }) {
  return (
    <div className="glass-panel admin-risk-section">
      <div className="panel-title-row">
        <strong>{title}</strong>
        <span>{rows.length} number(s)</span>
      </div>

      <div className={`admin-risk-grid ${dense ? "dense-risk-grid" : ""}`}>
        {rows.map((row) => (
          <div
            key={`${title}-${row.number}`}
            className={`admin-risk-card admin-risk-${row.tone}`}
          >
            <strong>{row.number}</strong>
            <span>Qty {row.totalQty}</span>
            <span>{formatCurrency(row.totalAmount)}</span>
            <span>Risk {formatCurrency(row.payoutRisk)}</span>
          </div>
        ))}
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
  const now = new Date();
  const draw = new Date(`${ticket.date}T${ticket.drawTime}:00`);
  return now > draw;
}

function buildResultKey(date, drawTime) {
  return `${date}|${drawTime}`;
}

function getTodayString() {
  return formatDate(new Date());
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

if (typeof window !== "undefined" && !window.localStorage.getItem(SELLER_LIST_KEY)) {
  save(SELLER_LIST_KEY, DEFAULT_SELLERS);
}
