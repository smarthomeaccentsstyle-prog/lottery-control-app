import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  normalizeSingleDraft,
  parseFastJuriText,
  sanitizeFastQuantity,
  upsertJuriText,
} from "../untils/fastEntry.js";

const MODE_META = {
  third: {
    label: "3rd House",
    displayLabel: "3RD HOUSE",
    digits: 1,
    hint: "0-9",
    tag: "3RD",
  },
  fourth: {
    label: "4th House",
    displayLabel: "4TH HOUSE",
    digits: 1,
    hint: "0-9",
    tag: "4TH",
  },
  juri: {
    label: "Juri",
    displayLabel: "JURI",
    digits: 2,
    hint: "00-99",
    tag: "JURI",
  },
};

const KEYPAD_KEYS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
  { value: "7", label: "7" },
  { value: "8", label: "8" },
  { value: "9", label: "9" },
  { value: "0", label: "0", className: "zero" },
  { value: "backspace", label: "⌫", className: "backspace" },
];

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

function buildComposerState() {
  return {
    number: "",
    quantity: "",
    stage: "number",
    isEditing: false,
    editingKey: "",
  };
}

function getModeMeta(mode) {
  return MODE_META[mode] || MODE_META.third;
}

function formatEntryNumber(mode, number) {
  return mode === "juri" ? String(number).padStart(2, "0") : String(number);
}

function formatDisplayNumber(mode, number) {
  const value = String(number || "");

  if (!value) {
    return mode === "juri" ? "__" : "_";
  }

  if (mode === "juri") {
    return value.length === 1 ? `${value}_` : formatEntryNumber(mode, value);
  }

  return value;
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

function ModeButton({ active, label, hint, onClick }) {
  return (
    <button
      type="button"
      className={`fast-mode-btn ${active ? "active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <span>{hint}</span>
      <strong>{label}</strong>
    </button>
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
  const [composer, setComposer] = useState(() => buildComposerState());
  const [pressedKey, setPressedKey] = useState("");
  const [saveFlash, setSaveFlash] = useState(false);
  const [statusNotice, setStatusNotice] = useState(null);
  const keyPulseTimeoutRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const saveFlashTimeoutRef = useRef(null);
  const pendingLoadRef = useRef(null);
  const pendingDraftOverrideRef = useRef({
    third: normalizeSingleDraft(third),
    fourth: normalizeSingleDraft(fourth),
    juriText: String(juriText || ""),
  });

  const parsedJuriList = useMemo(() => parsedJuri || parseFastJuriText(juriText), [juriText, parsedJuri]);
  const thirdEntries = useMemo(() => buildFilledDigits(third), [third]);
  const fourthEntries = useMemo(() => buildFilledDigits(fourth), [fourth]);
  const thirdQty = useMemo(() => sumValues(third), [third]);
  const fourthQty = useMemo(() => sumValues(fourth), [fourth]);
  const juriQty = useMemo(
    () => parsedJuriList.entries.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    [parsedJuriList.entries]
  );

  const modeRows = useMemo(
    () => ({
      third: thirdEntries.map((item) => ({
        key: `third-${item.digit}`,
        mode: "third",
        number: String(item.digit),
        qty: item.qty,
      })),
      fourth: fourthEntries.map((item) => ({
        key: `fourth-${item.digit}`,
        mode: "fourth",
        number: String(item.digit),
        qty: item.qty,
      })),
      juri: parsedJuriList.entries.map((item) => ({
        key: `juri-${item.num}`,
        mode: "juri",
        number: formatEntryNumber("juri", item.num),
        qty: Number(item.qty || 0),
      })),
    }),
    [fourthEntries, parsedJuriList.entries, thirdEntries]
  );

  const previewRows = useMemo(
    () =>
      previewItems.map((item) => {
        const mode = mapItemTypeToMode(item.type);

        return {
          key: `${mode}-${formatEntryNumber(mode, item.num)}`,
          mode,
          number: formatEntryNumber(mode, item.num),
          qty: Number(item.qty || 0),
          tag: getModeMeta(mode).tag,
        };
      }),
    [previewItems]
  );

  const currentModeMeta = getModeMeta(activeEntryMode);
  const activeModeRows = modeRows[activeEntryMode] || [];
  const activeModeQty = activeEntryMode === "fourth" ? fourthQty : activeEntryMode === "juri" ? juriQty : thirdQty;
  const numberComplete = composer.number.length === currentModeMeta.digits;
  const typedQty = Number(composer.quantity || 0) || 0;

  const savedQtyForNumber = useMemo(() => {
    if (!numberComplete) {
      return 0;
    }

    if (activeEntryMode === "juri") {
      const match = parsedJuriList.entries.find(
        (item) => item.num === formatEntryNumber("juri", composer.number)
      );

      return match ? Number(match.qty || 0) : 0;
    }

    const source = activeEntryMode === "fourth" ? fourth : third;
    return Number(source[Number(composer.number)] || 0);
  }, [activeEntryMode, composer.number, fourth, numberComplete, parsedJuriList.entries, third]);

  const nextQtyForNumber = composer.isEditing ? typedQty : savedQtyForNumber + typedQty;
  const canSaveEntry = numberComplete && typedQty > 0;
  const drawLabel = formatDrawTime(drawTime);
  const inlineNotices = [ticketActionNotice, statusNotice].filter(Boolean);

  useEffect(() => {
    const pendingLoad = pendingLoadRef.current;

    if (pendingLoad && pendingLoad.mode === activeEntryMode) {
      setComposer({
        number: pendingLoad.number,
        quantity: "",
        stage: "quantity",
        isEditing: true,
        editingKey: pendingLoad.key,
      });
      pendingLoadRef.current = null;
      return;
    }

    setComposer(buildComposerState());
  }, [activeEntryMode, entryUiToken]);

  useEffect(() => {
    return () => {
      window.clearTimeout(keyPulseTimeoutRef.current);
      window.clearTimeout(noticeTimeoutRef.current);
      window.clearTimeout(saveFlashTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    pendingDraftOverrideRef.current = {
      third: normalizeSingleDraft(third),
      fourth: normalizeSingleDraft(fourth),
      juriText: String(juriText || ""),
    };
  }, [fourth, juriText, third]);

  const pulseKey = (key, vibration = 10) => {
    setPressedKey(key);
    window.clearTimeout(keyPulseTimeoutRef.current);
    keyPulseTimeoutRef.current = window.setTimeout(() => {
      setPressedKey("");
    }, 140);

    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(vibration);
    }
  };

  const pushNotice = (message, tone = "info") => {
    setStatusNotice({ message, tone });
    window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = window.setTimeout(() => {
      setStatusNotice(null);
    }, 1500);
  };

  const flashSaveEntry = () => {
    setSaveFlash(true);
    window.clearTimeout(saveFlashTimeoutRef.current);
    saveFlashTimeoutRef.current = window.setTimeout(() => {
      setSaveFlash(false);
    }, 260);
  };

  const buildDraftOverride = (nextThird = third, nextFourth = fourth, nextJuriText = juriText) => ({
    third: normalizeSingleDraft(nextThird),
    fourth: normalizeSingleDraft(nextFourth),
    juriText: String(nextJuriText || ""),
  });

  const updateSingleQuantity = (house, digit, qty) => {
    const baseValues = house === "third" ? third : fourth;
    const nextValues = normalizeSingleDraft(baseValues);
    nextValues[digit] = qty > 0 ? String(qty) : "";

    pendingDraftOverrideRef.current =
      house === "third"
        ? buildDraftOverride(nextValues, fourth, juriText)
        : buildDraftOverride(third, nextValues, juriText);

    if (house === "third") {
      onThirdChange(nextValues);
      return;
    }

    onFourthChange(nextValues);
  };

  const handleModeChange = (mode) => {
    pulseKey(`mode-${mode}`, 8);

    if (mode !== activeEntryMode) {
      onActiveEntryModeChange(mode);
    }
  };

  const handleDigitTap = (digit) => {
    pulseKey(`digit-${digit}`);

    setComposer((current) => {
      if (current.stage === "number") {
        const nextNumber =
          currentModeMeta.digits === 1
            ? String(digit)
            : `${current.number}${digit}`.slice(0, currentModeMeta.digits);

        return {
          number: nextNumber,
          quantity: "",
          stage: nextNumber.length === currentModeMeta.digits ? "quantity" : "number",
          isEditing: false,
          editingKey: "",
        };
      }

      return {
        ...current,
        quantity: sanitizeFastQuantity(`${current.quantity}${digit}`, 5),
      };
    });
  };

  const handleBackspace = () => {
    pulseKey("digit-backspace", 8);

    setComposer((current) => {
      if (current.stage === "quantity") {
        if (current.quantity) {
          return {
            ...current,
            quantity: current.quantity.slice(0, -1),
          };
        }

        if (!current.number) {
          return current;
        }

        return {
          number: current.number.slice(0, -1),
          quantity: "",
          stage: "number",
          isEditing: false,
          editingKey: "",
        };
      }

      if (!current.number) {
        return current;
      }

      return {
        ...current,
        number: current.number.slice(0, -1),
        isEditing: false,
        editingKey: "",
      };
    });
  };

  const handleSaveEntry = () => {
    if (!canSaveEntry) {
      return;
    }

    const formattedNumber = formatEntryNumber(activeEntryMode, composer.number);

    if (activeEntryMode === "juri") {
      const nextJuriText = upsertJuriText(juriText, formattedNumber, nextQtyForNumber);
      pendingDraftOverrideRef.current = buildDraftOverride(third, fourth, nextJuriText);
      onJuriTextChange(nextJuriText);
    } else {
      updateSingleQuantity(activeEntryMode, Number(formattedNumber), nextQtyForNumber);
    }

    pulseKey("save-entry", 18);
    flashSaveEntry();
    pushNotice(
      composer.isEditing
        ? `${formattedNumber} × ${typedQty} updated`
        : `${formattedNumber} × ${typedQty} saved`,
      "success"
    );
    setComposer(buildComposerState());
  };

  const handlePreviewRowTap = (row) => {
    pulseKey(`row-${row.key}`, 8);
    pushNotice(`${row.number} selected. Enter replacement quantity.`, "info");

    if (row.mode !== activeEntryMode) {
      pendingLoadRef.current = row;
      onActiveEntryModeChange(row.mode);
      return;
    }

    setComposer({
      number: row.number,
      quantity: "",
      stage: "quantity",
      isEditing: true,
      editingKey: row.key,
    });
  };

  const handleClearAll = () => {
    pulseKey("clear-all", 16);
    pendingLoadRef.current = null;
    pendingDraftOverrideRef.current = buildDraftOverride([], [], "");
    onReset();
    setComposer(buildComposerState());
    pushNotice("All entries cleared.", "info");
  };

  const helperText = useMemo(() => {
    if (!composer.number) {
      return currentModeMeta.digits === 2
        ? "Tap the first juri digit. The second tap completes the number and moves to quantity."
        : "Tap one digit. Quantity becomes active immediately.";
    }

    if (!numberComplete) {
      return "Tap the second digit to complete the juri number.";
    }

    if (!composer.quantity) {
      if (composer.isEditing && savedQtyForNumber > 0) {
        return `Current qty ${savedQtyForNumber}. Enter the replacement quantity.`;
      }

      if (savedQtyForNumber > 0) {
        return `Saved qty ${savedQtyForNumber}. Enter more quantity to add.`;
      }

      return "Tap quantity, then save the entry.";
    }

    if (composer.isEditing) {
      return `Will replace ${savedQtyForNumber} with ${typedQty}.`;
    }

    if (savedQtyForNumber > 0) {
      return `Will add ${typedQty}. New total ${nextQtyForNumber}.`;
    }

    return `Ready to save ${formatEntryNumber(activeEntryMode, composer.number)} × ${typedQty}.`;
  }, [
    activeEntryMode,
    composer.isEditing,
    composer.number,
    composer.quantity,
    currentModeMeta.digits,
    nextQtyForNumber,
    numberComplete,
    savedQtyForNumber,
    typedQty,
  ]);

  return (
    <div className="fast-entry-shell">
      <div className="fast-entry-topbar">
        <div className="section-header">
          <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Create New Ticket"}</h2>
          <span>Tap only. Number completes first and quantity follows automatically.</span>
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
          <span>Booking For:</span>
          <strong>{effectiveTicketDate}</strong>
          <small>
            {drawLabel}
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
        <strong>Booking Flow Active</strong>
        <span>
          {bookingDateAdjusted
            ? `${formatDrawTime(drawTime)} last entry closed at ${formatEntryCutoffTime(drawTime)} for ${date}. Ticket moves to ${effectiveTicketDate}.`
            : `${formatDrawTime(drawTime)} ticket entry is open for ${effectiveTicketDate} until ${formatEntryCutoffTime(drawTime)}.`}
        </span>
      </div>

      <div className="fast-entry-workspace fast-entry-workspace-v2">
        <section className="fast-entry-composer glass-panel">
          <div className="fast-mode-strip" aria-label="Entry mode selection">
            <ModeButton
              active={activeEntryMode === "third"}
              label="3rd House"
              hint={MODE_META.third.hint}
              onClick={() => handleModeChange("third")}
            />
            <ModeButton
              active={activeEntryMode === "fourth"}
              label="4th House"
              hint={MODE_META.fourth.hint}
              onClick={() => handleModeChange("fourth")}
            />
            <ModeButton
              active={activeEntryMode === "juri"}
              label="Juri"
              hint={MODE_META.juri.hint}
              onClick={() => handleModeChange("juri")}
            />
          </div>

          <div className="fast-entry-step-card">
            <span>{composer.stage === "number" ? "Step 1" : "Step 2"}</span>
            <strong>{composer.stage === "number" ? "Pick Number" : "Enter Quantity"}</strong>
            <small>{helperText}</small>
          </div>

          <div className="fast-entry-display-grid">
            <div className={`fast-entry-display-card ${composer.stage === "number" ? "active" : ""}`}>
              <span>Number</span>
              <strong>{formatDisplayNumber(activeEntryMode, composer.number)}</strong>
              <small>{currentModeMeta.displayLabel}</small>
            </div>

            <div className={`fast-entry-display-card ${composer.stage === "quantity" ? "active" : ""}`}>
              <span>Quantity</span>
              <strong>{composer.quantity || "0"}</strong>
              <small>
                {composer.isEditing
                  ? "Replacing saved row"
                  : savedQtyForNumber > 0 && numberComplete
                    ? `Saved ${savedQtyForNumber}`
                    : "Tap with keypad"}
              </small>
            </div>
          </div>

          <div className="fast-entry-current-line">
            <span>Live Entry</span>
            <strong>
              {numberComplete ? formatEntryNumber(activeEntryMode, composer.number) : "--"} ×{" "}
              {composer.quantity || "0"}
            </strong>
            <small>
              {canSaveEntry
                ? composer.isEditing
                  ? `After save: ${nextQtyForNumber}`
                  : `After save: ${nextQtyForNumber}`
                : "Finish number and quantity to enable save."}
            </small>
          </div>

          <div className="fast-keypad" aria-label="Shared keypad">
            {KEYPAD_KEYS.map((key) => {
              const keyId = key.value === "backspace" ? "digit-backspace" : `digit-${key.value}`;

              return (
                <button
                  key={key.value}
                  type="button"
                  className={`fast-keypad-btn ${key.className || ""} ${pressedKey === keyId ? "active" : ""}`}
                  aria-label={key.value === "backspace" ? "Backspace" : `Digit ${key.value}`}
                  onClick={() => {
                    if (key.value === "backspace") {
                      handleBackspace();
                      return;
                    }

                    handleDigitTap(key.value);
                  }}
                >
                  {key.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`fast-save-entry-btn ${saveFlash ? "flash" : ""}`}
            onClick={handleSaveEntry}
            disabled={!canSaveEntry}
          >
            Save Entry
          </button>
        </section>

        <aside className="fast-entry-preview-panel glass-panel">
          <div className="fast-entry-preview-head fast-entry-preview-head-v2">
            <div>
              <strong>Live Preview</strong>
              <span>Tap any saved row to correct it instantly.</span>
            </div>
            <small>{previewItems.length ? `${previewItems.length} row(s)` : "Empty"}</small>
          </div>

          <div className="fast-entry-preview-highlight fast-entry-preview-highlight-v2">
            <span>Total</span>
            <strong>{formatCurrency(previewSummary.total)}</strong>
            <small>
              {getModeMeta(activeEntryMode).displayLabel} | {activeModeRows.length} row(s) | Qty {activeModeQty}
            </small>
          </div>

          <div className="fast-entry-preview-list" aria-label="Current ticket rows">
            {previewRows.length > 0 ? (
              previewRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className={`fast-preview-row ${row.mode === activeEntryMode ? "mode-active" : ""} ${
                    composer.isEditing && composer.editingKey === row.key ? "editing" : ""
                  }`}
                  onClick={() => handlePreviewRowTap(row)}
                >
                  <span className="fast-preview-row-tag">{row.tag}</span>
                  <strong>
                    {row.number} × {row.qty}
                  </strong>
                </button>
              ))
            ) : (
              <div className="fast-entry-empty">Save entries and the ticket preview will build here.</div>
            )}
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

      <div className="fast-entry-footer fast-entry-footer-v2">
        <div className="fast-entry-ticket-summary">
          <span>Ticket Total</span>
          <strong>{formatCurrency(previewSummary.total)}</strong>
          <small>
            {previewItems.length ? `${previewItems.length} row(s) ready to save.` : "No saved entries yet."}
          </small>
        </div>

        <div className="ticket-save-actions fast-entry-footer-actions">
          <button className="outline-btn" type="button" onClick={handleClearAll}>
            Clear All
          </button>
          <button
            type="button"
            onClick={() => onSave(pendingDraftOverrideRef.current)}
            disabled={previewItems.length === 0}
          >
            {editingTicketId ? "Update Ticket" : "Save Ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
