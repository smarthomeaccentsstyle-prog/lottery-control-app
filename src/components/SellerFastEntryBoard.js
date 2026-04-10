import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./SellerFastEntryBoard.css";
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

function ModeStat({ label, value }) {
  return (
    <div className="seller-entry-mode-stat">
      <span>{label}</span>
      <strong>{value}</strong>
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

function ManualRecentStrip({ canClear, editingKey, rows, onClearTicket, onDelete, onEdit }) {
  return (
    <section className="seller-manual-recent-block">
      <div className="seller-manual-recent-head">
        <div>
          <span>Current Ticket Rows</span>
          <strong>{rows.length > 0 ? `${rows.length} active row(s)` : "No rows entered yet"}</strong>
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
          Tap a digit, type quantity, and add rows fast. They appear here instantly.
        </div>
      )}
    </section>
  );
}

function ManualTotalsDock({
  canSave,
  canPrintDraft,
  canUndo,
  formatCurrency,
  formatDrawTime,
  lastSavedTicket,
  lastSavedTicketId,
  previewSummary,
  saving,
  onClearMode,
  onDismissSavedTicket,
  onPrintDraft,
  onPrintSavedTicket,
  onSaveTicket,
  onUndoLast,
}) {
  const singleAmount = Number(previewSummary.singleQty || 0) * SINGLE_RATE;
  const juriAmount = Number(previewSummary.juriQty || 0) * JURI_RATE;
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
    <div className="seller-manual-dock-wrap">
      {lastSavedTicketId ? (
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
      ) : null}

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
          className="outline-btn seller-entry-quiet-btn seller-entry-print-btn"
          onClick={onPrintDraft}
          disabled={!canPrintDraft || saving}
        >
          Print Draft
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
  );
}

function SuperFastManualTool({
  activeMode,
  canClearTicket,
  canPrintDraft,
  canSave,
  canUndo,
  currentDate,
  currentDrawLabel,
  dockRef,
  draft,
  editingKey,
  formatCurrency,
  formatDrawTime,
  isEditing,
  lastSavedTicket,
  lastSavedTicketId,
  onAddRow,
  onClearMode,
  onClearTicket,
  onDeleteRow,
  onDismissSavedTicket,
  onEditRow,
  onModeChange,
  onNumberChange,
  onPrintDraft,
  onPrintSavedTicket,
  onQuantityChange,
  onSaveTicket,
  onSelectDigit,
  onUndoLast,
  previewSummary,
  quantityRef,
  recentRows,
  savingTicket,
  stats,
  numberRef,
}) {
  const meta = getModeMeta(activeMode);
  const canSubmit = draft.number.length === meta.digits && Number(draft.quantity || 0) > 0;

  return (
    <div className="seller-manual-layout">
      <section className={`seller-entry-panel seller-manual-tool seller-manual-tool-${activeMode}`}>
        <div className="seller-manual-head">
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
            <strong>{isEditing ? "Update current row" : "Add rows"}</strong>
            <small>
              {activeMode === "juri"
                ? "Type a two-digit number and quantity, then add the row."
                : "Tap a digit, type quantity, and add the row."}
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

              <button
                type="button"
                className="seller-manual-primary-btn"
                onClick={onAddRow}
                disabled={!canSubmit}
              >
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

                <button
                  type="button"
                  className="seller-manual-primary-btn"
                  onClick={onAddRow}
                  disabled={!canSubmit}
                >
                  {isEditing ? "Update Row" : `Add ${meta.shortLabel}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <ManualRecentStrip
          canClear={canClearTicket}
          editingKey={editingKey}
          rows={recentRows}
          onClearTicket={onClearTicket}
          onDelete={onDeleteRow}
          onEdit={onEditRow}
        />
      </section>

      <div ref={dockRef} className="seller-entry-dock seller-entry-dock-manual">
        <ManualTotalsDock
          canPrintDraft={canPrintDraft}
          canSave={canSave}
          canUndo={canUndo}
          formatCurrency={formatCurrency}
          formatDrawTime={formatDrawTime}
          lastSavedTicket={lastSavedTicket}
          lastSavedTicketId={lastSavedTicketId}
          previewSummary={previewSummary}
          saving={savingTicket}
          onClearMode={onClearMode}
          onDismissSavedTicket={onDismissSavedTicket}
          onPrintDraft={onPrintDraft}
          onPrintSavedTicket={onPrintSavedTicket}
          onSaveTicket={onSaveTicket}
          onUndoLast={onUndoLast}
        />
      </div>
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
  lastSavedTicket,
  lastSavedTicketId,
  maxBookingDate,
  onActiveEntryModeChange,
  onDateChange,
  onDismissSavedTicket,
  onDrawTimeChange,
  onFourthChange,
  onJuriTextChange,
  onPrintDraft,
  onPrintSavedTicket,
  onReset,
  onSave,
  onThirdChange,
  parsedJuri,
  previewItems,
  previewSummary,
  third,
  ticketActionNotice,
  todayString,
}) {
  const [modeInputs, setModeInputs] = useState(() => buildInputState());
  const [editState, setEditState] = useState(null);
  const [statusNotice, setStatusNotice] = useState(null);
  const [savingTicket, setSavingTicket] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [dockHeight, setDockHeight] = useState(220);
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
  const dockRef = useRef(null);

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
      "--seller-entry-dock-space": hasPreviewRows ? `${dockHeight}px` : "0px",
      "--seller-entry-keyboard-offset": `${keyboardOffset}px`,
    }),
    [dockHeight, hasPreviewRows, keyboardOffset]
  );

  return (
    <div className="seller-entry-shell seller-entry-shell-manual" style={boardStyle}>
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
        <strong>Manual Entry Active</strong>
        <span>
          {bookingDateAdjusted
            ? `${formatDrawTime(drawTime)} last entry closed at ${formatEntryCutoffTime(drawTime)} for ${date}. Ticket moves to ${effectiveTicketDate}.`
            : `${formatDrawTime(drawTime)} ticket entry is open for ${effectiveTicketDate} until ${formatEntryCutoffTime(drawTime)}.`}
        </span>
      </div>

      <SuperFastManualTool
        activeMode={activeEntryMode}
        canClearTicket={hasPreviewRows}
        canPrintDraft={hasPreviewRows}
        canSave={hasPreviewRows}
        canUndo={historyDepth > 0}
        currentDate={effectiveTicketDate}
        currentDrawLabel={formatDrawTime(drawTime)}
        dockRef={dockRef}
        draft={activeInputs}
        editingKey={editState && editState.key}
        formatCurrency={formatCurrency}
        formatDrawTime={formatDrawTime}
        isEditing={Boolean(editState && editState.mode === activeEntryMode)}
        lastSavedTicket={lastSavedTicket}
        lastSavedTicketId={lastSavedTicketId}
        numberRef={registerInputRef(activeEntryMode, "number")}
        onAddRow={handleManualSubmit}
        onClearMode={handleResetCurrentMode}
        onClearTicket={handleClearAll}
        onDeleteRow={handleDeleteRow}
        onDismissSavedTicket={onDismissSavedTicket}
        onEditRow={handleEditRow}
        onModeChange={handleModeChange}
        onNumberChange={(value) => updateModeInput(activeEntryMode, "number", value)}
        onPrintDraft={onPrintDraft}
        onPrintSavedTicket={onPrintSavedTicket}
        onQuantityChange={(value) => updateModeInput(activeEntryMode, "quantity", value)}
        onSaveTicket={handleSaveTicket}
        onSelectDigit={handleManualDigitSelect}
        onUndoLast={handleUndoLast}
        previewSummary={previewSummary}
        quantityRef={registerInputRef(activeEntryMode, "quantity")}
        recentRows={recentPreviewRows}
        savingTicket={savingTicket}
        stats={activeModeStats}
      />
    </div>
  );
}
