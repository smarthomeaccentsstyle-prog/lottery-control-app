import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  getJuriQuantity,
  parseFastJuriText,
  sanitizeFastQuantity,
  upsertJuriText,
} from "../untils/fastEntry.js";
import TicketFormat from "./TicketFormat.js";

const BLOCKED_QUANTITY_KEYS = new Set(["e", "E", "+", "-"]);
const JURI_GRID_VALUES = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));

function sumValues(values) {
  return (Array.isArray(values) ? values : []).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function buildFilledDigits(values) {
  return (Array.isArray(values) ? values : [])
    .map((qty, digit) => ({
      digit,
      qty: Number(qty || 0),
    }))
    .filter((item) => item.qty > 0);
}

function ModeButton({ active, label, hint, onClick }) {
  return (
    <button
      type="button"
      className={`fast-mode-btn ${active ? "active" : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{hint}</strong>
    </button>
  );
}

function buildEmptyModalState() {
  return {
    isOpen: false,
    mode: "third",
    number: "",
    typedQty: "",
    baseQty: 0,
    clearOnSave: false,
  };
}

function getModeLabel(mode) {
  if (mode === "fourth") {
    return "4TH HOUSE";
  }

  if (mode === "juri") {
    return "JURI";
  }

  return "3RD HOUSE";
}

function formatEntryNumber(mode, number) {
  return mode === "juri" ? String(number).padStart(2, "0") : String(number);
}

function formatPreviewValue(mode, number, qty) {
  const normalizedNumber = formatEntryNumber(mode, number);
  return mode === "juri" ? `[${normalizedNumber}-${qty}]` : `[${normalizedNumber}=${qty}]`;
}

export default function SellerFastEntryBoard({
  activeEntryMode,
  bookingDateAdjusted,
  currentDue,
  customerName,
  customerPhone,
  date,
  drawOptions,
  drawTime,
  editingTicketId,
  effectivePaidAmount,
  effectiveTicketDate,
  entryUiToken,
  formatCurrency,
  formatDrawTime,
  formatEntryCutoffTime,
  fourth,
  juriText,
  lastSavedTicket,
  lastSavedTicketId,
  maxBookingDate,
  onActiveEntryModeChange,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onDateChange,
  onDismissSavedTicket,
  onDrawTimeChange,
  onFourthChange,
  onJuriTextChange,
  onPaidAmountChange,
  onPaymentModeChange,
  onPrintDraft,
  onPrintSavedTicket,
  onReset,
  onSave,
  onThirdChange,
  paidAmount,
  parsedJuri,
  paymentMode,
  previewItems,
  previewLayout,
  previewSummary,
  third,
  ticketActionNotice,
  todayString,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [entryModal, setEntryModal] = useState(() => buildEmptyModalState());
  const quantityInputRef = useRef(null);

  const parsedJuriList = useMemo(() => parsedJuri || parseFastJuriText(juriText), [juriText, parsedJuri]);
  const thirdEntries = useMemo(() => buildFilledDigits(third), [third]);
  const fourthEntries = useMemo(() => buildFilledDigits(fourth), [fourth]);
  const thirdQty = useMemo(() => sumValues(third), [third]);
  const fourthQty = useMemo(() => sumValues(fourth), [fourth]);
  const juriQty = useMemo(
    () => parsedJuriList.entries.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    [parsedJuriList.entries]
  );
  const juriLookup = useMemo(
    () =>
      parsedJuriList.entries.reduce((lookup, item) => {
        lookup[item.num] = Number(item.qty || 0);
        return lookup;
      }, {}),
    [parsedJuriList.entries]
  );

  useEffect(() => {
    const shouldShowAdvanced =
      Boolean(editingTicketId) ||
      Boolean(customerName) ||
      Boolean(customerPhone) ||
      paymentMode !== "Paid" ||
      Boolean(paidAmount);

    setShowAdvanced(shouldShowAdvanced);
  }, [customerName, customerPhone, editingTicketId, paidAmount, paymentMode]);

  useEffect(() => {
    setEntryModal(buildEmptyModalState());
  }, [entryUiToken]);

  useEffect(() => {
    if (!entryModal.isOpen || !quantityInputRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const input = quantityInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    }, 30);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [entryModal.isOpen, entryModal.mode, entryModal.number]);

  useEffect(() => {
    if (!entryModal.isOpen || typeof document === "undefined") {
      return undefined;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
    };
  }, [entryModal.isOpen]);

  const activeHouse = activeEntryMode === "fourth" ? "fourth" : "third";
  const activeHouseValues = activeHouse === "fourth" ? fourth : third;
  const activeHouseEntries = activeHouse === "fourth" ? fourthEntries : thirdEntries;
  const activeHouseQty = activeHouse === "fourth" ? fourthQty : thirdQty;
  const activeHouseLabel = activeHouse === "fourth" ? "4TH HOUSE" : "3RD HOUSE";
  const activeModeQty = activeEntryMode === "juri" ? juriQty : activeHouseQty;
  const activeModeRows = activeEntryMode === "juri" ? parsedJuriList.entries.length : activeHouseEntries.length;
  const activeModePreviewRows =
    activeEntryMode === "juri"
      ? parsedJuriList.entries.map((entry) => `${entry.num}-${entry.qty}`)
      : activeHouseEntries.map((item) => `${item.digit}=${item.qty}`);

  const updateSingleQuantity = (house, digit, qty) => {
    const setter = house === "third" ? onThirdChange : onFourthChange;

    setter((current) => {
      const next = Array.isArray(current) ? [...current] : Array(10).fill("");
      next[digit] = qty > 0 ? String(qty) : "";
      return next;
    });
  };

  const closeEntryModal = () => {
    setEntryModal(buildEmptyModalState());
  };

  const openEntryModal = (mode, number) => {
    const normalizedNumber = formatEntryNumber(mode, number);
    const baseQty =
      mode === "juri"
        ? getJuriQuantity(juriText, normalizedNumber)
        : Number((mode === "fourth" ? fourth : third)[Number(normalizedNumber)] || 0);

    onActiveEntryModeChange(mode);
    setEntryModal({
      isOpen: true,
      mode,
      number: normalizedNumber,
      typedQty: "",
      baseQty,
      clearOnSave: false,
    });
  };

  const saveEntryModal = () => {
    if (!entryModal.isOpen) {
      return;
    }

    const typedAmount = Number(entryModal.typedQty || 0) || 0;

    if (!entryModal.clearOnSave && typedAmount <= 0) {
      closeEntryModal();
      return;
    }

    const nextQty = entryModal.clearOnSave ? 0 : entryModal.baseQty + typedAmount;

    if (entryModal.mode === "juri") {
      onJuriTextChange((current) => upsertJuriText(current, entryModal.number, nextQty));
    } else {
      updateSingleQuantity(entryModal.mode, Number(entryModal.number), nextQty);
    }

    closeEntryModal();
  };

  const handleQuantityKeyDown = (event) => {
    if (BLOCKED_QUANTITY_KEYS.has(event.key)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      saveEntryModal();
    }
  };

  const handleQuantityChange = (value) => {
    setEntryModal((current) => ({
      ...current,
      typedQty: sanitizeFastQuantity(value, 5),
      clearOnSave: false,
    }));
  };

  const clearModalQuantity = () => {
    setEntryModal((current) => ({
      ...current,
      typedQty: "",
      clearOnSave: current.baseQty > 0 || Boolean(current.typedQty),
    }));
  };

  const modalPreviewQty = entryModal.clearOnSave
    ? 0
    : entryModal.baseQty + (Number(entryModal.typedQty || 0) || 0);
  const modalPreviewText = formatPreviewValue(entryModal.mode, entryModal.number, modalPreviewQty);
  const modalHelperText = entryModal.clearOnSave
    ? entryModal.baseQty
      ? `Current qty ${entryModal.baseQty} will be cleared.`
      : "Quantity cleared."
    : entryModal.baseQty
      ? `Current ${entryModal.baseQty}${entryModal.typedQty ? ` + ${entryModal.typedQty}` : ""}`
      : "New entry";
  const notices = ticketActionNotice ? [ticketActionNotice] : [];
  const drawLabel = formatDrawTime(drawTime);

  const modalContent =
    entryModal.isOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fast-qty-modal-overlay" onClick={closeEntryModal}>
            <div className="fast-qty-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fast-qty-modal-head">
                <span>{getModeLabel(entryModal.mode)}</span>
              </div>

              <div className="fast-qty-modal-preview">
                <span>Live</span>
                <strong>{modalPreviewText}</strong>
                <small>{modalHelperText}</small>
              </div>

              <form
                className="fast-qty-modal-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveEntryModal();
                }}
              >
                <label className="fast-qty-field">
                  <span>Number</span>
                  <input type="text" value={formatEntryNumber(entryModal.mode, entryModal.number)} readOnly />
                </label>

                <label className="fast-qty-field fast-qty-field-large">
                  <span>Quantity</span>
                  <input
                    ref={quantityInputRef}
                    type="number"
                    inputMode="numeric"
                    autoFocus
                    enterKeyHint="done"
                    value={entryModal.typedQty}
                    onChange={(event) => handleQuantityChange(event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={handleQuantityKeyDown}
                  />
                </label>

                <div className="fast-qty-modal-actions">
                  <button type="button" className="outline-btn" onClick={clearModalQuantity}>
                    Clear
                  </button>
                  <button type="submit">Save Fix</button>
                  <button type="button" className="outline-btn" onClick={closeEntryModal}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="fast-entry-shell">
        <div className="fast-entry-topbar">
          <div className="section-header">
            <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Create New Ticket"}</h2>
            <span>Tap a number, type qty, save fast.</span>
          </div>

          <div className="fast-entry-top-actions">
            <button
              type="button"
              className="outline-btn"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide Details" : "Ticket Details"}
            </button>
          </div>
        </div>

        {notices.length > 0 ? (
          <div className="fast-entry-notice-stack">
            {notices.map((notice, index) => (
              <div key={`${notice.message}-${index}`} className={`fast-entry-inline-note ${notice.tone || "info"}`}>
                <span>{notice.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="fast-entry-booking-bar">
          <div className="fast-entry-booking-pill">
            <span>Booking</span>
            <strong>{effectiveTicketDate}</strong>
            <small>
              {drawLabel}
              {bookingDateAdjusted ? ` | moved after ${formatEntryCutoffTime(drawTime)}` : ""}
            </small>
          </div>

          <input
            type="date"
            min={todayString}
            max={maxBookingDate}
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />

          <select value={drawTime} onChange={(event) => onDrawTimeChange(event.target.value)}>
            {drawOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="fast-entry-booking-note">
          <strong>Booking For: {effectiveTicketDate}</strong>
          <span>
            {bookingDateAdjusted
              ? `${formatDrawTime(drawTime)} last entry closed at ${formatEntryCutoffTime(drawTime)} for ${date}. Ticket will go to ${effectiveTicketDate}.`
              : `${formatDrawTime(drawTime)} ticket entry is open for ${effectiveTicketDate} until ${formatEntryCutoffTime(drawTime)}.`}
          </span>
        </div>

        {showAdvanced ? (
          <div className="fast-entry-advanced-card">
            <div className="fast-entry-advanced-grid">
              <input
                value={customerName}
                onChange={(event) => onCustomerNameChange(event.target.value)}
                placeholder="Customer Name"
                autoComplete="off"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(event) => onCustomerPhoneChange(event.target.value)}
                placeholder="Customer Phone"
                inputMode="numeric"
                autoComplete="tel"
              />
              <select value={paymentMode} onChange={(event) => onPaymentModeChange(event.target.value)}>
                <option value="Paid">Paid</option>
                <option value="Partial Paid">Partial Paid</option>
                <option value="Unpaid">Unpaid</option>
              </select>
              <input
                type="tel"
                value={paidAmount}
                onChange={(event) => onPaidAmountChange(event.target.value)}
                placeholder="Paid Amount"
                disabled={paymentMode !== "Partial Paid"}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>

            <textarea
              className="bulk-textarea fast-entry-bulk-textarea"
              value={juriText}
              onChange={(event) => onJuriTextChange(event.target.value)}
              placeholder="45-5, 88-5, 04-10"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        ) : null}

        <div className="fast-entry-mode-toolbar">
          <div className="fast-mode-strip" aria-label="Fast ticket entry mode">
            <ModeButton
              active={activeEntryMode === "third"}
              label="3rd House"
              hint={`${thirdEntries.length} row | Qty ${thirdQty}`}
              onClick={() => onActiveEntryModeChange("third")}
            />
            <ModeButton
              active={activeEntryMode === "fourth"}
              label="4th House"
              hint={`${fourthEntries.length} row | Qty ${fourthQty}`}
              onClick={() => onActiveEntryModeChange("fourth")}
            />
            <ModeButton
              active={activeEntryMode === "juri"}
              label="Juri"
              hint={`${parsedJuriList.entries.length} row | Qty ${juriQty}`}
              onClick={() => onActiveEntryModeChange("juri")}
            />
          </div>

          <button
            type="button"
            className="outline-btn fast-entry-print-btn"
            onClick={onPrintDraft}
            disabled={previewItems.length === 0}
          >
            Print Preview
          </button>
        </div>

        <div className="fast-entry-workspace">
          {activeEntryMode === "juri" ? (
            <div className="fast-entry-panel glass-panel">
              <div className="fast-entry-panel-head">
                <div>
                  <strong>JURI PAGE</strong>
                  <span>Tap any pair, type quantity, then save that row.</span>
                </div>
                <small>Rows {parsedJuriList.entries.length}</small>
              </div>

              <div className="fast-entry-active-note">
                <span>Total Qty</span>
                <strong>{juriQty}</strong>
                <small>
                  {parsedJuriList.entries.length
                    ? `${parsedJuriList.entries.length} saved row(s)`
                    : "No juri rows yet."}
                </small>
              </div>

              <div className="fast-juri-grid">
                {JURI_GRID_VALUES.map((number) => {
                  const qty = juriLookup[number] || 0;
                  const isActive =
                    entryModal.isOpen && entryModal.mode === "juri" && entryModal.number === number;

                  return (
                    <button
                      key={number}
                      type="button"
                      aria-label={`juri number ${number} qty ${qty}`}
                      className={`fast-juri-cell ${qty > 0 ? "filled" : ""} ${isActive ? "active" : ""}`}
                      onClick={() => openEntryModal("juri", number)}
                    >
                      <span>{number}</span>
                      <strong>{qty || 0}</strong>
                    </button>
                  );
                })}
              </div>

              {parsedJuriList.invalid.length > 0 ? (
                <div className="fast-entry-error-line">
                  Invalid rows ignored: {parsedJuriList.invalid.join(", ")}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="fast-entry-panel glass-panel">
              <div className="fast-entry-panel-head">
                <div>
                  <strong>{activeHouseLabel} PAGE</strong>
                  <span>Tap any digit, type quantity, then save that row.</span>
                </div>
                <small>Rows {activeHouseEntries.length}</small>
              </div>

              <div className="fast-entry-active-note">
                <span>Total Qty</span>
                <strong>{activeHouseQty}</strong>
                <small>
                  {activeHouseEntries.length
                    ? `${activeHouseEntries.length} saved row(s)`
                    : "No house rows yet."}
                </small>
              </div>

              <div className="fast-house-grid">
                {activeHouseValues.map((value, index) => {
                  const isActive =
                    entryModal.isOpen &&
                    entryModal.mode === activeHouse &&
                    entryModal.number === formatEntryNumber(activeHouse, index);

                  return (
                    <button
                      key={`${activeHouse}-${index}`}
                      type="button"
                      aria-label={`${activeHouse} digit ${index} qty ${value || 0}`}
                      className={`fast-house-cell ${Number(value || 0) > 0 ? "filled" : ""} ${
                        isActive ? "active" : ""
                      }`}
                      onClick={() => openEntryModal(activeHouse, index)}
                    >
                      <span>{index}</span>
                      <strong>{value || 0}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <aside className="fast-entry-preview-panel glass-panel">
            <div className="fast-entry-preview-head">
              <div>
                <strong>Live Preview</strong>
                <span>
                  {getModeLabel(activeEntryMode)} | {effectiveTicketDate} | {drawLabel}
                </span>
              </div>
              <small>{previewItems.length ? "Print ready" : "Waiting for rows"}</small>
            </div>

            <div className="fast-entry-preview-highlight">
              <span>Current Page</span>
              <strong>{getModeLabel(activeEntryMode)}</strong>
              <small>
                {activeModeRows} row(s) | Qty {activeModeQty}
              </small>
            </div>

            <div className="fast-entry-preview-rows" aria-label="Current page rows">
              {activeModePreviewRows.length > 0 ? (
                activeModePreviewRows.map((row) => <span key={row}>{row}</span>)
              ) : (
                <small>No rows added on this page yet.</small>
              )}
            </div>

            {previewItems.length > 0 ? (
              <TicketFormat layout={previewLayout} compact />
            ) : (
              <div className="fast-entry-empty">Preview appears here while you enter ticket rows.</div>
            )}

            <div className="fast-entry-preview-stats">
              <div>
                <span>Total</span>
                <strong>{formatCurrency(previewSummary.total)}</strong>
              </div>
              <div>
                <span>Commission</span>
                <strong>{formatCurrency(previewSummary.commission)}</strong>
              </div>
              <div>
                <span>Items</span>
                <strong>{previewItems.length}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{formatCurrency(currentDue)}</strong>
              </div>
            </div>
          </aside>
        </div>

        {lastSavedTicketId ? (
          <div className="ticket-save-feedback fast-save-feedback">
            <div>
              <strong>Ticket #{lastSavedTicketId} saved</strong>
              <span>
                {lastSavedTicket
                  ? `${formatDrawTime(lastSavedTicket.drawTime)} | ${lastSavedTicket.date} | ${formatCurrency(lastSavedTicket.total)}`
                  : "Ready for the next ticket."}
              </span>
            </div>
            <div className="ticket-save-feedback-actions">
              <button type="button" className="outline-btn" onClick={onPrintSavedTicket}>
                Print Ticket
              </button>
              <button type="button" className="outline-btn" onClick={onDismissSavedTicket}>
                Hide
              </button>
            </div>
          </div>
        ) : null}

        <div className="fast-entry-footer">
          {showAdvanced ? (
            <div className="fast-entry-footer-meta">
              <span>Paid {formatCurrency(effectivePaidAmount)}</span>
              <span>Due {formatCurrency(currentDue)}</span>
            </div>
          ) : null}

          <div className="ticket-save-actions fast-entry-footer-actions">
            <button className="outline-btn" type="button" onClick={onReset}>
              {editingTicketId ? "Close Edit" : "Reset"}
            </button>
            <button type="button" onClick={onSave}>
              {editingTicketId ? "Update Ticket" : "Save Ticket"}
            </button>
          </div>
        </div>
      </div>

      {modalContent}
    </>
  );
}
