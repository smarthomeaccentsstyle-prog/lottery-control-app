import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./SellerFastEntryBoard.css";
import TicketFormat from "./TicketFormat.js";
import {
  getJuriQuantity,
  normalizeSingleDraft,
  parseFastJuriText,
  sanitizeFastDigits,
  sanitizeFastQuantity,
  upsertJuriText,
} from "../untils/fastEntry.js";

const SINGLE_RATE = 11;
const JURI_RATE = 10;
const EMPTY_MODE_INPUT = {
  number: "",
  quantity: "",
};
const PAYMENT_MODE_OPTIONS = ["Paid", "Partial", "Unpaid"];

const MODE_META = {
  third: {
    label: "3rd House",
    shortLabel: "3H",
    digits: 1,
    rate: SINGLE_RATE,
  },
  fourth: {
    label: "4th House",
    shortLabel: "4H",
    digits: 1,
    rate: SINGLE_RATE,
  },
  juri: {
    label: "Juri",
    shortLabel: "J",
    digits: 2,
    rate: JURI_RATE,
  },
};

const ENTRY_SURFACE_ORDER = ["info", "third", "fourth", "juri", "save", "print"];
const ENTRY_SURFACE_LABELS = {
  info: "Info",
  third: "3rd",
  fourth: "4th",
  juri: "Juri",
  save: "Save",
  print: "Print",
};

function buildInputState() {
  return {
    third: { ...EMPTY_MODE_INPUT },
    fourth: { ...EMPTY_MODE_INPUT },
    juri: { ...EMPTY_MODE_INPUT },
  };
}

function getModeMeta(mode) {
  return MODE_META[mode] || MODE_META.third;
}

function mapItemTypeToMode(type) {
  if (type === "single4") {
    return "fourth";
  }

  if (type === "juri") {
    return "juri";
  }

  return "third";
}

function formatEntryNumber(mode, value) {
  const digits = sanitizeFastDigits(value, getModeMeta(mode).digits);

  if (mode === "juri") {
    return digits.padStart(2, "0");
  }

  return digits.slice(0, 1);
}

function normalizePaymentModeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "unpaid") {
    return "Unpaid";
  }

  if (normalized.includes("partial")) {
    return "Partial";
  }

  return "Paid";
}

function getDueInputValue(paymentMode, paidAmount, currentDue, totalAmount) {
  const normalizedMode = normalizePaymentModeLabel(paymentMode);
  const safeTotal = Math.max(Number(totalAmount || 0), 0);

  if (normalizedMode === "Partial") {
    return paidAmount === "" ? "" : String(Math.max(Math.min(Number(currentDue || 0), safeTotal), 0));
  }

  if (normalizedMode === "Unpaid") {
    return safeTotal > 0 ? String(safeTotal) : "";
  }

  return safeTotal > 0 ? "0" : "";
}

function buildPreviewRowKey(mode, value) {
  return `${mode}-${formatEntryNumber(mode, value)}`;
}

function createNormalizedDraftSnapshot(draft) {
  return {
    third: normalizeSingleDraft(draft && draft.third),
    fourth: normalizeSingleDraft(draft && draft.fourth),
    juriText: String((draft && draft.juriText) || ""),
  };
}

function buildModeRows(third, fourth, juriEntries) {
  return {
    third: normalizeSingleDraft(third)
      .map((qty, number) => ({
        key: `third-${number}`,
        mode: "third",
        number: String(number),
        qty: Number(qty || 0),
      }))
      .filter((row) => row.qty > 0),
    fourth: normalizeSingleDraft(fourth)
      .map((qty, number) => ({
        key: `fourth-${number}`,
        mode: "fourth",
        number: String(number),
        qty: Number(qty || 0),
      }))
      .filter((row) => row.qty > 0),
    juri: (Array.isArray(juriEntries) ? juriEntries : [])
      .map((entry) => ({
        key: `juri-${formatEntryNumber("juri", entry.num)}`,
        mode: "juri",
        number: formatEntryNumber("juri", entry.num),
        qty: Number(entry.qty || 0),
      }))
      .filter((row) => row.qty > 0),
  };
}

function buildModeStats(mode, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const qty = safeRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  return {
    rows: safeRows.length,
    qty,
    amount: qty * getModeMeta(mode).rate,
  };
}

function buildPreviewRows(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const mode = mapItemTypeToMode(item.type);

    return {
      key: `${mode}-${formatEntryNumber(mode, item.num)}`,
      mode,
      tag: getModeMeta(mode).shortLabel,
      number: formatEntryNumber(mode, item.num),
      qty: Number(item.qty || 0),
      amount: Number(item.total || 0),
    };
  });
}

function scrollFieldIntoView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }

  window.setTimeout(() => {
    node.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
  }, 120);
}

function ModeStat({ label, value }) {
  return (
    <div className="seller-entry-mode-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SellerEntryPopupTabs({ activePanel, onChange }) {
  return (
    <div className="seller-popup-tabs" role="tablist" aria-label="Ticket entry popup menu">
      {ENTRY_SURFACE_ORDER.map((panel) => (
        <button
          key={panel}
          type="button"
          role="tab"
          aria-selected={activePanel === panel}
          className={`seller-popup-tab ${activePanel === panel ? "active" : ""}`}
          onClick={() => onChange(panel)}
        >
          <span>{ENTRY_SURFACE_LABELS[panel]}</span>
        </button>
      ))}
    </div>
  );
}

function HouseDigitPad({ selectedDigit, onSelectDigit }) {
  return (
    <div className="seller-manual-digit-pad" aria-label="Digit pad">
      {Array.from({ length: 10 }, (_, digit) => String(digit)).map((digit) => (
        <button
          key={digit}
          type="button"
          className={`seller-manual-digit-btn ${selectedDigit === digit ? "active" : ""}`}
          onClick={() => onSelectDigit(digit)}
        >
          {digit}
        </button>
      ))}
    </div>
  );
}

function EntryMiniPreviewPanel({ formatCurrency, hasPreviewRows, previewLayout, previewSummary }) {
  const totalQty = Number(previewSummary.singleQty || 0) + Number(previewSummary.juriQty || 0);

  return (
    <section className="seller-entry-mini-preview">
      <div className="seller-entry-mini-preview-head">
        <div>
          <span>Show</span>
          <strong>
            {hasPreviewRows
              ? "Small live preview of the numbers you entered."
              : "The numbers you enter will show here instantly."}
          </strong>
        </div>
        <small>{formatCurrency(previewSummary.total || 0)}</small>
      </div>

      <div className="seller-entry-mini-preview-stats">
        <div className="seller-entry-mini-preview-stat">
          <span>Numbers</span>
          <strong>{previewSummary.rows || 0}</strong>
        </div>
        <div className="seller-entry-mini-preview-stat">
          <span>Qty</span>
          <strong>{totalQty}</strong>
        </div>
        <div className="seller-entry-mini-preview-stat">
          <span>Total</span>
          <strong>{formatCurrency(previewSummary.total || 0)}</strong>
        </div>
      </div>

      {hasPreviewRows ? (
        <div className="seller-entry-mini-preview-format">
          <TicketFormat layout={previewLayout} compact />
        </div>
      ) : (
        <div className="seller-entry-mini-preview-empty">
          Add a number and the compact preview will update here.
        </div>
      )}
    </section>
  );
}

function LivePreviewPanel({
  currentDue,
  effectivePaidAmount,
  formatCurrency,
  hasPreviewRows,
  paymentMode,
  previewLayout,
  previewSummary,
}) {
  return (
    <section className="seller-live-preview-card">
      <div className="seller-live-preview-head">
        <div>
          <span>Live Ticket Preview</span>
          <strong>{hasPreviewRows ? "Preview updates instantly while you enter rows." : "Preview appears as soon as you add a row."}</strong>
        </div>
        <small>{paymentMode}</small>
      </div>

      <div className="seller-live-preview-stats">
        <div className="seller-live-preview-stat">
          <span>Numbers</span>
          <strong>{previewSummary.rows || 0}</strong>
        </div>
        <div className="seller-live-preview-stat">
          <span>Total</span>
          <strong>{formatCurrency(previewSummary.total || 0)}</strong>
        </div>
        <div className="seller-live-preview-stat">
          <span>Paid</span>
          <strong>{formatCurrency(effectivePaidAmount || 0)}</strong>
        </div>
        <div className="seller-live-preview-stat">
          <span>Due</span>
          <strong>{formatCurrency(currentDue || 0)}</strong>
        </div>
      </div>

      {hasPreviewRows ? (
        <div className="seller-live-preview-format">
          <TicketFormat layout={previewLayout} compact />
        </div>
      ) : (
        <div className="seller-live-preview-empty">
          Tap `3rd`, `4th`, or `Juri`, enter quantity fast, and the ticket preview will show here immediately.
        </div>
      )}
    </section>
  );
}

function ManualRecentStrip({ canClear, editingKey, rows, onClearTicket, onDelete, onEdit }) {
  return (
    <section className="seller-manual-recent-block">
      <div className="seller-manual-recent-head">
        <div>
          <span>Show</span>
          <strong>{rows.length > 0 ? `${rows.length} entered number(s)` : "No number entered yet"}</strong>
        </div>
        <div className="seller-manual-recent-actions">
          <small>Edit or delete without leaving this screen.</small>
          <button
            type="button"
            className="outline-btn seller-entry-quiet-btn"
            onClick={onClearTicket}
            disabled={!canClear}
          >
            Clear Ticket
          </button>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="seller-manual-chip-list" aria-label="Recent ticket rows">
          {rows.map((row) => (
            <div
              key={row.key}
              className={`seller-manual-chip seller-manual-chip-${row.mode} ${
                editingKey === row.key ? "editing" : ""
              }`}
            >
              <div className="seller-manual-chip-copy">
                <span>{row.tag}</span>
                <strong>
                  {row.number} × {row.qty}
                </strong>
              </div>
              <div className="seller-manual-chip-actions">
                <button type="button" onClick={() => onEdit(row)} aria-label={`Edit ${row.tag} ${row.number}`}>
                  Edit
                </button>
                <button type="button" onClick={() => onDelete(row)} aria-label={`Delete ${row.tag} ${row.number}`}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="seller-manual-recent-empty">
          Your entered numbers show here instantly, and you can edit or delete them anytime.
        </div>
      )}
    </section>
  );
}

function SavedTicketBanner({
  formatCurrency,
  formatDrawTime,
  lastSavedTicket,
  lastSavedTicketId,
  onDismissSavedTicket,
  onPrintSavedTicket,
}) {
  if (!lastSavedTicketId) {
    return null;
  }

  const savedTicketMeta = [];

  if (lastSavedTicket && lastSavedTicket.date) {
    savedTicketMeta.push(lastSavedTicket.date);
  }

  if (lastSavedTicket && lastSavedTicket.drawTime) {
    savedTicketMeta.push(formatDrawTime(lastSavedTicket.drawTime));
  }

  if (lastSavedTicket && lastSavedTicket.customerName) {
    savedTicketMeta.push(lastSavedTicket.customerName);
  }

  if (lastSavedTicket && typeof lastSavedTicket.total === "number") {
    savedTicketMeta.push(formatCurrency(lastSavedTicket.total));
  }

  return (
    <div className="seller-manual-saved-ticket">
      <div className="seller-manual-saved-copy">
        <span>Last Saved Ticket</span>
        <strong>
          Ticket #{lastSavedTicket && lastSavedTicket.id ? lastSavedTicket.id : lastSavedTicketId}
        </strong>
        <small>
          {savedTicketMeta.length > 0
            ? savedTicketMeta.join(" | ")
            : "Saved ticket is ready to reprint from this section."}
        </small>
      </div>
      <div className="seller-manual-saved-actions">
        <button
          type="button"
          className="outline-btn seller-entry-quiet-btn"
          onClick={onPrintSavedTicket}
        >
          Reprint Saved
        </button>
        <button
          type="button"
          className="outline-btn seller-entry-quiet-btn"
          onClick={onDismissSavedTicket}
        >
          Hide
        </button>
      </div>
    </div>
  );
}

function SellerEntryInfoPanel({
  bookingDateAdjusted,
  currentDate,
  currentDrawLabel,
  date,
  draftTicketId,
  drawOptions,
  drawTime,
  formatCurrency,
  formatEntryCutoffTime,
  maxBookingDate,
  onDateChange,
  onDrawTimeChange,
  previewSummary,
  todayString,
}) {
  const totalAmount = Number(previewSummary && previewSummary.total ? previewSummary.total : 0);

  return (
    <section className="seller-popup-panel seller-popup-info-panel">
      <div className="seller-popup-copy fast-entry-booking-pill">
        <span>Booking For</span>
        <strong>{currentDate}</strong>
        <small>
          {bookingDateAdjusted
            ? `${currentDrawLabel} last entry closed at ${formatEntryCutoffTime(drawTime)} for ${date}. Ticket moves to ${currentDate}.`
            : `${currentDrawLabel} ticket entry is open for ${currentDate} until ${formatEntryCutoffTime(drawTime)}.`}
        </small>
      </div>

      <div className="seller-popup-meta-grid">
        <div className="seller-popup-meta-card">
          <span>Ticket No.</span>
          <strong>{draftTicketId}</strong>
        </div>
        <div className="seller-popup-meta-card">
          <span>Numbers</span>
          <strong>{previewSummary.rows || 0}</strong>
        </div>
        <div className="seller-popup-meta-card seller-popup-meta-card-wide">
          <span>Total</span>
          <strong>{formatCurrency(totalAmount)}</strong>
        </div>
      </div>

      <div className="seller-popup-control-grid">
        <label className="fast-entry-control">
          <span>Date</span>
          <input
            type="date"
            min={todayString}
            max={maxBookingDate}
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </label>

        <label className="fast-entry-control">
          <span>Draw</span>
          <select value={drawTime} onChange={(event) => onDrawTimeChange(event.target.value)}>
            {drawOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function SellerEntrySavePanel({
  canClearTicket,
  canSave,
  canUndo,
  currentDue,
  customerName,
  customerPhone,
  effectivePaidAmount,
  onCustomerNameChange,
  formatCurrency,
  onCustomerPhoneChange,
  onPaidAmountChange,
  onPaymentModeChange,
  onClearMode,
  onClearTicket,
  onDeleteRow,
  onEditRow,
  onSaveTicket,
  onUndoLast,
  paidAmount,
  paymentMode,
  previewSummary,
  recentRows,
  saving,
  saveBlockMessage,
  editingKey,
}) {
  const singleAmount = Number(previewSummary.singleQty || 0) * SINGLE_RATE;
  const juriAmount = Number(previewSummary.juriQty || 0) * JURI_RATE;
  const totalAmount = Number(previewSummary.total || 0);
  const normalizedPaymentMode = normalizePaymentModeLabel(paymentMode);
  const dueInputValue = getDueInputValue(normalizedPaymentMode, paidAmount, currentDue, totalAmount);
  const partialPaymentPending = normalizedPaymentMode === "Partial" && String(paidAmount || "") === "";

  const handlePaymentModeSelect = (nextMode) => {
    onPaymentModeChange(nextMode);

    if (nextMode === "Paid") {
      onPaidAmountChange("");
      return;
    }

    if (nextMode === "Unpaid") {
      onPaidAmountChange("0");
      return;
    }

    onPaidAmountChange("");
  };

  const handleDueAmountChange = (value) => {
    const digits = String(value || "").replace(/[^\d]/g, "");

    if (!digits) {
      onPaymentModeChange("Partial");
      onPaidAmountChange("");
      return;
    }

    const dueAmount = Math.min(Number(digits), totalAmount);

    if (dueAmount <= 0) {
      onPaymentModeChange("Paid");
      onPaidAmountChange("");
      return;
    }

    if (dueAmount >= totalAmount) {
      onPaymentModeChange("Unpaid");
      onPaidAmountChange("0");
      return;
    }

    onPaymentModeChange("Partial");
    onPaidAmountChange(String(totalAmount - dueAmount));
  };

  return (
    <section className="seller-popup-panel seller-popup-save-panel">
      <ManualRecentStrip
        canClear={canClearTicket}
        editingKey={editingKey}
        rows={recentRows}
        onClearTicket={onClearTicket}
        onDelete={onDeleteRow}
        onEdit={onEditRow}
      />

      <div className="seller-payment-panel">
        <div className="seller-payment-panel-head">
          <div>
            <span>Save Details</span>
            <strong>Due option, payment status, and optional customer details.</strong>
          </div>
          <small>{normalizedPaymentMode}</small>
        </div>

        <div className="seller-payment-mode-grid" role="group" aria-label="Payment mode">
          {PAYMENT_MODE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`seller-payment-mode-btn ${normalizedPaymentMode === option ? "active" : ""}`}
              onClick={() => handlePaymentModeSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="seller-payment-field-grid">
          <label className="seller-entry-field seller-payment-field">
            <span>Name Optional</span>
            <input
              type="text"
              aria-label="Customer name"
              placeholder="Walk-in Customer"
              value={customerName}
              onChange={(event) => onCustomerNameChange(event.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="seller-entry-field seller-payment-field">
            <span>Phone Optional</span>
            <input
              type="tel"
              inputMode="numeric"
              aria-label="Customer phone"
              placeholder="Optional phone"
              value={customerPhone}
              onChange={(event) => onCustomerPhoneChange(event.target.value.replace(/[^\d]/g, ""))}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="seller-payment-bottom-grid">
          <label className="seller-entry-field seller-payment-field">
            <span>Due Amount</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Due amount"
              placeholder="0"
              value={dueInputValue}
              onChange={(event) => handleDueAmountChange(event.target.value)}
              readOnly={normalizedPaymentMode !== "Partial"}
            />
          </label>

          <div className="seller-payment-summary-grid">
            <div className="seller-payment-summary-cell">
              <span>Total</span>
              <strong>{formatCurrency(totalAmount)}</strong>
            </div>
            <div className="seller-payment-summary-cell">
              <span>Paid</span>
              <strong>{formatCurrency(effectivePaidAmount || 0)}</strong>
            </div>
            <div className="seller-payment-summary-cell">
              <span>Due</span>
              <strong>{formatCurrency(currentDue || 0)}</strong>
            </div>
          </div>
        </div>

        <div className={`seller-payment-helper ${partialPaymentPending ? "warning" : ""}`}>
          {partialPaymentPending
            ? saveBlockMessage
            : "If name is empty the ticket will save as Walk-in Customer. Phone is optional too."}
        </div>
      </div>

      <div className="seller-manual-dock-wrap">
        <div className="seller-manual-totals-bar">
          <div className="seller-manual-total-cell">
            <span>Single Qty</span>
            <strong>{previewSummary.singleQty || 0}</strong>
          </div>
          <div className="seller-manual-total-cell">
            <span>Single Amt</span>
            <strong>{formatCurrency(singleAmount)}</strong>
          </div>
          <div className="seller-manual-total-cell">
            <span>Juri Qty</span>
            <strong>{previewSummary.juriQty || 0}</strong>
          </div>
          <div className="seller-manual-total-cell">
            <span>Juri Amt</span>
            <strong>{formatCurrency(juriAmount)}</strong>
          </div>
          <div className="seller-manual-total-cell seller-manual-total-cell-grand">
            <span>Grand Total</span>
            <strong>{formatCurrency(previewSummary.total || 0)}</strong>
          </div>
        </div>

        <div className="seller-manual-action-bar seller-popup-save-actions">
          <button
            type="button"
            className="outline-btn seller-entry-quiet-btn"
            onClick={onUndoLast}
            disabled={!canUndo || saving}
          >
            Undo Last
          </button>
          <button
            type="button"
            className="outline-btn seller-entry-quiet-btn"
            onClick={onClearMode}
            disabled={saving}
          >
            Clear Current Mode
          </button>
          <button
            type="button"
            className="outline-btn seller-entry-quiet-btn"
            onClick={onClearTicket}
            disabled={!canClearTicket || saving}
          >
            Clear Ticket
          </button>
          <button
            type="button"
            className="seller-entry-save-btn"
            onClick={onSaveTicket}
            disabled={!canSave || saving}
          >
            {saving ? "Saving..." : "Save Ticket"}
          </button>
        </div>
      </div>
    </section>
  );
}

function SellerEntryPrintPanel({
  canPrintDraft,
  currentDue,
  draftTicketId,
  effectivePaidAmount,
  formatCurrency,
  formatDrawTime,
  lastSavedTicket,
  lastSavedTicketId,
  onDismissSavedTicket,
  onPrintDraft,
  onPrintSavedTicket,
  paymentMode,
  previewLayout,
  previewSummary,
  saving,
}) {
  return (
    <section className="seller-popup-panel seller-popup-print-panel">
      <div className="seller-popup-copy">
        <span>Print Ticket</span>
        <strong>Ticket #{draftTicketId}</strong>
        <small>Print from here before save, and the same ticket number will be stored.</small>
      </div>

      <LivePreviewPanel
        currentDue={currentDue}
        effectivePaidAmount={effectivePaidAmount}
        formatCurrency={formatCurrency}
        hasPreviewRows={Number(previewSummary.rows || 0) > 0}
        paymentMode={paymentMode}
        previewLayout={previewLayout}
        previewSummary={previewSummary}
      />

      <div className="seller-popup-print-actions">
        <button
          type="button"
          className="outline-btn seller-entry-quiet-btn seller-entry-print-btn"
          onClick={onPrintDraft}
          disabled={!canPrintDraft || saving}
        >
          Print Ticket
        </button>
      </div>

      <SavedTicketBanner
        formatCurrency={formatCurrency}
        formatDrawTime={formatDrawTime}
        lastSavedTicket={lastSavedTicket}
        lastSavedTicketId={lastSavedTicketId}
        onDismissSavedTicket={onDismissSavedTicket}
        onPrintSavedTicket={onPrintSavedTicket}
      />
    </section>
  );
}

function SuperFastManualTool({
  activeMode,
  activePanel,
  bookingDateAdjusted,
  canClearTicket,
  canPrintDraft,
  canSave,
  canUndo,
  currentDue,
  currentDate,
  currentDrawLabel,
  customerName,
  customerPhone,
  date,
  draftTicketId,
  draft,
  drawOptions,
  drawTime,
  editingKey,
  effectivePaidAmount,
  formatCurrency,
  formatDrawTime,
  formatEntryCutoffTime,
  isEditing,
  lastSavedTicket,
  lastSavedTicketId,
  onAddRow,
  onChangePanel,
  onClearMode,
  onClearTicket,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onDateChange,
  onDeleteRow,
  onDismissSavedTicket,
  onDrawTimeChange,
  onEditRow,
  onNumberChange,
  onPaidAmountChange,
  onPaymentModeChange,
  onPrintDraft,
  onPrintSavedTicket,
  onQuantityChange,
  onSaveTicket,
  onSelectDigit,
  onUndoLast,
  maxBookingDate,
  paidAmount,
  previewSummary,
  quantityRef,
  recentRows,
  saveBlockMessage,
  savingTicket,
  stats,
  numberRef,
  paymentMode,
  previewLayout,
  todayString,
}) {
  const meta = getModeMeta(activeMode);
  const canSubmit = draft.number.length === meta.digits && Number(draft.quantity || 0) > 0;

  return (
    <div className="seller-manual-layout">
      <section className={`seller-entry-panel seller-manual-tool seller-manual-tool-${activeMode}`}>
        <SellerEntryPopupTabs activePanel={activePanel} onChange={onChangePanel} />

        {activePanel === "info" ? (
          <SellerEntryInfoPanel
            bookingDateAdjusted={bookingDateAdjusted}
            currentDate={currentDate}
            currentDrawLabel={currentDrawLabel}
            date={date}
            draftTicketId={draftTicketId}
            drawOptions={drawOptions}
            drawTime={drawTime}
            formatCurrency={formatCurrency}
            formatEntryCutoffTime={formatEntryCutoffTime}
            maxBookingDate={maxBookingDate}
            onDateChange={onDateChange}
            onDrawTimeChange={onDrawTimeChange}
            previewSummary={previewSummary}
            todayString={todayString}
          />
        ) : null}

        {["third", "fourth", "juri"].includes(activePanel) ? (
          <div className={`seller-manual-entry-shell seller-manual-entry-shell-${activeMode}`}>
            <div className="seller-manual-mode-copy">
              <span>{meta.label}</span>
              <strong>{isEditing ? "Update current number" : "Add number"}</strong>
              <small>
                {activeMode === "juri"
                  ? "Type a two-digit number and quantity, then add the number."
                  : "Tap a digit, type quantity, and add the number."}
              </small>
            </div>

            <div className="seller-manual-mode-stats">
              <ModeStat label="Numbers" value={stats.rows} />
              <ModeStat label="Qty" value={stats.qty} />
              <ModeStat label="Amount" value={formatCurrency(stats.amount)} />
            </div>

            <EntryMiniPreviewPanel
              formatCurrency={formatCurrency}
              hasPreviewRows={Number(previewSummary.rows || 0) > 0}
              previewLayout={previewLayout}
              previewSummary={previewSummary}
            />

            {activeMode === "juri" ? (
              <div className="seller-manual-juri-form">
                <label className="seller-entry-field">
                  <span>Juri Number</span>
                  <input
                    ref={numberRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint="next"
                    maxLength={2}
                    value={draft.number}
                    placeholder="08"
                    onChange={(event) => onNumberChange(event.target.value)}
                  />
                </label>

                <label className="seller-entry-field">
                  <span>Quantity</span>
                  <input
                    ref={quantityRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint="done"
                    value={draft.quantity}
                    placeholder="0"
                    onChange={(event) => onQuantityChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onAddRow();
                      }
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="seller-manual-primary-btn"
                  onClick={onAddRow}
                  disabled={!canSubmit}
                >
                  {isEditing ? "Update Number" : "Add Number"}
                </button>
              </div>
            ) : (
              <div className="seller-manual-house-form">
                <div className="seller-manual-selected-digit">
                  <span>Selected Number</span>
                  <strong>{draft.number || "-"}</strong>
                </div>

                <HouseDigitPad selectedDigit={draft.number} onSelectDigit={onSelectDigit} />

                <div className="seller-manual-house-actions">
                  <label className="seller-entry-field">
                    <span>Quantity</span>
                    <input
                      ref={quantityRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="done"
                      value={draft.quantity}
                      placeholder="0"
                      onChange={(event) => onQuantityChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onAddRow();
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    className="seller-manual-primary-btn"
                    onClick={onAddRow}
                    disabled={!canSubmit}
                  >
                    {isEditing ? "Update Number" : "Add Number"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {activePanel === "save" ? (
          <SellerEntrySavePanel
            canClearTicket={canClearTicket}
            canSave={canSave}
            canUndo={canUndo}
            currentDue={currentDue}
            customerName={customerName}
            customerPhone={customerPhone}
            editingKey={editingKey}
            effectivePaidAmount={effectivePaidAmount}
            formatCurrency={formatCurrency}
            onCustomerNameChange={onCustomerNameChange}
            onCustomerPhoneChange={onCustomerPhoneChange}
            onPaidAmountChange={onPaidAmountChange}
            onPaymentModeChange={onPaymentModeChange}
            onClearMode={onClearMode}
            onClearTicket={onClearTicket}
            onDeleteRow={onDeleteRow}
            onEditRow={onEditRow}
            onSaveTicket={onSaveTicket}
            onUndoLast={onUndoLast}
            paidAmount={paidAmount}
            paymentMode={paymentMode}
            previewSummary={previewSummary}
            recentRows={recentRows}
            saveBlockMessage={saveBlockMessage}
            saving={savingTicket}
          />
        ) : null}

        {activePanel === "print" ? (
          <SellerEntryPrintPanel
            canPrintDraft={canPrintDraft}
            currentDue={currentDue}
            draftTicketId={draftTicketId}
            effectivePaidAmount={effectivePaidAmount}
            formatCurrency={formatCurrency}
            formatDrawTime={formatDrawTime}
            lastSavedTicket={lastSavedTicket}
            lastSavedTicketId={lastSavedTicketId}
            onDismissSavedTicket={onDismissSavedTicket}
            onPrintDraft={onPrintDraft}
            onPrintSavedTicket={onPrintSavedTicket}
            paymentMode={paymentMode}
            previewLayout={previewLayout}
            previewSummary={previewSummary}
            saving={savingTicket}
          />
        ) : null}
      </section>
    </div>
  );
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
  draftTicketId,
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
  const [modeInputs, setModeInputs] = useState(() => buildInputState());
  const [editState, setEditState] = useState(null);
  const [activePanel, setActivePanel] = useState("info");
  const [statusNotice, setStatusNotice] = useState(null);
  const [savingTicket, setSavingTicket] = useState(false);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [recentKeys, setRecentKeys] = useState([]);
  const inputRefs = useRef({
    third: { number: null, quantity: null },
    fourth: { number: null, quantity: null },
    juri: { number: null, quantity: null },
  });
  const focusTimeoutRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const draftHistoryRef = useRef([]);
  const draftOverrideRef = useRef(
    createNormalizedDraftSnapshot({
      third,
      fourth,
      juriText,
    })
  );

  const parsedJuriList = useMemo(() => parsedJuri || parseFastJuriText(juriText), [juriText, parsedJuri]);
  const modeRows = useMemo(
    () => buildModeRows(third, fourth, parsedJuriList.entries),
    [fourth, parsedJuriList.entries, third]
  );
  const previewRows = useMemo(() => buildPreviewRows(previewItems), [previewItems]);
  const hasPreviewRows = previewRows.length > 0;
  const normalizedPaymentMode = normalizePaymentModeLabel(paymentMode);
  const partialPaymentPending = normalizedPaymentMode === "Partial" && String(paidAmount || "") === "";
  const canSaveTicket = hasPreviewRows && !partialPaymentPending;
  const currentModeMeta = getModeMeta(activeEntryMode);
  const activeInputs = modeInputs[activeEntryMode];
  const activeModeStats = useMemo(
    () => buildModeStats(activeEntryMode, modeRows[activeEntryMode] || []),
    [activeEntryMode, modeRows]
  );
  const recentPreviewRows = useMemo(() => {
    const lookup = new Map(previewRows.map((row) => [row.key, row]));
    const orderedRecentRows = recentKeys
      .map((key) => lookup.get(key))
      .filter(Boolean);
    const fallbackRows = previewRows.filter((row) => !recentKeys.includes(row.key));

    return [...orderedRecentRows, ...fallbackRows].slice(0, 18);
  }, [previewRows, recentKeys]);
  const inlineNotices = [ticketActionNotice, statusNotice].filter(Boolean);

  useEffect(() => {
    draftOverrideRef.current = createNormalizedDraftSnapshot({
      third,
      fourth,
      juriText,
    });
  }, [fourth, juriText, third]);

  useEffect(() => {
    setModeInputs(buildInputState());
    setActivePanel("info");
    setEditState(null);
    setRecentKeys([]);
    draftHistoryRef.current = [];
    setHistoryDepth(0);
  }, [entryUiToken]);

  useEffect(() => {
    return () => {
      window.clearTimeout(focusTimeoutRef.current);
      window.clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  const registerInputRef = useCallback((mode, field) => {
    return (node) => {
      inputRefs.current[mode][field] = node;
    };
  }, []);

  const scheduleFocus = useCallback((mode, field) => {
    window.clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = window.setTimeout(() => {
      const target = inputRefs.current[mode] && inputRefs.current[mode][field];

      if (!target) {
        return;
      }

      target.focus();

      if (typeof target.select === "function") {
        target.select();
      }

      scrollFieldIntoView(target);
    }, 80);
  }, []);

  const showNotice = useCallback((message, tone = "info") => {
    setStatusNotice({
      message,
      tone,
    });
    window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = window.setTimeout(() => {
      setStatusNotice(null);
    }, 2200);
  }, []);

  const rememberDraftForUndo = useCallback((snapshot) => {
    const normalizedSnapshot = createNormalizedDraftSnapshot(snapshot || draftOverrideRef.current);
    const stack = draftHistoryRef.current;
    const serializedSnapshot = JSON.stringify(normalizedSnapshot);
    const lastSnapshot = stack.length > 0 ? JSON.stringify(stack[stack.length - 1]) : "";

    if (serializedSnapshot === lastSnapshot) {
      return;
    }

    stack.push(normalizedSnapshot);

    if (stack.length > 24) {
      stack.shift();
    }

    setHistoryDepth(stack.length);
  }, []);

  const rememberRecentRows = useCallback((keys) => {
    const normalizedKeys = Array.isArray(keys)
      ? keys.map((key) => String(key || "").trim()).filter(Boolean)
      : [];

    if (normalizedKeys.length === 0) {
      return;
    }

    setRecentKeys((current) => {
      const next = [...normalizedKeys, ...current.filter((key) => !normalizedKeys.includes(key))];
      return next.slice(0, 18);
    });
  }, []);

  const updateModeInput = useCallback((mode, field, value) => {
    setModeInputs((current) => {
      const nextValue =
        field === "number"
          ? sanitizeFastDigits(value, getModeMeta(mode).digits)
          : sanitizeFastQuantity(value, 5);

      return {
        ...current,
        [mode]: {
          ...current[mode],
          [field]: nextValue,
        },
      };
    });
  }, []);

  const clearModeInputs = useCallback((mode) => {
    setModeInputs((current) => ({
      ...current,
      [mode]: {
        ...EMPTY_MODE_INPUT,
      },
    }));
  }, []);

  const commitDraft = useCallback(
    (nextDraft) => {
      const normalizedDraft = createNormalizedDraftSnapshot(nextDraft);
      draftOverrideRef.current = normalizedDraft;
      onThirdChange(normalizedDraft.third);
      onFourthChange(normalizedDraft.fourth);
      onJuriTextChange(normalizedDraft.juriText);
    },
    [onFourthChange, onJuriTextChange, onThirdChange]
  );

  const getDraftQuantity = useCallback((draft, mode, number) => {
    if (mode === "juri") {
      return Number(getJuriQuantity(draft.juriText, number) || 0);
    }

    const source = mode === "fourth" ? draft.fourth : draft.third;
    return Number(source[Number(number)] || 0);
  }, []);

  const setDraftQuantity = useCallback((draft, mode, number, quantity) => {
    const normalizedDraft = createNormalizedDraftSnapshot(draft);

    if (mode === "juri") {
      normalizedDraft.juriText = upsertJuriText(normalizedDraft.juriText, number, quantity);
      return normalizedDraft;
    }

    const target = mode === "fourth" ? normalizedDraft.fourth : normalizedDraft.third;
    target[Number(number)] = quantity > 0 ? String(quantity) : "";
    return normalizedDraft;
  }, []);

  const handleModeChange = useCallback(
    (mode) => {
      if (mode === activeEntryMode) {
        scheduleFocus(mode, mode === "juri" ? "number" : "quantity");
        return;
      }

      setEditState((current) => (current && current.mode === mode ? current : null));
      onActiveEntryModeChange(mode);
      scheduleFocus(mode, mode === "juri" ? "number" : "quantity");
    },
    [activeEntryMode, onActiveEntryModeChange, scheduleFocus]
  );

  const handlePanelChange = useCallback(
    (panel) => {
      setActivePanel(panel);

      if (MODE_META[panel]) {
        handleModeChange(panel);
      }
    },
    [handleModeChange]
  );

  const handleManualDigitSelect = useCallback(
    (digit) => {
      if (activeEntryMode === "juri") {
        return;
      }

      updateModeInput(activeEntryMode, "number", digit);
      scheduleFocus(activeEntryMode, "quantity");
    },
    [activeEntryMode, scheduleFocus, updateModeInput]
  );

  const handleManualSubmit = useCallback(() => {
    const entryNumber = sanitizeFastDigits(activeInputs.number, currentModeMeta.digits);
    const entryQty = Number(sanitizeFastQuantity(activeInputs.quantity, 5) || 0);

    if (entryNumber.length !== currentModeMeta.digits || entryQty <= 0) {
      return;
    }

    rememberDraftForUndo(draftOverrideRef.current);

    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);
    const normalizedNumber = formatEntryNumber(activeEntryMode, entryNumber);

    if (editState && editState.mode === activeEntryMode) {
      nextDraft = setDraftQuantity(nextDraft, activeEntryMode, editState.originalNumber, 0);
    }

    const mergedQuantity =
      getDraftQuantity(nextDraft, activeEntryMode, normalizedNumber) + entryQty;
    nextDraft = setDraftQuantity(nextDraft, activeEntryMode, normalizedNumber, mergedQuantity);
    commitDraft(nextDraft);
    rememberRecentRows([buildPreviewRowKey(activeEntryMode, normalizedNumber)]);

    setModeInputs((current) => ({
      ...current,
      [activeEntryMode]: {
        ...current[activeEntryMode],
        number: activeEntryMode === "juri" ? "" : normalizedNumber,
        quantity: "",
      },
    }));
    setEditState(null);
    showNotice(
      editState && editState.mode === activeEntryMode
        ? `${currentModeMeta.shortLabel} ${normalizedNumber} updated`
        : `${currentModeMeta.shortLabel} ${normalizedNumber} added`,
      "success"
    );
    scheduleFocus(activeEntryMode, activeEntryMode === "juri" ? "number" : "quantity");
  }, [
    activeEntryMode,
    activeInputs.number,
    activeInputs.quantity,
    commitDraft,
    currentModeMeta.digits,
    currentModeMeta.shortLabel,
    editState,
    getDraftQuantity,
    rememberDraftForUndo,
    rememberRecentRows,
    scheduleFocus,
    setDraftQuantity,
    showNotice,
  ]);

  const handleEditRow = useCallback(
    (row) => {
      setModeInputs((current) => ({
        ...current,
        [row.mode]: {
          ...current[row.mode],
          number: row.number,
          quantity: String(row.qty),
        },
      }));
      setEditState({
        key: row.key,
        mode: row.mode,
        originalNumber: row.number,
      });
      setActivePanel(row.mode);

      if (row.mode !== activeEntryMode) {
        onActiveEntryModeChange(row.mode);
      }

      showNotice(`${row.tag} ${row.number} ready to edit`, "info");
      scheduleFocus(row.mode, row.mode === "juri" ? "quantity" : "quantity");
    },
    [activeEntryMode, onActiveEntryModeChange, scheduleFocus, showNotice]
  );

  const handleDeleteRow = useCallback(
    (row) => {
      rememberDraftForUndo(draftOverrideRef.current);
      const nextDraft = setDraftQuantity(
        createNormalizedDraftSnapshot(draftOverrideRef.current),
        row.mode,
        row.number,
        0
      );

      commitDraft(nextDraft);

      if (editState && editState.key === row.key) {
        clearModeInputs(row.mode);
        setEditState(null);
      }

      setRecentKeys((current) => current.filter((key) => key !== row.key));
      showNotice(`${row.tag} ${row.number} deleted`, "info");
    },
    [clearModeInputs, commitDraft, editState, rememberDraftForUndo, setDraftQuantity, showNotice]
  );

  const handleResetCurrentMode = useCallback(() => {
    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);
    rememberDraftForUndo(nextDraft);

    nextDraft =
      activeEntryMode === "juri"
        ? {
            ...nextDraft,
            juriText: "",
          }
        : {
            ...nextDraft,
            [activeEntryMode]: normalizeSingleDraft([]),
          };

    commitDraft(nextDraft);
    clearModeInputs(activeEntryMode);
    setEditState((current) => (current && current.mode === activeEntryMode ? null : current));
    showNotice(`${currentModeMeta.label} cleared`, "info");
    scheduleFocus(activeEntryMode, activeEntryMode === "juri" ? "number" : "quantity");
  }, [
    activeEntryMode,
    clearModeInputs,
    commitDraft,
    currentModeMeta.label,
    rememberDraftForUndo,
    scheduleFocus,
    showNotice,
  ]);

  const handleClearAll = useCallback(() => {
    rememberDraftForUndo(draftOverrideRef.current);
    draftOverrideRef.current = createNormalizedDraftSnapshot({
      third: [],
      fourth: [],
      juriText: "",
    });
    setModeInputs(buildInputState());
    setEditState(null);
    setRecentKeys([]);
    onReset();
    showNotice("Ticket cleared", "info");
  }, [onReset, rememberDraftForUndo, showNotice]);

  const handleUndoLast = useCallback(() => {
    const stack = draftHistoryRef.current;

    if (stack.length === 0) {
      return;
    }

    const previousDraft = stack.pop();
    setHistoryDepth(stack.length);
    commitDraft(previousDraft);
    setEditState(null);
    showNotice("Last change undone.", "info");
  }, [commitDraft, showNotice]);

  const handleSaveTicket = useCallback(async () => {
    if (!hasPreviewRows || savingTicket) {
      return;
    }

    if (partialPaymentPending) {
      showNotice("Enter due amount for Partial, or switch to Paid or Unpaid.", "warning");
      return;
    }

    try {
      setSavingTicket(true);
      await onSave(draftOverrideRef.current);
      setEditState(null);
      draftHistoryRef.current = [];
      setHistoryDepth(0);
      setRecentKeys([]);
    } finally {
      setSavingTicket(false);
    }
  }, [hasPreviewRows, onSave, partialPaymentPending, savingTicket, showNotice]);

  return (
    <div className="seller-entry-shell seller-entry-shell-manual">
      <div className="fast-entry-topbar">
        <div className="section-header">
          <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Seller Ticket Entry"}</h2>
          <span>Manual ticket entry with the same stable ticket engine, totals, and save flow.</span>
        </div>
      </div>

      {inlineNotices.length > 0 ? (
        <div className="fast-entry-notice-stack">
          {inlineNotices.map((notice, index) => (
            <div key={`${notice.message}-${index}`} className={`fast-entry-inline-note ${notice.tone || "info"}`}>
              <span>{notice.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <SuperFastManualTool
        activeMode={activeEntryMode}
        activePanel={activePanel}
        bookingDateAdjusted={bookingDateAdjusted}
        canClearTicket={hasPreviewRows}
        canPrintDraft={hasPreviewRows}
        canSave={canSaveTicket}
        canUndo={historyDepth > 0}
        currentDue={currentDue}
        currentDate={effectiveTicketDate}
        currentDrawLabel={formatDrawTime(drawTime)}
        customerName={customerName}
        customerPhone={customerPhone}
        date={date}
        draftTicketId={draftTicketId}
        draft={activeInputs}
        drawOptions={drawOptions}
        drawTime={drawTime}
        editingKey={editState && editState.key}
        effectivePaidAmount={effectivePaidAmount}
        formatCurrency={formatCurrency}
        formatDrawTime={formatDrawTime}
        formatEntryCutoffTime={formatEntryCutoffTime}
        isEditing={Boolean(editState && editState.mode === activeEntryMode)}
        lastSavedTicket={lastSavedTicket}
        lastSavedTicketId={lastSavedTicketId}
        maxBookingDate={maxBookingDate}
        numberRef={registerInputRef(activeEntryMode, "number")}
        onAddRow={handleManualSubmit}
        onChangePanel={handlePanelChange}
        onClearMode={handleResetCurrentMode}
        onClearTicket={handleClearAll}
        onCustomerNameChange={onCustomerNameChange}
        onCustomerPhoneChange={onCustomerPhoneChange}
        onDateChange={onDateChange}
        onDeleteRow={handleDeleteRow}
        onDismissSavedTicket={onDismissSavedTicket}
        onDrawTimeChange={onDrawTimeChange}
        onEditRow={handleEditRow}
        onNumberChange={(value) => updateModeInput(activeEntryMode, "number", value)}
        onPaidAmountChange={onPaidAmountChange}
        onPaymentModeChange={onPaymentModeChange}
        onPrintDraft={onPrintDraft}
        onPrintSavedTicket={onPrintSavedTicket}
        onQuantityChange={(value) => updateModeInput(activeEntryMode, "quantity", value)}
        onSaveTicket={handleSaveTicket}
        onSelectDigit={handleManualDigitSelect}
        onUndoLast={handleUndoLast}
        paidAmount={paidAmount}
        previewSummary={previewSummary}
        quantityRef={registerInputRef(activeEntryMode, "quantity")}
        recentRows={recentPreviewRows}
        saveBlockMessage="Enter due amount before saving as Partial."
        savingTicket={savingTicket}
        stats={activeModeStats}
        paymentMode={normalizedPaymentMode}
        previewLayout={previewLayout}
        todayString={todayString}
      />
    </div>
  );
}
