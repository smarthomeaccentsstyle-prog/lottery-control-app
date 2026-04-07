import React, { useCallback, useEffect, useMemo, useState } from "react";

import { save } from "../untils/storage.js";
import {
  createSellerApi,
  fetchAdminOverviewApi,
  fetchMasterAdminApi,
  fetchResultsApi,
  fetchSellersApi,
  fetchTicketsApi,
  mapResultsToLookup,
  updateMasterAdminApi,
  updateSellerApi,
} from "../untils/api.js";
import { DEFAULT_SELLERS, SELLER_LIST_KEY, getStoredSellers } from "../untils/adminStorage.js";

const SINGLE_PAYOUT = 100;
const JURI_PAYOUT = 600;

const emptySellerForm = {
  name: "",
  mobile: "",
  username: "",
  password: "",
  singleCommission: String(DEFAULT_SELLERS[0].singleCommission),
  juriCommission: String(DEFAULT_SELLERS[0].juriCommission),
};

const emptyAdminForm = {
  username: "",
  password: "",
};

export default function MasterPanel({ session, onLogout }) {
  const [adminAccount, setAdminAccount] = useState({ username: "" });
  const [adminForm, setAdminForm] = useState(emptyAdminForm);
  const [adminLoading, setAdminLoading] = useState(false);
  const [sellerForm, setSellerForm] = useState(emptySellerForm);
  const [editingSellerId, setEditingSellerId] = useState(null);
  const [sellerLoading, setSellerLoading] = useState(false);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [sellers, setSellers] = useState(getStoredSellers);
  const [masterMetrics, setMasterMetrics] = useState({
    tickets: [],
    winResults: {},
  });
  const [businessSummary, setBusinessSummary] = useState(() => emptyBusinessSummary());

  const activeSellerCount = useMemo(
    () => sellers.filter((seller) => seller.active).length,
    [sellers]
  );
  const inactiveSellerCount = sellers.length - activeSellerCount;

  const sellerPerformanceRows = useMemo(
    () => buildMasterSellerPerformanceRows(sellers, masterMetrics.tickets, masterMetrics.winResults),
    [masterMetrics.tickets, masterMetrics.winResults, sellers]
  );

  const sellerPerformanceMap = useMemo(
    () =>
      sellerPerformanceRows.reduce((accumulator, seller) => {
        accumulator[seller.id] = seller;
        return accumulator;
      }, {}),
    [sellerPerformanceRows]
  );

  const orderedSellers = useMemo(
    () =>
      [...sellers].sort((left, right) => {
        const saleGap =
          Number(sellerPerformanceMap[right.id]?.sale || 0) -
          Number(sellerPerformanceMap[left.id]?.sale || 0);

        if (saleGap !== 0) {
          return saleGap;
        }

        return String(left.name || "").localeCompare(String(right.name || ""));
      }),
    [sellerPerformanceMap, sellers]
  );

  const topSaleSeller = sellerPerformanceRows[0] || null;
  const topProfitSeller = useMemo(
    () =>
      [...sellerPerformanceRows].sort((left, right) => right.profitLoss - left.profitLoss)[0] || null,
    [sellerPerformanceRows]
  );
  const biggestLossSeller = useMemo(
    () =>
      [...sellerPerformanceRows].sort((left, right) => left.profitLoss - right.profitLoss)[0] || null,
    [sellerPerformanceRows]
  );
  const hasSellerLoss = Boolean(biggestLossSeller && biggestLossSeller.profitLoss < 0);

  useEffect(() => {
    save(SELLER_LIST_KEY, sellers);
  }, [sellers]);

  const loadAdminAccount = useCallback(async () => {
    try {
      setAdminLoading(true);
      const response = await fetchMasterAdminApi();
      const nextAdmin = normalizeAdminAccount(response.admin);
      setAdminAccount(nextAdmin);
      setAdminForm((current) => ({
        username: current.username || nextAdmin.username,
        password: "",
      }));
    } catch {
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const loadSellers = useCallback(async () => {
    try {
      setSellerLoading(true);
      const response = await fetchSellersApi();
      setSellers(response.sellers || []);
    } catch {
    } finally {
      setSellerLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminAccount();
    loadSellers();
  }, [loadAdminAccount, loadSellers]);

  useEffect(() => {
    let active = true;

    const loadBusinessData = async () => {
      try {
        setBusinessLoading(true);

        const [overviewResponse, ticketsResponse, resultsResponse] = await Promise.allSettled([
          fetchAdminOverviewApi(),
          fetchTicketsApi(),
          fetchResultsApi(),
        ]);

        if (!active) {
          return;
        }

        const tickets =
          ticketsResponse.status === "fulfilled"
            ? normalizeMasterTickets(ticketsResponse.value.tickets)
            : [];
        const winResults =
          resultsResponse.status === "fulfilled"
            ? mapResultsToLookup(resultsResponse.value.results || [])
            : {};
        const localSummary = buildLocalBusinessSummary(tickets, winResults);

        setMasterMetrics({
          tickets,
          winResults,
        });
        setBusinessSummary(
          overviewResponse.status === "fulfilled"
            ? normalizeBusinessSummary(overviewResponse.value.overview, localSummary)
            : localSummary
        );
      } catch {
      } finally {
        if (active) {
          setBusinessLoading(false);
        }
      }
    };

    loadBusinessData();
    const intervalId = window.setInterval(loadBusinessData, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const handleSaveAdmin = async () => {
    const payload = {
      username: adminForm.username.trim(),
      password: adminForm.password.trim(),
    };

    if (!payload.username || !payload.password) {
      window.alert("Admin username and password are required");
      return;
    }

    try {
      setAdminLoading(true);
      const response = await updateMasterAdminApi(payload);
      const nextAdmin = normalizeAdminAccount(response.admin);
      setAdminAccount(nextAdmin);
      setAdminForm({
        username: nextAdmin.username,
        password: "",
      });
      window.alert("Admin login updated");
    } catch (error) {
      window.alert(error.message || "Admin update failed");
    } finally {
      setAdminLoading(false);
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

      setSellers(response.sellers || []);
      setEditingSellerId(null);
      setSellerForm(emptySellerForm);
    } catch (error) {
      window.alert(error.message || "Seller save failed");
    } finally {
      setSellerLoading(false);
    }
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
    <div className="app master-app">
      <div className="master-shell">
        <div className="glass-card master-hero">
          <div className="master-hero-top">
            <div>
              <span className="admin-chip">Master</span>
              <h1>Master Panel</h1>
              <p>See admin business first, then control seller accounts with fewer taps.</p>
            </div>

            <div className="master-hero-actions">
              <div className="master-pill">User: {session.username}</div>
              <button className="outline-btn" onClick={onLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="mini-summary master-summary-grid">
            <MiniStatCard label="Admin Username" value={adminAccount.username || "--"} accent />
            <MiniStatCard label="Total Sale" value={formatCurrency(businessSummary.sale)} />
            <MiniStatCard
              label="Admin Profit / Loss"
              value={formatCurrency(businessSummary.profitLoss)}
              status={businessSummary.profitLoss >= 0 ? "safe" : "danger"}
            />
            <MiniStatCard
              label="Top Seller"
              value={topSaleSeller ? topSaleSeller.name : "--"}
              status={topSaleSeller ? getMetricTone(topSaleSeller.profitLoss, topSaleSeller.sale) : "warning"}
            />
          </div>
        </div>

        <div className="workspace-grid master-workspace-grid">
          <div className="glass-panel master-business-panel">
            <div className="panel-title-row">
              <strong>Admin Business View</strong>
              <span>{businessLoading ? "Refreshing..." : "One admin total plus seller ranking"}</span>
            </div>

            <p className="master-note">
              This app runs one admin account, so the master view shows total admin sale,
              payout, profit or loss, and which seller is driving the business.
            </p>

            <div className="mini-summary master-business-grid">
              <MiniStatCard label="Total Sale" value={formatCurrency(businessSummary.sale)} accent />
              <MiniStatCard label="Admin Collection" value={formatCurrency(businessSummary.adminCollection)} />
              <MiniStatCard label="Actual Payout" value={formatCurrency(businessSummary.payout)} />
              <MiniStatCard label="Seller Comm." value={formatCurrency(businessSummary.commission)} />
              <MiniStatCard
                label="Outstanding"
                value={formatCurrency(businessSummary.outstanding)}
                status={businessSummary.outstanding > 0 ? "warning" : "safe"}
              />
              <MiniStatCard
                label="Profit / Loss"
                value={formatCurrency(businessSummary.profitLoss)}
                status={businessSummary.profitLoss >= 0 ? "safe" : "danger"}
              />
            </div>

            <div className="master-leader-grid">
              <MasterRankCard
                title="Highest Sale Seller"
                primary={topSaleSeller ? formatCurrency(topSaleSeller.sale) : "No sale yet"}
                secondary={
                  topSaleSeller
                    ? `${topSaleSeller.name} | Admin ${formatCurrency(topSaleSeller.adminCollection)} | ${topSaleSeller.ticketCount} ticket(s)`
                    : "Seller sale ranking will appear after ticket activity starts."
                }
                tone={topSaleSeller ? getMetricTone(topSaleSeller.profitLoss, topSaleSeller.sale) : "warning"}
              />
              <MasterRankCard
                title="Best Profit Seller"
                primary={topProfitSeller ? formatCurrency(topProfitSeller.profitLoss) : "No data yet"}
                secondary={
                  topProfitSeller
                    ? `${topProfitSeller.name} | Sale ${formatCurrency(topProfitSeller.sale)} | Payout ${formatCurrency(topProfitSeller.payout)}`
                    : "Seller profit ranking will appear after ticket activity starts."
                }
                tone={topProfitSeller ? getMetricTone(topProfitSeller.profitLoss, topProfitSeller.sale) : "warning"}
              />
              <MasterRankCard
                title="Biggest Seller Loss"
                primary={
                  hasSellerLoss && biggestLossSeller
                    ? formatCurrency(biggestLossSeller.profitLoss)
                    : "No seller loss"
                }
                secondary={
                  hasSellerLoss && biggestLossSeller
                    ? `${biggestLossSeller.name} | Sale ${formatCurrency(biggestLossSeller.sale)} | Payout ${formatCurrency(biggestLossSeller.payout)}`
                    : "No seller is below payout right now."
                }
                tone={hasSellerLoss ? "danger" : "safe"}
              />
            </div>
          </div>

          <div className="glass-panel">
            <div className="panel-title-row">
              <strong>Admin Control</strong>
              <span>{adminLoading ? "Saving..." : "Master reset for admin login"}</span>
            </div>

            <p className="security-note">
              Use this only when admin forgets the old password. Normal admin password changes should happen inside the admin panel with the current password.
            </p>

            <div className="form-row">
              <input
                value={adminForm.username}
                onChange={(event) =>
                  setAdminForm((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="Admin Username"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="password"
                value={adminForm.password}
                onChange={(event) =>
                  setAdminForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="New Admin Password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>

            <div className="footer-actions">
              <button type="button" onClick={handleSaveAdmin}>
                Save Admin
              </button>
              <button
                type="button"
                className="outline-btn"
                onClick={() =>
                  setAdminForm({
                    username: adminAccount.username,
                    password: "",
                  })
                }
              >
                Reset
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <div className="panel-title-row">
              <strong>{editingSellerId ? "Edit Seller" : "Add Seller"}</strong>
              <span>{sellerLoading ? "Saving..." : "Seller account control"}</span>
            </div>

            <p className="security-note">
              Seller can change a password alone only with the current password. If the seller forgets it, admin can set a new one from Seller Manage.
            </p>

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
                value={sellerForm.mobile}
                onChange={(event) =>
                  setSellerForm((current) => ({ ...current, mobile: event.target.value }))
                }
                placeholder="Mobile"
              />
              <input
                value={sellerForm.username}
                onChange={(event) =>
                  setSellerForm((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="Username"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="password"
                value={sellerForm.password}
                onChange={(event) =>
                  setSellerForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder={
                  editingSellerId ? "Leave blank to keep current password" : "Password"
                }
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                spellCheck={false}
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
          </div>

          <div className="glass-panel master-seller-list-panel">
            <div className="panel-title-row">
              <strong>Seller Accounts</strong>
              <span>{sellerLoading ? "Syncing..." : `${sellers.length} seller(s)`}</span>
            </div>

            <div className="ticket-list">
              {orderedSellers.map((seller) => {
                const sellerMetrics = sellerPerformanceMap[seller.id] || emptySellerPerformance();

                return (
                  <div key={seller.id} className="saved-ticket">
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
                      Sale {formatCurrency(sellerMetrics.sale)} | P/L {formatCurrency(sellerMetrics.profitLoss)} | Tickets {sellerMetrics.ticketCount}
                    </p>

                    <p className="saved-line">
                      Single Comm. {seller.singleCommission} | Juri Comm. {seller.juriCommission}
                    </p>

                    <div className="inline-actions">
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
                );
              })}
            </div>
          </div>
        </div>
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

function MasterRankCard({ title, primary, secondary, tone = "" }) {
  return (
    <div className={`glass-panel admin-highlight-card ${tone ? `admin-highlight-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{primary}</strong>
      <p>{secondary}</p>
    </div>
  );
}

function normalizeAdminAccount(admin) {
  return {
    username: admin && admin.username ? admin.username : "",
  };
}

function emptyBusinessSummary() {
  return {
    sale: 0,
    adminCollection: 0,
    payout: 0,
    commission: 0,
    outstanding: 0,
    profitLoss: 0,
  };
}

function normalizeBusinessSummary(overview, fallback = emptyBusinessSummary()) {
  return {
    sale: Number(overview && overview.sale !== undefined ? overview.sale : fallback.sale),
    adminCollection: Number(
      overview && overview.adminCollection !== undefined
        ? overview.adminCollection
        : fallback.adminCollection
    ),
    payout: Number(overview && overview.payout !== undefined ? overview.payout : fallback.payout),
    commission: Number(
      overview && overview.commission !== undefined ? overview.commission : fallback.commission
    ),
    outstanding: Number(
      overview && overview.outstanding !== undefined ? overview.outstanding : fallback.outstanding
    ),
    profitLoss: Number(
      overview && overview.profitLoss !== undefined ? overview.profitLoss : fallback.profitLoss
    ),
  };
}

function normalizeMasterTickets(tickets = []) {
  if (!Array.isArray(tickets)) {
    return [];
  }

  return tickets.map((ticket, index) => ({
    id: ticket && ticket.id ? ticket.id : Date.now() + index,
    sellerUsername: ticket && ticket.sellerUsername ? ticket.sellerUsername : "",
    date: ticket && ticket.date ? ticket.date : "",
    drawTime: ticket && ticket.drawTime ? ticket.drawTime : "",
    total: ticket && typeof ticket.total === "number" ? ticket.total : 0,
    commission: ticket && typeof ticket.commission === "number" ? ticket.commission : 0,
    dueAmount: ticket && typeof ticket.dueAmount === "number" ? ticket.dueAmount : 0,
    cancelled: Boolean(ticket && ticket.cancelled),
    items: Array.isArray(ticket && ticket.items) ? ticket.items : [],
  }));
}

function buildLocalBusinessSummary(tickets, winResults) {
  const activeTickets = tickets.filter((ticket) => !ticket.cancelled);
  const payout = activeTickets.reduce((sum, ticket) => {
    const winNumber = winResults[buildResultKey(ticket.date, ticket.drawTime)] || "";
    return sum + getTicketPayoutForResult(ticket, winNumber);
  }, 0);
  const sale = activeTickets.reduce((sum, ticket) => sum + ticket.total, 0);
  const commission = activeTickets.reduce((sum, ticket) => sum + ticket.commission, 0);
  const outstanding = activeTickets.reduce((sum, ticket) => sum + ticket.dueAmount, 0);
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

function buildMasterSellerPerformanceRows(sellers = [], tickets = [], winResults = {}) {
  const activeTickets = normalizeMasterTickets(tickets).filter((ticket) => !ticket.cancelled);

  return sellers
    .map((seller) => {
      const sellerTickets = activeTickets.filter(
        (ticket) =>
          normalizeUsername(ticket.sellerUsername) === normalizeUsername(seller.username)
      );
      const payout = sellerTickets.reduce((sum, ticket) => {
        const winNumber = winResults[buildResultKey(ticket.date, ticket.drawTime)] || "";
        return sum + getTicketPayoutForResult(ticket, winNumber);
      }, 0);
      const sale = sellerTickets.reduce((sum, ticket) => sum + ticket.total, 0);
      const commission = sellerTickets.reduce((sum, ticket) => sum + ticket.commission, 0);
      const adminCollection = sale - commission;

      return {
        ...seller,
        sale,
        payout,
        commission,
        adminCollection,
        profitLoss: adminCollection - payout,
        ticketCount: sellerTickets.length,
      };
    })
    .sort((left, right) => right.sale - left.sale || right.profitLoss - left.profitLoss);
}

function emptySellerPerformance() {
  return {
    sale: 0,
    payout: 0,
    commission: 0,
    adminCollection: 0,
    profitLoss: 0,
    ticketCount: 0,
  };
}

function buildResultKey(date, drawTime) {
  return `${date}|${drawTime}`;
}

function getTicketPayoutForResult(ticket, winningNumber) {
  if (!winningNumber || !Array.isArray(ticket.items)) {
    return 0;
  }

  return ticket.items.reduce((sum, item) => {
    if (
      item.type === "juri" &&
      leftPad(String(item.num || "").replace(/[^\d]/g, "").slice(0, 2), 2, "0") === winningNumber
    ) {
      return sum + Number(item.qty || 0) * JURI_PAYOUT;
    }

    if (item.type === "single3" && String(item.num || "") === winningNumber.charAt(0)) {
      return sum + Number(item.qty || 0) * SINGLE_PAYOUT;
    }

    if (item.type === "single4" && String(item.num || "") === winningNumber.charAt(1)) {
      return sum + Number(item.qty || 0) * SINGLE_PAYOUT;
    }

    return sum;
  }, 0);
}

function getMetricTone(profitLoss, sale) {
  if (!sale) {
    return "warning";
  }

  if (profitLoss < 0) {
    return "danger";
  }

  return "safe";
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function leftPad(value, targetLength, fillCharacter) {
  let output = String(value);

  while (output.length < targetLength) {
    output = fillCharacter + output;
  }

  return output;
}

function sanitizeDecimal(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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
