import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  findFirstFilledDigit,
  getJuriQuantity,
  parseFastJuriText,
  sanitizeFastDigits,
  sanitizeFastQuantity,
  upsertJuriText,
} from "../untils/fastEntry.js";

const AUTO_JURI_ADVANCE_DELAY = 420;
const KEYPAD_VALUES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "DEL"];

function triggerHaptic(duration = 35) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(duration);
  }
}

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

function SpeedKeypad({ onInput, shortcuts = [] }) {
  return (
    <div className="fast-entry-keypad-shell">
      {shortcuts.length > 0 ? (
        <div className="fast-entry-shortcuts">
          {shortcuts.map((item) => (
            <button
              key={item.label}
              type="button"
              className="fast-entry-shortcut"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="fast-entry-keypad">
        {KEYPAD_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Keypad ${value}`}
            className={`fast-entry-key ${value === "CLR" ? "warning" : ""} ${
              value === "DEL" ? "danger" : ""
            }`}
            onClick={() => onInput(value)}
          >
            {value}
          </button>
        ))}
      </div>
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
  maxBookingDate,
  onActiveEntryModeChange,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onDateChange,
  onDismissSavedTicket,
  onDrawTimeChange,
  onFourthChange,
  onJuriTextChange,
  onOpenScan,
  onPaidAmountChange,
  onPaymentModeChange,
  onPrintSavedTicket,
  onReset,
  onSave,
  onThirdChange,
  paidAmount,
  parsedJuri,
  paymentMode,
  previewItems,
  previewSummary,
  scanEntryNotice,
  third,
  ticketActionNotice,
  todayString,
}) {
  const [selectedThirdDigit, setSelectedThirdDigit] = useState(() => findFirstFilledDigit(third));
  const [selectedFourthDigit, setSelectedFourthDigit] = useState(() => findFirstFilledDigit(fourth));
  const [houseDraft, setHouseDraft] = useState({
    house: activeEntryMode === "fourth" ? "fourth" : "third",
    digit: activeEntryMode === "fourth" ? findFirstFilledDigit(fourth) : findFirstFilledDigit(third),
    baseQty: 0,
    typedQty: "",
  });
  const [juriDraft, setJuriDraft] = useState({
    number: "",
    qty: "",
    field: "number",
    baseQty: 0,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const autoAdvanceRef = useRef(null);

  const notices = [ticketActionNotice, scanEntryNotice].filter(Boolean);
  const parsedJuriList = useMemo(() => parsedJuri || parseFastJuriText(juriText), [juriText, parsedJuri]);
  const thirdEntries = useMemo(() => buildFilledDigits(third), [third]);
  const fourthEntries = useMemo(() => buildFilledDigits(fourth), [fourth]);
  const thirdQty = useMemo(() => sumValues(third), [third]);
  const fourthQty = useMemo(() => sumValues(fourth), [fourth]);
  const juriQty = useMemo(
    () => parsedJuriList.entries.reduce((sum, item) => sum + Number(item.qty || 0), 0),
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
    const nextThirdDigit = findFirstFilledDigit(third);
    const nextFourthDigit = findFirstFilledDigit(fourth);
    const currentHouse = activeEntryMode === "fourth" ? "fourth" : "third";
    const nextDigit = currentHouse === "fourth" ? nextFourthDigit : nextThirdDigit;
    const currentValues = currentHouse === "fourth" ? fourth : third;

    if (autoAdvanceRef.current) {
      window.clearTimeout(autoAdvanceRef.current);
    }

    setSelectedThirdDigit(nextThirdDigit);
    setSelectedFourthDigit(nextFourthDigit);
    setHouseDraft({
      house: currentHouse,
      digit: nextDigit,
      baseQty: Number(currentValues[nextDigit] || 0),
      typedQty: "",
    });
    setJuriDraft({
      number: "",
      qty: "",
      field: "number",
      baseQty: 0,
    });
  }, [entryUiToken]);

  useEffect(
    () => () => {
      if (autoAdvanceRef.current) {
        window.clearTimeout(autoAdvanceRef.current);
      }
    },
    []
  );

  const activeHouse = activeEntryMode === "fourth" ? "fourth" : "third";
  const activeDigit = activeHouse === "fourth" ? selectedFourthDigit : selectedThirdDigit;
  const activeHouseValues = activeHouse === "fourth" ? fourth : third;
  const activeBaseQty =
    houseDraft.house === activeHouse && houseDraft.digit === activeDigit
      ? houseDraft.baseQty
      : Number(activeHouseValues[activeDigit] || 0);
  const activeDraftQty =
    houseDraft.house === activeHouse && houseDraft.digit === activeDigit ? houseDraft.typedQty : "";
  const activeDisplayQty = activeBaseQty + (Number(activeDraftQty || 0) || 0);

  const handleModeChange = (mode) => {
    onActiveEntryModeChange(mode);

    if (mode === "third") {
      const digit = selectedThirdDigit;
      setHouseDraft({
        house: "third",
        digit,
        baseQty: Number(third[digit] || 0),
        typedQty: "",
      });
      return;
    }

    if (mode === "fourth") {
      const digit = selectedFourthDigit;
      setHouseDraft({
        house: "fourth",
        digit,
        baseQty: Number(fourth[digit] || 0),
        typedQty: "",
      });
      return;
    }

    setJuriDraft((current) => ({
      ...current,
      field: current.number.length === 2 ? "qty" : "number",
    }));
  };

  const updateSingleQuantity = (house, digit, qty) => {
    const setter = house === "third" ? onThirdChange : onFourthChange;

    setter((current) => {
      const next = Array.isArray(current) ? [...current] : Array(10).fill("");
      next[digit] = qty > 0 ? String(qty) : "";
      return next;
    });
  };

  const selectHouseDigit = (house, digit) => {
    handleModeChange(house);

    if (house === "third") {
      setSelectedThirdDigit(digit);
    } else {
      setSelectedFourthDigit(digit);
    }

    const currentValues = house === "third" ? third : fourth;

    setHouseDraft({
      house,
      digit,
      baseQty: Number(currentValues[digit] || 0),
      typedQty: "",
    });
  };

  const applyHouseKey = (value) => {
    const digit = activeHouse === "fourth" ? selectedFourthDigit : selectedThirdDigit;
    const currentBaseQty =
      houseDraft.house === activeHouse && houseDraft.digit === digit
        ? houseDraft.baseQty
        : Number((activeHouse === "fourth" ? fourth : third)[digit] || 0);

    if (/^\d$/.test(value)) {
      const nextTypedQty = sanitizeFastQuantity(`${activeDraftQty}${value}`);
      updateSingleQuantity(activeHouse, digit, currentBaseQty + (Number(nextTypedQty || 0) || 0));
      setHouseDraft({
        house: activeHouse,
        digit,
        baseQty: currentBaseQty,
        typedQty: nextTypedQty,
      });
      return;
    }

    if (value === "DEL") {
      const nextTypedQty = activeDraftQty.slice(0, -1);
      updateSingleQuantity(activeHouse, digit, currentBaseQty + (Number(nextTypedQty || 0) || 0));
      setHouseDraft({
        house: activeHouse,
        digit,
        baseQty: currentBaseQty,
        typedQty: nextTypedQty,
      });
      return;
    }

    if (value === "CLR") {
      updateSingleQuantity(activeHouse, digit, 0);
      setHouseDraft({
        house: activeHouse,
        digit,
        baseQty: 0,
        typedQty: "",
      });
    }
  };

  const handleJuriAutoAdvance = () => {
    if (autoAdvanceRef.current) {
      window.clearTimeout(autoAdvanceRef.current);
    }

    autoAdvanceRef.current = window.setTimeout(() => {
      setJuriDraft({
        number: "",
        qty: "",
        field: "number",
        baseQty: 0,
      });
    }, AUTO_JURI_ADVANCE_DELAY);
  };

  const handleJuriKey = (value) => {
    handleModeChange("juri");

    if (/^\d$/.test(value)) {
      if (juriDraft.field === "number") {
        const nextNumber = sanitizeFastDigits(`${juriDraft.number}${value}`, 2);

        if (!nextNumber) {
          triggerHaptic();
          return;
        }

        setJuriDraft({
          number: nextNumber,
          qty: "",
          field: nextNumber.length === 2 ? "qty" : "number",
          baseQty: nextNumber.length === 2 ? getJuriQuantity(juriText, nextNumber) : 0,
        });
        return;
      }

      if (juriDraft.number.length !== 2) {
        triggerHaptic();
        return;
      }

      const nextQty = sanitizeFastQuantity(`${juriDraft.qty}${value}`);
      const nextTotal = juriDraft.baseQty + (Number(nextQty || 0) || 0);

      onJuriTextChange((current) => upsertJuriText(current, juriDraft.number, nextTotal));
      setJuriDraft((current) => ({
        ...current,
        qty: nextQty,
      }));
      handleJuriAutoAdvance();
      return;
    }

    if (value === "DEL") {
      if (juriDraft.field === "qty") {
        const nextQty = juriDraft.qty.slice(0, -1);
        const nextTotal = juriDraft.baseQty + (Number(nextQty || 0) || 0);
        onJuriTextChange((current) => upsertJuriText(current, juriDraft.number, nextTotal));
        setJuriDraft((current) => ({
          ...current,
          qty: nextQty,
        }));
        return;
      }

      setJuriDraft((current) => ({
        number: current.number.slice(0, -1),
        qty: "",
        field: "number",
        baseQty: 0,
      }));
      return;
    }

    if (value === "CLR") {
      if (juriDraft.number.length === 2) {
        onJuriTextChange((current) => upsertJuriText(current, juriDraft.number, 0));
      }

      setJuriDraft({
        number: "",
        qty: "",
        field: "number",
        baseQty: 0,
      });
    }
  };

  const selectJuriEntry = (entry) => {
    handleModeChange("juri");
    setJuriDraft({
      number: entry.num,
      qty: "",
      field: "qty",
      baseQty: Number(entry.qty || 0),
    });
  };

  const activeJuriTotal = juriDraft.baseQty + (Number(juriDraft.qty || 0) || 0);
  const drawLabel = formatDrawTime(drawTime);

  return (
    <div className="fast-entry-shell">
      <div className="fast-entry-topbar">
        <div className="section-header">
          <h2>{editingTicketId ? `Edit Ticket #${editingTicketId}` : "Create New Ticket"}</h2>
          <span>Calculator-style seller entry. Tap number, enter qty, save fast.</span>
        </div>

        <div className="fast-entry-top-actions">
          <button type="button" className="outline-btn" onClick={onOpenScan}>
            Scan Entry
          </button>
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

      <div className="fast-mode-strip" aria-label="Fast ticket entry mode">
        <ModeButton
          active={activeEntryMode === "third"}
          label="3rd House"
          hint={`${thirdEntries.length} row | Qty ${thirdQty}`}
          onClick={() => handleModeChange("third")}
        />
        <ModeButton
          active={activeEntryMode === "fourth"}
          label="4th House"
          hint={`${fourthEntries.length} row | Qty ${fourthQty}`}
          onClick={() => handleModeChange("fourth")}
        />
        <ModeButton
          active={activeEntryMode === "juri"}
          label="Juri"
          hint={`${parsedJuriList.entries.length} row | Qty ${juriQty}`}
          onClick={() => handleModeChange("juri")}
        />
      </div>

      {activeEntryMode === "juri" ? (
        <div className="fast-entry-panel glass-panel">
          <div className="fast-entry-panel-head">
            <div>
              <strong>Juri Entry</strong>
              <span>Enter 2 digits, then qty. Same number adds automatically.</span>
            </div>
            <small>Rows {parsedJuriList.entries.length}</small>
          </div>

          <div className="fast-juri-stage">
            <button
              type="button"
              className={`fast-juri-stage-card ${juriDraft.field === "number" ? "active" : ""}`}
              onClick={() =>
                setJuriDraft((current) => ({
                  ...current,
                  field: "number",
                }))
              }
            >
              <span>Number</span>
              <strong>{juriDraft.number ? juriDraft.number.padStart(2, "0") : "--"}</strong>
            </button>
            <button
              type="button"
              className={`fast-juri-stage-card ${juriDraft.field === "qty" ? "active" : ""}`}
              onClick={() =>
                setJuriDraft((current) => ({
                  ...current,
                  field: current.number.length === 2 ? "qty" : "number",
                }))
              }
            >
              <span>Qty</span>
              <strong>{juriDraft.qty || (juriDraft.baseQty ? `+${juriDraft.baseQty}` : "0")}</strong>
            </button>
          </div>

          <div className="fast-entry-active-note">
            <span>Live total</span>
            <strong>{juriDraft.number.length === 2 ? `${juriDraft.number}-${activeJuriTotal || 0}` : "Choose 2 digits"}</strong>
            <small>{juriDraft.baseQty ? `Existing ${juriDraft.baseQty}, new total ${activeJuriTotal}` : "Auto-ready for next number after a short pause."}</small>
          </div>

          <div className="fast-entry-chip-grid">
            {parsedJuriList.entries.length === 0 ? (
              <div className="fast-entry-empty">No juri rows yet.</div>
            ) : (
              parsedJuriList.entries.map((entry) => (
                <button
                key={`juri-${entry.num}`}
                  type="button"
                  aria-label={`Juri ${entry.num} qty ${entry.qty}`}
                  className={`fast-entry-chip ${
                    juriDraft.number === entry.num ? "active" : ""
                  }`}
                  onClick={() => selectJuriEntry(entry)}
                >
                  {entry.num}-{entry.qty}
                </button>
              ))
            )}
          </div>

          {parsedJuriList.invalid.length > 0 ? (
            <div className="fast-entry-error-line">
              Invalid rows ignored: {parsedJuriList.invalid.join(", ")}
            </div>
          ) : null}

          <SpeedKeypad
            onInput={handleJuriKey}
            shortcuts={[
              {
                label: "Clear Juri",
                onClick: () => {
                  onJuriTextChange("");
                  setJuriDraft({
                    number: "",
                    qty: "",
                    field: "number",
                    baseQty: 0,
                  });
                },
              },
              {
                label: "Reset Pick",
                onClick: () =>
                  setJuriDraft((current) => ({
                    number: current.number,
                    qty: "",
                    field: current.number.length === 2 ? "qty" : "number",
                    baseQty: current.number.length === 2 ? getJuriQuantity(juriText, current.number) : 0,
                  })),
              },
            ]}
          />
        </div>
      ) : (
        <div className="fast-entry-panel glass-panel">
          <div className="fast-entry-panel-head">
            <div>
              <strong>{activeHouse === "third" ? "3rd House" : "4th House"}</strong>
              <span>Tap a digit, type qty. Same digit adds to the current total.</span>
            </div>
            <small>Rows {activeHouse === "third" ? thirdEntries.length : fourthEntries.length}</small>
          </div>

          <div className="fast-entry-active-note">
            <span>Active digit</span>
            <strong>
              {activeHouse === "third" ? "3rd" : "4th"} House {activeDigit}
            </strong>
            <small>
              {activeBaseQty ? `Existing ${activeBaseQty}` : "New row"} | Draft {activeDraftQty || 0} | Total{" "}
              {activeDisplayQty || 0}
            </small>
          </div>

          <div className="fast-house-grid">
            {(activeHouse === "third" ? third : fourth).map((value, index) => (
              <button
                key={`${activeHouse}-${index}`}
                type="button"
                aria-label={`${activeHouse} digit ${index} qty ${value || 0}`}
                className={`fast-house-cell ${activeDigit === index ? "active" : ""} ${
                  Number(value || 0) > 0 ? "filled" : ""
                }`}
                onClick={() => selectHouseDigit(activeHouse, index)}
              >
                <span>{index}</span>
                <strong>{value || 0}</strong>
              </button>
            ))}
          </div>

          <div className="fast-entry-chip-grid">
            {(activeHouse === "third" ? thirdEntries : fourthEntries).length === 0 ? (
              <div className="fast-entry-empty">No house rows yet.</div>
            ) : (
              (activeHouse === "third" ? thirdEntries : fourthEntries).map((item) => (
                <button
                  key={`${activeHouse}-chip-${item.digit}`}
                  type="button"
                  className={`fast-entry-chip ${activeDigit === item.digit ? "active" : ""}`}
                  onClick={() => selectHouseDigit(activeHouse, item.digit)}
                >
                  {item.digit}={item.qty}
                </button>
              ))
            )}
          </div>

          <SpeedKeypad
            onInput={applyHouseKey}
            shortcuts={[
              {
                label: "Clear House",
                onClick: () => {
                  const setter = activeHouse === "third" ? onThirdChange : onFourthChange;
                  setter(Array(10).fill(""));
                  setHouseDraft({
                    house: activeHouse,
                    digit: 0,
                    baseQty: 0,
                    typedQty: "",
                  });
                  if (activeHouse === "third") {
                    setSelectedThirdDigit(0);
                  } else {
                    setSelectedFourthDigit(0);
                  }
                },
              },
              {
                label: "Reset Pick",
                onClick: () => {
                  updateSingleQuantity(activeHouse, activeDigit, 0);
                  setHouseDraft({
                    house: activeHouse,
                    digit: activeDigit,
                    baseQty: 0,
                    typedQty: "",
                  });
                },
              },
            ]}
          />
        </div>
      )}

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
        <div className="fast-entry-footer-summary">
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
        </div>

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
  );
}
