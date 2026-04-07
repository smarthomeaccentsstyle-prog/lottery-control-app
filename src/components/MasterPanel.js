import React, { useCallback, useEffect, useMemo, useState } from "react";

import { save } from "../untils/storage.js";
import {
  createSellerApi,
  fetchMasterAdminApi,
  fetchSellersApi,
  updateMasterAdminApi,
  updateSellerApi,
} from "../untils/api.js";
import { DEFAULT_SELLERS, SELLER_LIST_KEY, getStoredSellers } from "../untils/adminStorage.js";

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
  const [sellers, setSellers] = useState(getStoredSellers);

  const activeSellerCount = useMemo(
    () => sellers.filter((seller) => seller.active).length,
    [sellers]
  );
  const inactiveSellerCount = sellers.length - activeSellerCount;

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
      password: seller.password,
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
              <p>Minimal control only: admin login and seller accounts.</p>
            </div>

            <div className="master-hero-actions">
              <div className="master-pill">User: {session.username}</div>
              <button className="outline-btn" onClick={onLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="mini-summary master-summary-grid">
            <div className="mini-box premium-mini">
              <span>Admin Username</span>
              <strong>{adminAccount.username || "--"}</strong>
            </div>
            <div className="mini-box">
              <span>Active Sellers</span>
              <strong>{activeSellerCount}</strong>
            </div>
            <div className="mini-box">
              <span>Inactive Sellers</span>
              <strong>{inactiveSellerCount}</strong>
            </div>
          </div>
        </div>

        <div className="workspace-grid master-workspace-grid">
          <div className="glass-panel">
            <div className="panel-title-row">
              <strong>Admin Control</strong>
              <span>{adminLoading ? "Saving..." : "Update admin login"}</span>
            </div>

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
                placeholder="Password"
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
              {sellers.map((seller) => (
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeAdminAccount(admin) {
  return {
    username: admin && admin.username ? admin.username : "",
  };
}

function sanitizeDecimal(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
