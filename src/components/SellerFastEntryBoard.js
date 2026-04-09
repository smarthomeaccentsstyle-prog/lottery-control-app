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
  getFirstScannedMode,
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
            className={`seller-entry-tab ${activeMode === mode ? "active" : ""}`}
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

function StickyTicketSummary({ formatCurrency, previewSummary }) {
  const singleAmount = Number(previewSummary.singleQty || 0) * SINGLE_RATE;
  const juriAmount = Number(previewSummary.juriQty || 0) * JURI_RATE;

  return (
    <div className="seller-entry-summary-grid">
      <ModeStat label="Single Qty" value={previewSummary.singleQty || 0} />
      <ModeStat label="Single Amt" value={formatCurrency(singleAmount)} />
      <ModeStat label="Juri Qty" value={previewSummary.juriQty || 0} />
      <ModeStat label="Juri Amt" value={formatCurrency(juriAmount)} />
      <ModeStat label="Grand Total" value={formatCurrency(previewSummary.total || 0)} />
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
      <button type="button" className="outline-btn" onClick={onClear} disabled={saving}>
        Clear
      </button>
      <button type="button" className="outline-btn" onClick={onResetMode} disabled={saving}>
        Reset Mode
      </button>
      <button type="button" onClick={onSaveTicket} disabled={!canSave || saving}>
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
  third,
  ticketActionNotice,
  todayString,
}) {
  const [modeInputs, setModeInputs] = useState(() => buildInputState());
  const [editState, setEditState] = useState(null);
  const [statusNotice, setStatusNotice] = useState(null);
  const [savingTicket, setSavingTicket] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanFileName, setScanFileName] = useState("");
  const [scanReview, setScanReview] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [dockHeight, setDockHeight] = useState(220);
  const inputRefs = useRef({
    third: { number: null, quantity: null, quickText: null },
    fourth: { number: null, quantity: null, quickText: null },
    juri: { number: null, quantity: null, quickText: null },
  });
  const focusTimeoutRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
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
  const currentModeMeta = getModeMeta(activeEntryMode);
  const activeInputs = modeInputs[activeEntryMode];
  const activeModeStats = useMemo(
    () => buildModeStats(activeEntryMode, modeRows[activeEntryMode] || []),
    [activeEntryMode, modeRows]
  );
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

  const handleModeChange = (mode) => {
    if (mode === activeEntryMode) {
      scheduleFocus(mode, "number");
      return;
    }

    setEditState((current) => (current && current.mode === mode ? current : null));
    onActiveEntryModeChange(mode);
    scheduleFocus(mode, "number");
  };

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

  const handleQuickSubmit = useCallback(() => {
    const parser = activeEntryMode === "juri" ? parseFastJuriText : parseFastHouseText;
    const parsed = parser(activeInputs.quickText);

    if (!parsed.entries.length) {
      showNotice("Add at least one valid line before importing.", "warning");
      return;
    }

    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);

    parsed.entries.forEach((entry) => {
      const normalizedNumber = formatEntryNumber(activeEntryMode, entry.num);
      const mergedQuantity =
        getDraftQuantity(nextDraft, activeEntryMode, normalizedNumber) + Number(entry.qty || 0);
      nextDraft = setDraftQuantity(nextDraft, activeEntryMode, normalizedNumber, mergedQuantity);
    });

    commitDraft(nextDraft);
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
      scheduleFocus(row.mode, "quantity");
    },
    [activeEntryMode, onActiveEntryModeChange, scheduleFocus, showNotice]
  );

  const handleDeleteRow = useCallback(
    (row) => {
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

      showNotice(`${row.tag} ${row.number} deleted`, "info");
    },
    [clearModeInputs, commitDraft, editState, setDraftQuantity, showNotice]
  );

  const handleResetCurrentMode = useCallback(() => {
    let nextDraft = createNormalizedDraftSnapshot(draftOverrideRef.current);

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
    scheduleFocus,
    showNotice,
  ]);

  const handleClearAll = useCallback(() => {
    draftOverrideRef.current = createNormalizedDraftSnapshot({
      third: [],
      fourth: [],
      juriText: "",
    });
    setModeInputs(buildInputState());
    setEditState(null);
    setScanReview(null);
    setScanFileName("");
    onReset();
    showNotice("Ticket cleared", "info");
  }, [onReset, showNotice]);

  const handleScanFileSelect = useCallback(
    async (file) => {
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
        const imageDataUrl = await readImageFileAsDataUrl(file);
        const response = await scanTicketApi({
          imageDataUrl,
          fileName: file.name || "ticket-image",
          mimeType: file.type || "image/jpeg",
        });
        const nextScanReview = normalizeScanResponse(response.scan);

        setScanReview(nextScanReview);
        showNotice(
          nextScanReview.notes.length > 0
            ? "Scan ready. Review highlighted notes before applying."
            : "Scan ready. Review and apply to ticket.",
          nextScanReview.notes.length > 0 ? "warning" : "success"
        );
      } catch (error) {
        showNotice(error.message || "Ticket scan failed.", "warning");
      } finally {
        setScanBusy(false);
      }
    },
    [showNotice]
  );

  const handleCancelScanReview = useCallback(() => {
    setScanReview(null);
    showNotice("Scan review closed. Ticket draft is unchanged.", "info");
  }, [showNotice]);

  const handleConfirmScanReview = useCallback((editedScan) => {
    if (!editedScan) {
      return;
    }

    const nextDraft = mapScanResultToDraft(editedScan);
    const nextMode = getFirstScannedMode(editedScan);

    commitDraft(nextDraft);
    setModeInputs(buildInputState());
    setEditState(null);
    setScanReview(null);

    if (nextMode !== activeEntryMode) {
      onActiveEntryModeChange(nextMode);
    }

    showNotice("Scan rows loaded into the ticket. Review and save when ready.", "success");
    scheduleFocus(nextMode, "number");
  }, [
    activeEntryMode,
    commitDraft,
    onActiveEntryModeChange,
    scheduleFocus,
    showNotice,
  ]);

  const handleSaveTicket = useCallback(async () => {
    if (previewRows.length === 0 || savingTicket) {
      return;
    }

    try {
      setSavingTicket(true);
      await onSave(draftOverrideRef.current);
      setEditState(null);
    } finally {
      setSavingTicket(false);
    }
  }, [onSave, previewRows.length, savingTicket]);

  const boardStyle = useMemo(
    () => ({
      "--seller-entry-dock-space": `${dockHeight}px`,
      "--seller-entry-keyboard-offset": `${keyboardOffset}px`,
    }),
    [dockHeight, keyboardOffset]
  );

  return (
    <div className="seller-entry-shell" style={boardStyle}>
      <div className="fast-entry-topbar">
        <div className="section-header">
          <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Seller Ticket Entry"}</h2>
          <span>Manual entry stays primary, with handwritten scan review as an extra way to fill ticket rows.</span>
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

      <TicketScanPanel
        busy={scanBusy}
        fileName={scanFileName}
        onSelectFile={handleScanFileSelect}
      />

      {scanReview ? (
        <TicketScanReview
          hasExistingRows={previewRows.length > 0}
          result={scanReview}
          onCancel={handleCancelScanReview}
          onConfirm={handleConfirmScanReview}
        />
      ) : null}

      <div className="seller-entry-main">
        <section className="seller-entry-panel">
          <ModeTabs activeMode={activeEntryMode} onChange={handleModeChange} />

          {activeEntryMode === "juri" ? (
            <FastJuriEntry
              draft={activeInputs}
              stats={activeModeStats}
              formatCurrency={formatCurrency}
              isEditing={Boolean(editState && editState.mode === activeEntryMode)}
              onNumberChange={(value) => updateModeInput("juri", "number", value)}
              onQuantityChange={(value) => updateModeInput("juri", "quantity", value)}
              onQuickTextChange={(value) => updateModeInput("juri", "quickText", value)}
              onStructuredSubmit={handleStructuredSubmit}
              onQuickSubmit={handleQuickSubmit}
              onFocusField={scrollFieldIntoView}
              numberRef={registerInputRef("juri", "number")}
              quantityRef={registerInputRef("juri", "quantity")}
              quickTextRef={registerInputRef("juri", "quickText")}
            />
          ) : (
            <FastHouseEntry
              mode={activeEntryMode}
              draft={activeInputs}
              stats={activeModeStats}
              formatCurrency={formatCurrency}
              isEditing={Boolean(editState && editState.mode === activeEntryMode)}
              onNumberChange={(value) => updateModeInput(activeEntryMode, "number", value)}
              onQuantityChange={(value) => updateModeInput(activeEntryMode, "quantity", value)}
              onQuickTextChange={(value) => updateModeInput(activeEntryMode, "quickText", value)}
              onStructuredSubmit={handleStructuredSubmit}
              onQuickSubmit={handleQuickSubmit}
              onFocusField={scrollFieldIntoView}
              numberRef={registerInputRef(activeEntryMode, "number")}
              quantityRef={registerInputRef(activeEntryMode, "quantity")}
              quickTextRef={registerInputRef(activeEntryMode, "quickText")}
            />
          )}
        </section>

        <aside className="seller-entry-panel seller-entry-preview-panel">
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

      <div ref={dockRef} className="seller-entry-dock">
        <StickyTicketSummary formatCurrency={formatCurrency} previewSummary={previewSummary} />
        <SaveActionBar
          canSave={previewRows.length > 0}
          saving={savingTicket}
          onClear={handleClearAll}
          onResetMode={handleResetCurrentMode}
          onSaveTicket={handleSaveTicket}
        />
      </div>
    </div>
  );
}
