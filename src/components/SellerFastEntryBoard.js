import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./SellerFastEntryBoard.css";
import TicketScanPanel from "./TicketScanPanel.js";
import TicketScanReview from "./TicketScanReview.js";
import {
  getJuriQuantity,
  normalizeSingleDraft,
  parseFastJuriText,
  sanitizeFastDigits,
  sanitizeFastQuantity,
  upsertJuriText,
} from "../untils/fastEntry.js";
import { scanTicketApi } from "../untils/api.js";
import {
  canAutoApplyScan,
  getFirstScannedMode,
  getScannedRowCount,
  mapScanResultToDraft,
  normalizeScanResponse,
  readImageFileAsDataUrl,
} from "../untils/ticketScan.js";

const SINGLE_RATE = 11;
const JURI_RATE = 10;
const MAX_SCAN_FILE_SIZE = 8 * 1024 * 1024;
const EMPTY_MODE_INPUT = {
  number: "",
  quantity: "",
  quickText: "",
};

const MODE_META = {
  third: {
    label: "3rd House",
    shortLabel: "3H",
    digits: 1,
    rate: SINGLE_RATE,
    quickExample: "3-10\n2-8\n9-7",
    quickHelp: "Direct lines like 3-10",
    numberLabel: "Digit",
  },
  fourth: {
    label: "4th House",
    shortLabel: "4H",
    digits: 1,
    rate: SINGLE_RATE,
    quickExample: "7-15\n5-27\n6-22",
    quickHelp: "Direct lines like 7-15",
    numberLabel: "Digit",
  },
  juri: {
    label: "Juri",
    shortLabel: "J",
    digits: 2,
    rate: JURI_RATE,
    quickExample: "08-10\n55-4\n90-21",
    quickHelp: "Direct lines like 08-10",
    numberLabel: "Number",
  },
};
const ENTRY_TOOL_META = {
  scan: {
    label: "Scan Entry",
    subtitle: "Use camera or gallery",
    description: "Keep the current AI scan workflow for handwritten ticket photos.",
  },
  manual: {
    label: "Super Fast Manual Entry",
    subtitle: "Thumb-first typing",
    description: "Use the new ultra-fast typing tool for one-hand seller entry.",
  },
};
const ENTRY_TOOL_ORDER = ["scan", "manual"];

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

function splitQuickTokens(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split(/[\n,]+/)
    .flatMap((chunk) => chunk.trim().split(/\s+/))
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseFastHouseText(value) {
  const invalid = [];
  const lookup = new Map();
  const order = [];

  splitQuickTokens(value).forEach((token) => {
    const normalizedToken = token.replace(/[=:xX]/g, "-");
    const match = normalizedToken.match(/^(\d)-(\d+)$/);

    if (!match) {
      invalid.push(token);
      return;
    }

    const number = sanitizeFastDigits(match[1], 1);
    const qty = Number(sanitizeFastQuantity(match[2], 5) || 0);

    if (number === "" || Number(number) > 9 || qty <= 0) {
      invalid.push(token);
      return;
    }

    if (!lookup.has(number)) {
      lookup.set(number, qty);
      order.push(number);
      return;
    }

    lookup.set(number, lookup.get(number) + qty);
  });

  return {
    entries: order.map((number) => ({
      num: number,
      qty: lookup.get(number),
    })),
    invalid,
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

function scrollSectionIntoView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }

  window.setTimeout(() => {
    node.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "smooth",
    });
  }, 80);
}

function ModeTabs({ activeMode, onChange }) {
  return (
    <div className="seller-entry-tabs" role="tablist" aria-label="Entry mode">
      {Object.keys(MODE_META).map((mode) => {
        const meta = getModeMeta(mode);
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={activeMode === mode}
            className={`seller-entry-tab seller-entry-tab-${mode} ${activeMode === mode ? "active" : ""}`}
            onClick={() => onChange(mode)}
          >
            <span>{meta.shortLabel}</span>
            <strong>{meta.label}</strong>
          </button>
        );
      })}
    </div>
  );
}

function EntryToolSwitcher({ activeTool, onChange }) {
  return (
    <div className="seller-entry-tool-switcher" role="tablist" aria-label="Entry tool">
      {ENTRY_TOOL_ORDER.map((tool) => {
        const meta = ENTRY_TOOL_META[tool];

        return (
          <button
            key={tool}
            type="button"
            role="tab"
            aria-selected={activeTool === tool}
            className={`seller-entry-tool-tab ${activeTool === tool ? "active" : ""}`}
            onClick={() => onChange(tool)}
          >
            <span>{meta.subtitle}</span>
            <strong>{meta.label}</strong>
            <small>{meta.description}</small>
          </button>
        );
      })}
    </div>
  );
}

function ModeStat({ label, value }) {
  return (
    <div className="seller-entry-mode-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FastHouseEntry({
  mode,
  draft,
  stats,
  formatCurrency,
  isEditing,
  onNumberChange,
  onQuantityChange,
  onQuickTextChange,
  onStructuredSubmit,
  onQuickSubmit,
  onFocusField,
  numberRef,
  quantityRef,
  quickTextRef,
}) {
  const meta = getModeMeta(mode);
  const canSubmit = draft.number.length === meta.digits && Number(draft.quantity || 0) > 0;
  const canSubmitQuick = splitQuickTokens(draft.quickText).length > 0;

  return (
    <section className="seller-entry-mode-panel">
      <div className="seller-entry-mode-head">
        <div className="seller-entry-mode-copy">
          <span>{meta.label}</span>
          <strong>{isEditing ? "Update the selected row" : "Add rows fast"}</strong>
          <small>{meta.quickHelp}. Quantity updates instantly at ₹{meta.rate} each.</small>
        </div>

        <div className="seller-entry-mode-stats">
          <ModeStat label="Rows" value={stats.rows} />
          <ModeStat label="Qty" value={stats.qty} />
          <ModeStat label="Amount" value={formatCurrency(stats.amount)} />
        </div>
      </div>

      <div className="seller-entry-quick-form">
        <label className="seller-entry-field">
          <span>{meta.numberLabel}</span>
          <input
            ref={numberRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="next"
            maxLength={meta.digits}
            value={draft.number}
            placeholder="0"
            onChange={(event) => onNumberChange(event.target.value)}
            onFocus={(event) => onFocusField(event.currentTarget)}
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
            onFocus={(event) => onFocusField(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onStructuredSubmit();
              }
            }}
          />
        </label>

        <button
          type="button"
          className="seller-entry-add-btn"
          onClick={onStructuredSubmit}
          disabled={!canSubmit}
        >
          {isEditing ? "Update Row" : "Add Row"}
        </button>
      </div>

      <div className="seller-entry-batch-box">
        <div className="seller-entry-batch-head">
          <div>
            <strong>Quick lines</strong>
            <span>One per line or separated by spaces</span>
          </div>
          <small>{meta.quickExample.replace(/\n/g, " · ")}</small>
        </div>

        <textarea
          ref={quickTextRef}
          value={draft.quickText}
          placeholder={meta.quickExample}
          onChange={(event) => onQuickTextChange(event.target.value)}
          onFocus={(event) => onFocusField(event.currentTarget)}
        />

        <button
          type="button"
          className="seller-entry-inline-btn"
          onClick={onQuickSubmit}
          disabled={!canSubmitQuick}
        >
          Add Lines
        </button>
      </div>
    </section>
  );
}

function FastJuriEntry(props) {
  return <FastHouseEntry {...props} mode="juri" />;
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

function ManualRecentStrip({ editingKey, rows, onDelete, onEdit }) {
  return (
    <section className="seller-manual-recent-block">
      <div className="seller-manual-recent-head">
        <div>
          <span>Recent Entry Strip</span>
          <strong>{rows.length > 0 ? `${rows.length} active row(s)` : "No rows entered yet"}</strong>
        </div>
        <small>Edit or delete without leaving the current tool.</small>
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
          Tap a digit, type quantity, and add rows fast. They appear here instantly.
        </div>
      )}
    </section>
  );
}

function ManualTotalsDock({
  canSave,
  canUndo,
  formatCurrency,
  previewSummary,
  saving,
  onClearMode,
  onSaveTicket,
  onUndoLast,
}) {
  const singleAmount = Number(previewSummary.singleQty || 0) * SINGLE_RATE;
  const juriAmount = Number(previewSummary.juriQty || 0) * JURI_RATE;

  return (
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

      <div className="seller-manual-action-bar">
        <button type="button" className="outline-btn seller-entry-quiet-btn" onClick={onUndoLast} disabled={!canUndo || saving}>
          Undo Last
        </button>
        <button type="button" className="outline-btn seller-entry-quiet-btn" onClick={onClearMode} disabled={saving}>
          Clear Current Mode
        </button>
        <button type="button" className="seller-entry-save-btn" onClick={onSaveTicket} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save Ticket"}
        </button>
      </div>
    </div>
  );
}

function SuperFastManualTool({
  activeMode,
  currentDate,
  currentDrawLabel,
  draft,
  dockRef,
  editingKey,
  formatCurrency,
  isEditing,
  previewRows,
  recentRows,
  savingTicket,
  stats,
  onAddRow,
  onDeleteRow,
  onEditRow,
  onModeChange,
  onNumberChange,
  onQuantityChange,
  onSelectDigit,
  onSaveTicket,
  onUndoLast,
  onClearMode,
  canSave,
  canUndo,
  numberRef,
  quantityRef,
  previewSummary,
}) {
  const meta = getModeMeta(activeMode);
  const canSubmit = draft.number.length === meta.digits && Number(draft.quantity || 0) > 0;

  return (
    <div className="seller-manual-layout">
      <section className={`seller-entry-panel seller-manual-tool seller-manual-tool-${activeMode}`}>
        <div className="seller-manual-head">
          <div className="seller-manual-title">
            <span>Manual Fast Entry</span>
            <strong>Super Fast Manual Entry</strong>
            <small>Calculator-speed ticket typing with the same ticket engine and save flow.</small>
          </div>

          <div className="seller-manual-meta">
            <div className="seller-manual-meta-pill">
              <span>Date</span>
              <strong>{currentDate}</strong>
            </div>
            <div className="seller-manual-meta-pill">
              <span>Draw</span>
              <strong>{currentDrawLabel}</strong>
            </div>
          </div>
        </div>

        <ModeTabs activeMode={activeMode} onChange={onModeChange} />

        <div className={`seller-manual-entry-shell seller-manual-entry-shell-${activeMode}`}>
          <div className="seller-manual-mode-copy">
            <span>{meta.label}</span>
            <strong>{isEditing ? "Update current row" : "Add rows at POS speed"}</strong>
            <small>
              {activeMode === "juri"
                ? "Type a two-digit number and quantity. Fields reset fast for the next row."
                : "Tap a digit, type quantity, and add. Quantity clears while the selected digit stays ready."}
            </small>
          </div>

          <div className="seller-manual-mode-stats">
            <ModeStat label="Rows" value={stats.rows} />
            <ModeStat label="Qty" value={stats.qty} />
            <ModeStat label="Amount" value={formatCurrency(stats.amount)} />
          </div>

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

              <button type="button" className="seller-manual-primary-btn" onClick={onAddRow} disabled={!canSubmit}>
                {isEditing ? "Update Row" : "Add Row"}
              </button>
            </div>
          ) : (
            <div className="seller-manual-house-form">
              <div className="seller-manual-selected-digit">
                <span>Selected Digit</span>
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

                <button type="button" className="seller-manual-primary-btn" onClick={onAddRow} disabled={!canSubmit}>
                  {isEditing ? "Update Row" : `Add ${meta.shortLabel}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <ManualRecentStrip
          editingKey={editingKey}
          rows={recentRows}
          onDelete={onDeleteRow}
          onEdit={onEditRow}
        />
      </section>

      <div ref={dockRef} className="seller-entry-dock seller-entry-dock-manual">
        <ManualTotalsDock
          canSave={canSave}
          canUndo={canUndo}
          formatCurrency={formatCurrency}
          previewSummary={previewSummary}
          saving={savingTicket}
          onClearMode={onClearMode}
          onSaveTicket={onSaveTicket}
          onUndoLast={onUndoLast}
        />
      </div>
    </div>
  );
}

function EntryPreviewList({
  rows,
  activeMode,
  editingKey,
  formatCurrency,
  onEdit,
  onDelete,
}) {
  if (rows.length === 0) {
    return (
      <div className="seller-entry-preview-empty">
        <strong>No rows yet</strong>
        <span>Start typing number and quantity. Every row appears here instantly.</span>
      </div>
    );
  }

  return (
    <div className="seller-entry-preview-list" aria-label="Ticket preview">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`seller-entry-preview-row ${row.mode === activeMode ? "mode-active" : ""} ${
            editingKey === row.key ? "editing" : ""
          }`}
        >
          <div className="seller-entry-preview-main">
            <span className="seller-entry-preview-tag">{row.tag}</span>
            <div className="seller-entry-preview-copy">
              <strong>
                {row.tag} {row.number} × {row.qty}
              </strong>
              <small>{formatCurrency(row.amount)}</small>
            </div>
          </div>

          <div className="seller-entry-preview-actions">
            <button type="button" aria-label={`Edit ${row.tag} ${row.number}`} onClick={() => onEdit(row)}>
              ✎
            </button>
            <button type="button" aria-label={`Delete ${row.tag} ${row.number}`} onClick={() => onDelete(row)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StickyTicketSummary({ formatCurrency, previewRowsCount, previewSummary }) {
  const totalQty = Number(previewSummary.singleQty || 0) + Number(previewSummary.juriQty || 0);

  return (
    <div className="seller-entry-summary-strip">
      <div className="seller-entry-summary-total">
        <span>Grand Total</span>
        <strong>{formatCurrency(previewSummary.total || 0)}</strong>
        <small>
          {previewRowsCount} row(s) | Qty {totalQty}
        </small>
      </div>

      <div className="seller-entry-summary-chips">
        <span>Single {previewSummary.singleQty || 0}</span>
        <span>Juri {previewSummary.juriQty || 0}</span>
      </div>
    </div>
  );
}

function SaveActionBar({
  canSave,
  saving,
  onClear,
  onResetMode,
  onSaveTicket,
}) {
  return (
    <div className="seller-entry-action-bar">
      <div className="seller-entry-action-secondary-row">
        <button type="button" className="outline-btn seller-entry-quiet-btn" onClick={onClear} disabled={saving}>
          Clear Ticket
        </button>
        <button type="button" className="outline-btn seller-entry-quiet-btn" onClick={onResetMode} disabled={saving}>
          Reset Mode
        </button>
      </div>
      <button type="button" className="seller-entry-save-btn" onClick={onSaveTicket} disabled={!canSave || saving}>
        {saving ? "Saving..." : "Save Ticket"}
      </button>
    </div>
  );
}

export default function SellerFastEntryBoard({
  activeEntryMode,
  bookingDateAdjusted,
  date,
  drawOptions,
  drawTime,
  editingTicketId,
  effectiveTicketDate,
  entryUiToken,
  formatCurrency,
  formatDrawTime,
  formatEntryCutoffTime,
  fourth,
  juriText,
  maxBookingDate,
  onActiveEntryModeChange,
  onDateChange,
  onDrawTimeChange,
  onFourthChange,
  onJuriTextChange,
  onReset,
  onSave,
  onThirdChange,
  parsedJuri,
  previewItems,
  previewSummary,
  scanStatus,
  third,
  ticketActionNotice,
  todayString,
}) {
  const [entryToolMode, setEntryToolMode] = useState("scan");
  const [modeInputs, setModeInputs] = useState(() => buildInputState());
  const [editState, setEditState] = useState(null);
  const [statusNotice, setStatusNotice] = useState(null);
  const [savingTicket, setSavingTicket] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanFileName, setScanFileName] = useState("");
  const [scanReview, setScanReview] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [dockHeight, setDockHeight] = useState(220);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [recentKeys, setRecentKeys] = useState([]);
  const inputRefs = useRef({
    third: { number: null, quantity: null, quickText: null },
    fourth: { number: null, quantity: null, quickText: null },
    juri: { number: null, quantity: null, quickText: null },
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
  const dockRef = useRef(null);
  const scanPanelRef = useRef(null);
  const scanReviewRef = useRef(null);
  const previewPanelRef = useRef(null);

  const parsedJuriList = useMemo(() => parsedJuri || parseFastJuriText(juriText), [juriText, parsedJuri]);
  const modeRows = useMemo(
    () => buildModeRows(third, fourth, parsedJuriList.entries),
    [fourth, parsedJuriList.entries, third]
  );
  const previewRows = useMemo(() => buildPreviewRows(previewItems), [previewItems]);
  const hasPreviewRows = previewRows.length > 0;
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
    setEditState(null);
    setScanReview(null);
    setEntryToolMode("scan");
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

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return undefined;
    }

    const viewport = window.visualViewport;
    const updateKeyboardOffset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(inset > 0 ? Math.round(inset) : 0);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
    };
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !dockRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setDockHeight(Math.ceil(entry.contentRect.height));
    });

    observer.observe(dockRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (scanBusy) {
      scrollSectionIntoView(scanPanelRef.current);
    }
  }, [scanBusy]);

  useEffect(() => {
    if (scanReview) {
      scrollSectionIntoView(scanReviewRef.current);
    }
  }, [scanReview]);

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
          : field === "quantity"
            ? sanitizeFastQuantity(value, 5)
            : value.replace(/[^\d,\n\r\s\-=:xX]/g, "");

      return {
        ...current,
        [mode]: {
          ...current[mode],
          [field]: nextValue,
        },
      };
    });
  }, []);

  const clearModeInputs = useCallback((mode, options = {}) => {
    const { keepQuickText = true } = options;

    setModeInputs((current) => ({
      ...current,
      [mode]: {
        number: "",
        quantity: "",
        quickText: keepQuickText ? current[mode].quickText : "",
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

  const setDraftQuantity = useCallback(
    (draft, mode, number, quantity) => {
      const normalizedDraft = createNormalizedDraftSnapshot(draft);

      if (mode === "juri") {
        normalizedDraft.juriText = upsertJuriText(normalizedDraft.juriText, number, quantity);
        return normalizedDraft;
      }

      const target = mode === "fourth" ? normalizedDraft.fourth : normalizedDraft.third;
      target[Number(number)] = quantity > 0 ? String(quantity) : "";
      return normalizedDraft;
    },
    []
  );

  const handleEntryToolChange = useCallback((tool) => {
    setEntryToolMode(tool);

    if (tool === "manual") {
      scheduleFocus(activeEntryMode, activeEntryMode === "juri" ? "number" : activeInputs.number ? "quantity" : "number");
      return;
    }

    scrollSectionIntoView(scanPanelRef.current);
  }, [activeEntryMode, activeInputs.number, scheduleFocus]);

  const handleModeChange = (mode) => {
    if (mode === activeEntryMode) {
      scheduleFocus(mode, "number");
      return;
    }

    setEditState((current) => (current && current.mode === mode ? current : null));
    setEntryToolMode("manual");
    onActiveEntryModeChange(mode);
    scheduleFocus(mode, "number");
  };

  const handleManualDigitSelect = useCallback((digit) => {
    if (activeEntryMode === "juri") {
      return;
    }

    updateModeInput(activeEntryMode, "number", digit);
    setEntryToolMode("manual");
    scheduleFocus(activeEntryMode, "quantity");
  }, [activeEntryMode, scheduleFocus, updateModeInput]);

  const handleStructuredSubmit = useCallback(() => {
    const entryNumber = sanitizeFastDigits(activeInputs.number, currentModeMeta.digits);
    const entryQty = Number(sanitizeFastQuantity(activeInputs.quantity, 5) || 0);

    if (entryNumber.length !== currentModeMeta.digits || entryQty <= 0) {
      return;
    }

    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);
    const normalizedNumber = formatEntryNumber(activeEntryMode, entryNumber);

    if (editState && editState.mode === activeEntryMode) {
      nextDraft = setDraftQuantity(nextDraft, activeEntryMode, editState.originalNumber, 0);
    }

    const mergedQuantity =
      getDraftQuantity(nextDraft, activeEntryMode, normalizedNumber) + entryQty;
    nextDraft = setDraftQuantity(nextDraft, activeEntryMode, normalizedNumber, mergedQuantity);
    commitDraft(nextDraft);

    clearModeInputs(activeEntryMode);
    setEditState(null);
    showNotice(
      editState && editState.mode === activeEntryMode
        ? `${currentModeMeta.shortLabel} ${normalizedNumber} updated`
        : `${currentModeMeta.shortLabel} ${normalizedNumber} added`,
      "success"
    );
    scheduleFocus(activeEntryMode, "number");
  }, [
    activeEntryMode,
    activeInputs.number,
    activeInputs.quantity,
    clearModeInputs,
    commitDraft,
    currentModeMeta.digits,
    currentModeMeta.shortLabel,
    editState,
    getDraftQuantity,
    scheduleFocus,
    setDraftQuantity,
    showNotice,
  ]);

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

  const handleQuickSubmit = useCallback(() => {
    const parser = activeEntryMode === "juri" ? parseFastJuriText : parseFastHouseText;
    const parsed = parser(activeInputs.quickText);

    if (!parsed.entries.length) {
      showNotice("Add at least one valid line before importing.", "warning");
      return;
    }

    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);
    rememberDraftForUndo(nextDraft);
    const touchedKeys = [];

    parsed.entries.forEach((entry) => {
      const normalizedNumber = formatEntryNumber(activeEntryMode, entry.num);
      const mergedQuantity =
        getDraftQuantity(nextDraft, activeEntryMode, normalizedNumber) + Number(entry.qty || 0);
      nextDraft = setDraftQuantity(nextDraft, activeEntryMode, normalizedNumber, mergedQuantity);
      touchedKeys.push(buildPreviewRowKey(activeEntryMode, normalizedNumber));
    });

    commitDraft(nextDraft);
    rememberRecentRows(touchedKeys);
    setModeInputs((current) => ({
      ...current,
      [activeEntryMode]: {
        ...current[activeEntryMode],
        quickText: "",
      },
    }));
    setEditState(null);
    showNotice(
      parsed.invalid.length > 0
        ? `${parsed.entries.length} line(s) added. Skipped ${parsed.invalid.join(", ")}`
        : `${parsed.entries.length} line(s) added`,
      parsed.invalid.length > 0 ? "warning" : "success"
    );
    scheduleFocus(activeEntryMode, "number");
  }, [
    activeEntryMode,
    activeInputs.quickText,
    commitDraft,
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
      setEntryToolMode("manual");

      if (row.mode !== activeEntryMode) {
        onActiveEntryModeChange(row.mode);
      }

      showNotice(`${row.tag} ${row.number} ready to edit`, "info");
      scheduleFocus(row.mode, "quantity");
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
    clearModeInputs(activeEntryMode, {
      keepQuickText: false,
    });
    setEditState((current) => (current && current.mode === activeEntryMode ? null : current));
    showNotice(`${currentModeMeta.label} cleared`, "info");
    scheduleFocus(activeEntryMode, "number");
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
    setScanReview(null);
    setScanFileName("");
    setRecentKeys([]);
    onReset();
    showNotice("Ticket cleared", "info");
  }, [onReset, rememberDraftForUndo, showNotice]);

  const applyScanToDraft = useCallback((editedScan, successMessage) => {
    if (!editedScan) {
      return;
    }

    rememberDraftForUndo(draftOverrideRef.current);
    const nextDraft = mapScanResultToDraft(editedScan);
    const nextMode = getFirstScannedMode(editedScan);

    commitDraft(nextDraft);
    setModeInputs(buildInputState());
    setEditState(null);
    setScanReview(null);
    setEntryToolMode("manual");
    setRecentKeys([]);

    if (nextMode !== activeEntryMode) {
      onActiveEntryModeChange(nextMode);
    }

    showNotice(successMessage || "Scan rows loaded into the ticket. Review and save when ready.", "success");
    scheduleFocus(nextMode, "number");
    window.setTimeout(() => {
      scrollSectionIntoView(previewPanelRef.current);
    }, 140);
  }, [
    activeEntryMode,
    commitDraft,
    onActiveEntryModeChange,
    rememberDraftForUndo,
    scheduleFocus,
    showNotice,
  ]);

  const handleScanFileSelect = useCallback(
    async (file) => {
      if (scanStatus && scanStatus.available === false) {
        showNotice(scanStatus.message || "Ticket scan is not configured on the server.", "warning");
        scrollSectionIntoView(scanPanelRef.current);
        return;
      }

      if (!file) {
        return;
      }

      if (!String(file.type || "").startsWith("image/")) {
        showNotice("Choose a valid image file before scanning.", "warning");
        return;
      }

      if (Number(file.size || 0) > MAX_SCAN_FILE_SIZE) {
        showNotice("Image is too large. Use a smaller photo for faster scan.", "warning");
        return;
      }

      try {
        setScanBusy(true);
        setScanFileName(file.name || "ticket-image");
        setEntryToolMode("scan");
        scrollSectionIntoView(scanPanelRef.current);
        const imageDataUrl = await readImageFileAsDataUrl(file);
        const response = await scanTicketApi({
          imageDataUrl,
          fileName: file.name || "ticket-image",
          mimeType: file.type || "image/jpeg",
        });
        const nextScanReview = normalizeScanResponse(response.scan);
        const scannedRowCount = getScannedRowCount(nextScanReview);

        if (canAutoApplyScan(nextScanReview)) {
          setScanReview(null);
          applyScanToDraft(
            nextScanReview,
            nextScanReview.notes.length > 0
              ? "Scan loaded into the ticket. Check preview carefully, then save."
              : "Scan loaded into the ticket. Preview is ready to save."
          );
          return;
        }

        setScanReview(nextScanReview);
        setEntryToolMode("scan");
        showNotice(
          scannedRowCount === 0
            ? "No clear rows were found. Try another photo."
            : "Scan found rows, but some need review before loading the ticket.",
          scannedRowCount === 0 ? "warning" : "info"
        );
      } catch (error) {
        scrollSectionIntoView(scanPanelRef.current);
        showNotice(error.message || "Ticket scan failed.", "warning");
      } finally {
        setScanBusy(false);
      }
    },
    [applyScanToDraft, scanStatus, showNotice]
  );

  const handleCancelScanReview = useCallback(() => {
    setScanReview(null);
    showNotice("Scan review closed. Ticket draft is unchanged.", "info");
  }, [showNotice]);

  const handleConfirmScanReview = useCallback((editedScan) => {
    applyScanToDraft(editedScan, "Scan rows loaded into the ticket. Check preview and save when ready.");
  }, [applyScanToDraft]);

  const handleUndoLast = useCallback(() => {
    const stack = draftHistoryRef.current;

    if (stack.length === 0) {
      return;
    }

    const previousDraft = stack.pop();
    setHistoryDepth(stack.length);
    commitDraft(previousDraft);
    setEditState(null);
    setScanReview(null);
    setEntryToolMode("manual");
    showNotice("Last change undone.", "info");
  }, [commitDraft, showNotice]);

  const handleSaveTicket = useCallback(async () => {
    if (!hasPreviewRows || savingTicket) {
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
  }, [hasPreviewRows, onSave, savingTicket]);

  const boardStyle = useMemo(
    () => ({
      "--seller-entry-dock-space":
        entryToolMode === "manual" || hasPreviewRows ? `${dockHeight}px` : "0px",
      "--seller-entry-keyboard-offset": `${keyboardOffset}px`,
    }),
    [dockHeight, entryToolMode, hasPreviewRows, keyboardOffset]
  );

  return (
    <div className={`seller-entry-shell ${entryToolMode === "manual" ? "seller-entry-shell-manual" : ""}`} style={boardStyle}>
      <div className="fast-entry-topbar">
        <div className="section-header">
          <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Seller Ticket Entry"}</h2>
          <span>Choose between the current scanner workflow and a separate super-fast manual typing tool.</span>
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

      <div className="fast-entry-booking-bar fast-entry-booking-bar-v2">
        <div className="fast-entry-booking-pill">
          <span>Booking For</span>
          <strong>{effectiveTicketDate}</strong>
          <small>
            {formatDrawTime(drawTime)}
            {bookingDateAdjusted ? ` | moved after ${formatEntryCutoffTime(drawTime)}` : ""}
          </small>
        </div>

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

      <div className="fast-entry-booking-note">
        <strong>Speed Entry Active</strong>
        <span>
          {bookingDateAdjusted
            ? `${formatDrawTime(drawTime)} last entry closed at ${formatEntryCutoffTime(drawTime)} for ${date}. Ticket moves to ${effectiveTicketDate}.`
            : `${formatDrawTime(drawTime)} ticket entry is open for ${effectiveTicketDate} until ${formatEntryCutoffTime(drawTime)}.`}
        </span>
      </div>

      <EntryToolSwitcher activeTool={entryToolMode} onChange={handleEntryToolChange} />

      {entryToolMode === "scan" ? (
        <>
          <TicketScanPanel
            busy={scanBusy}
            fileName={scanFileName}
            panelRef={scanPanelRef}
            scanStatus={scanStatus}
            onSelectFile={handleScanFileSelect}
          />

          {scanReview ? (
            <div ref={scanReviewRef}>
              <TicketScanReview
                hasExistingRows={previewRows.length > 0}
                result={scanReview}
                onCancel={handleCancelScanReview}
                onConfirm={handleConfirmScanReview}
              />
            </div>
          ) : null}

          <div className="seller-entry-main seller-entry-main-scan">
            <aside ref={previewPanelRef} className="seller-entry-panel seller-entry-preview-panel">
              <div className="seller-entry-preview-head">
                <div>
                  <span>Live Preview</span>
                  <strong>{previewRows.length ? `${previewRows.length} row(s) on this ticket` : "Current ticket rows"}</strong>
                </div>
                <small>Use edit or delete inline. No popup needed.</small>
              </div>

              <EntryPreviewList
                rows={previewRows}
                activeMode={activeEntryMode}
                editingKey={editState && editState.key}
                formatCurrency={formatCurrency}
                onEdit={handleEditRow}
                onDelete={handleDeleteRow}
              />
            </aside>
          </div>

          {hasPreviewRows ? (
            <div ref={dockRef} className="seller-entry-dock">
              <StickyTicketSummary
                formatCurrency={formatCurrency}
                previewRowsCount={previewRows.length}
                previewSummary={previewSummary}
              />
              <SaveActionBar
                canSave={hasPreviewRows}
                saving={savingTicket}
                onClear={handleClearAll}
                onResetMode={handleResetCurrentMode}
                onSaveTicket={handleSaveTicket}
              />
            </div>
          ) : null}
        </>
      ) : (
        <SuperFastManualTool
          activeMode={activeEntryMode}
          canSave={hasPreviewRows}
          canUndo={historyDepth > 0}
          currentDate={effectiveTicketDate}
          currentDrawLabel={formatDrawTime(drawTime)}
          dockRef={dockRef}
          draft={activeInputs}
          editingKey={editState && editState.key}
          formatCurrency={formatCurrency}
          isEditing={Boolean(editState && editState.mode === activeEntryMode)}
          numberRef={registerInputRef(activeEntryMode, "number")}
          onAddRow={handleManualSubmit}
          onClearMode={handleResetCurrentMode}
          onDeleteRow={handleDeleteRow}
          onEditRow={handleEditRow}
          onModeChange={handleModeChange}
          onNumberChange={(value) => updateModeInput(activeEntryMode, "number", value)}
          onQuantityChange={(value) => updateModeInput(activeEntryMode, "quantity", value)}
          onSaveTicket={handleSaveTicket}
          onSelectDigit={handleManualDigitSelect}
          onUndoLast={handleUndoLast}
          previewRows={previewRows}
          previewSummary={previewSummary}
          quantityRef={registerInputRef(activeEntryMode, "quantity")}
          recentRows={recentPreviewRows}
          savingTicket={savingTicket}
          stats={activeModeStats}
        />
      )}
    </div>
  );
}
