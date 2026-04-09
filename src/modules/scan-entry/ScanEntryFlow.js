import React, { useMemo, useRef, useState } from "react";

import "./ScanEntry.css";
import {
  buildManualEntryDraft,
  buildScanReviewFromScanPayload,
  createEmptyReviewState,
  getReviewStats,
  getSectionOrder,
  insertReviewRow,
  normalizeEditedNumber,
  normalizeEditedQuantity,
  updateReviewRow,
  validateEditedRow,
} from "./scanEntryUtils.js";
import {
  createPreviewDataUrl,
  enhanceCanvasForOcr,
  loadFileToCanvas,
  recognizeTicketImage,
} from "./scanEntryOcr.js";
import ScanEntryEditScreen from "./ScanEntryEditScreen.js";
import ScanEntryReview from "./ScanEntryReview.js";

function buildEditorState(item) {
  if (!item) {
    return {
      itemId: "",
      sourceKind: "row",
      section: "third",
      number: "",
      quantity: "",
      activeField: "number",
      replaceOnInput: false,
    };
  }

  return {
    itemId: item.id,
    sourceKind: item.sourceKind || "row",
    section: item.section,
    number: String(item.number || ""),
    quantity: String(item.quantity || ""),
    activeField:
      item.sourceKind === "ignored" || !item.number || (item.section === "juri" && String(item.number).length < 2)
        ? "number"
        : "quantity",
    replaceOnInput: true,
  };
}

function formatProcessingStatus(status) {
  const text = String(status || "").toLowerCase();

  if (text.includes("rotated")) {
    return "Auto-rotating ticket...";
  }

  if (text.includes("3rd house")) {
    return "Detecting 3rd House rows...";
  }

  if (text.includes("4th house")) {
    return "Detecting 4th House rows...";
  }

  if (text.includes("juri")) {
    return "Detecting Juri rows...";
  }

  if (text.includes("complete")) {
    return "Confidence review ready";
  }

  return status || "Scanning ticket...";
}

function buildSectionItems(reviewState) {
  const items = getSectionOrder().reduce((accumulator, sectionKey) => {
    accumulator[sectionKey] = ((reviewState && reviewState.sections && reviewState.sections[sectionKey]) || []).map(
      (row) => ({
        ...row,
        sourceKind: "row",
      })
    );
    return accumulator;
  }, {});

  ((reviewState && reviewState.ignoredLines) || []).forEach((line) => {
    const sectionKey = line.section || "third";

    if (!items[sectionKey]) {
      items[sectionKey] = [];
    }

    items[sectionKey].push({
      id: line.id,
      section: sectionKey,
      sourceKind: "ignored",
      number: "",
      quantity: "",
      tone: "low",
      isValid: false,
      issue: line.reason || "Enter this row manually",
      originalText: line.text || "",
      originalPreview: line.text || "",
      confidence: Number(line.confidence || 0),
      suggestions: [],
    });
  });

  return items;
}

function flattenSectionItems(sectionItems) {
  return getSectionOrder().flatMap((sectionKey) => sectionItems[sectionKey] || []);
}

function findItemById(sectionItems, itemId) {
  return flattenSectionItems(sectionItems).find((item) => item.id === itemId) || null;
}

function getRowTotal(row, singleRate, juriRate) {
  return Number(row.quantity || 0) * (row.section === "juri" ? juriRate : singleRate);
}

export default function ScanEntryFlow({
  bookingDateAdjusted,
  bookingDate,
  date,
  drawLabel,
  drawOptions,
  drawTime,
  formatCurrency,
  formatEntryCutoffTime,
  juriRate,
  lastSavedTicket,
  lastSavedTicketId,
  maxBookingDate,
  onConfirmAndSave,
  onDateChange,
  onDismissSavedTicket,
  onDrawTimeChange,
  onPrintSavedTicket,
  singleRate,
  ticketActionNotice,
  todayString,
}) {
  const [phase, setPhase] = useState("input");
  const [reviewState, setReviewState] = useState(() => createEmptyReviewState());
  const [previewUrl, setPreviewUrl] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState("Choose a ticket image to start scanning.");
  const [scanError, setScanError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorState, setEditorState] = useState(() => buildEditorState(null));
  const [pressedKey, setPressedKey] = useState("");
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const pendingSourceRef = useRef("gallery");
  const keyPulseTimeoutRef = useRef(null);

  const stats = useMemo(() => getReviewStats(reviewState), [reviewState]);
  const sectionItems = useMemo(() => buildSectionItems(reviewState), [reviewState]);
  const selectedItem = useMemo(
    () => findItemById(sectionItems, editorState.itemId),
    [editorState.itemId, sectionItems]
  );
  const estimatedTotal = useMemo(
    () =>
      buildManualEntryDraft(reviewState, {
        safeOnly: false,
      }).appliedRows.reduce((sum, row) => sum + getRowTotal(row, singleRate, juriRate), 0),
    [juriRate, reviewState, singleRate]
  );
  const normalizedEditorNumber = normalizeEditedNumber(editorState.section, editorState.number);
  const normalizedEditorQuantity = normalizeEditedQuantity(editorState.quantity);
  const editorValidation = editorState.itemId
    ? validateEditedRow(editorState.section, normalizedEditorNumber, normalizedEditorQuantity)
    : {
        ok: false,
        message: "",
      };
  const canApplyEditorFix = Boolean(editorState.itemId) && editorValidation.ok;
  const canRemoveSelectedRow =
    Boolean(editorState.itemId) && editorState.sourceKind === "row" && !saving;
  const screenPhase = phase === "edit" && !selectedItem ? "review" : phase;

  const pulseKey = (key) => {
    setPressedKey(key);
    window.clearTimeout(keyPulseTimeoutRef.current);
    keyPulseTimeoutRef.current = window.setTimeout(() => {
      setPressedKey("");
    }, 140);

    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }
  };

  const resetScanner = () => {
    setPhase("input");
    setReviewState(createEmptyReviewState());
    setPreviewUrl("");
    setProcessingProgress(0);
    setProcessingLabel("Choose a ticket image to start scanning.");
    setScanError("");
    setSaving(false);
    setEditorState(buildEditorState(null));
  };

  const openSourcePicker = (source) => {
    pendingSourceRef.current = source;

    if (source === "camera" && cameraInputRef.current) {
      cameraInputRef.current.click();
      return;
    }

    if (uploadInputRef.current) {
      uploadInputRef.current.click();
    }
  };

  const selectEditorItem = (item) => {
    setEditorState(buildEditorState(item));
    setScanError("");
    setPhase("edit");
  };

  const closeEditor = () => {
    setEditorState(buildEditorState(null));
    setScanError("");
    setPhase("review");
  };

  const runOcr = async (rawCanvas) => {
    const enhancedCanvas = enhanceCanvasForOcr(rawCanvas);

    setPhase("processing");
    setProcessingProgress(0.08);
    setProcessingLabel("Auto-cropping and enhancing ticket...");
    setScanError("");
    setPreviewUrl(createPreviewDataUrl(rawCanvas));
    setEditorState(buildEditorState(null));

    try {
      const result = await recognizeTicketImage(enhancedCanvas, {
        onProgress: (message) => {
          if (!message || typeof message.progress !== "number") {
            return;
          }

          setProcessingProgress(Math.max(0.08, Math.min(0.98, message.progress)));
          setProcessingLabel(formatProcessingStatus(message.status));
        },
      });
      const nextReviewState = buildScanReviewFromScanPayload(result);
      const nextStats = getReviewStats(nextReviewState);

      if (nextStats.totalRows === 0 && nextStats.ignoredCount === 0) {
        throw new Error("No ticket rows were detected. Try a sharper photo or manual entry.");
      }

      setReviewState(nextReviewState);
      setPhase("review");
      setProcessingProgress(1);
      setProcessingLabel("Confidence review ready");
      setEditorState(buildEditorState(null));
    } catch (error) {
      setScanError(error && error.message ? error.message : "Scan failed. Try another image.");
      setPhase("input");
      setProcessingProgress(0);
      setProcessingLabel("Choose a ticket image to start scanning.");
      setReviewState(createEmptyReviewState());
      setEditorState(buildEditorState(null));
    }
  };

  const handleFileSelection = async (event) => {
    const nextFile = event.target.files && event.target.files[0];

    if (!nextFile) {
      return;
    }

    try {
      const canvas = await loadFileToCanvas(nextFile);
      await runOcr(canvas);
    } catch (error) {
      setScanError(error && error.message ? error.message : "Ticket image could not be scanned.");
      setPhase("input");
      setProcessingProgress(0);
    } finally {
      event.target.value = "";
    }
  };

  const focusEditorField = (field) => {
    setEditorState((current) => ({
      ...current,
      activeField: field,
      replaceOnInput: true,
    }));
  };

  const handleDigitPress = (digit) => {
    if (!editorState.itemId) {
      return;
    }

    pulseKey(`digit-${digit}`);
    setEditorState((current) => {
      if (current.activeField === "number") {
        const baseValue = current.replaceOnInput ? "" : current.number;
        const nextNumber = normalizeEditedNumber(current.section, `${baseValue}${digit}`);
        const nextNumberComplete =
          current.section === "juri" ? nextNumber.length === 2 : nextNumber.length === 1;

        return {
          ...current,
          number: nextNumber,
          activeField: nextNumberComplete ? "quantity" : "number",
          replaceOnInput: nextNumberComplete,
        };
      }

      const baseValue = current.replaceOnInput ? "" : current.quantity;

      return {
        ...current,
        quantity: normalizeEditedQuantity(`${baseValue}${digit}`),
        replaceOnInput: false,
      };
    });
  };

  const handleBackspace = () => {
    if (!editorState.itemId) {
      return;
    }

    pulseKey("digit-backspace");
    setEditorState((current) => {
      if (current.activeField === "quantity") {
        if (current.quantity) {
          return {
            ...current,
            quantity: current.quantity.slice(0, -1),
            replaceOnInput: false,
          };
        }

        return {
          ...current,
          activeField: "number",
          replaceOnInput: false,
        };
      }

      return {
        ...current,
        number: current.number.slice(0, -1),
        replaceOnInput: false,
      };
    });
  };

  const applyEditorFix = () => {
    if (!canApplyEditorFix || !selectedItem) {
      return;
    }

    const fixPayload = {
      number: normalizedEditorNumber,
      quantity: normalizedEditorQuantity,
    };
    const nextState =
      editorState.sourceKind === "ignored"
        ? insertReviewRow(reviewState, editorState.section, fixPayload, {
            ignoredId: editorState.itemId,
            originalText: selectedItem.originalText || selectedItem.originalPreview,
            confidence: selectedItem.confidence,
          })
        : updateReviewRow(reviewState, editorState.itemId, fixPayload);

    pulseKey("apply-fix");
    setReviewState(nextState);
    setEditorState(buildEditorState(null));
    setScanError("");
    setPhase("review");
  };

  const removeSelectedRow = () => {
    if (!canRemoveSelectedRow) {
      return;
    }

    const nextState = updateReviewRow(reviewState, editorState.itemId, {
      number: editorState.number,
      quantity: "",
    });

    pulseKey("remove-row");
    setReviewState(nextState);
    setEditorState(buildEditorState(null));
    setScanError("");
    setPhase("review");
  };

  const confirmAndSave = async () => {
    const draft = buildManualEntryDraft(reviewState, {
      safeOnly: false,
    });

    if (draft.appliedRows.length === 0 || stats.issueCount > 0) {
      setScanError("Fix the highlighted rows before saving this ticket.");
      return;
    }

    try {
      setSaving(true);
      setScanError("");
      await onConfirmAndSave(draft);
      resetScanner();
    } catch (error) {
      setScanError(error && error.message ? error.message : "Ticket save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scan-board-shell">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleFileSelection}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFileSelection}
      />

      {ticketActionNotice ? (
        <div className={`fast-entry-inline-note ${ticketActionNotice.tone || "info"}`}>
          <span>{ticketActionNotice.message}</span>
        </div>
      ) : null}

      {(screenPhase === "input" || screenPhase === "processing") && (
        <>
          <div className="scan-board-header">
            <div className="section-header">
              <h2>Scanner Entry</h2>
              <span>Auto-detect ticket rows, fix only the doubtful ones, then save directly.</span>
            </div>
          </div>

          {scanError ? <div className="scan-feedback error">{scanError}</div> : null}

          <div className="fast-entry-booking-bar fast-entry-booking-bar-v2">
            <div className="fast-entry-booking-pill">
              <span>Booking For:</span>
              <strong>{bookingDate}</strong>
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
            <strong>AI Pipeline Ready</strong>
            <span>
              Auto crop, orientation fix, section detection, OCR parsing and confidence scoring all run before anything can be saved.
            </span>
          </div>

          {previewUrl ? (
            <div className="scan-preview-strip">
              <img src={previewUrl} alt="Scanned ticket preview" />
              <div>
                <strong>{drawLabel}</strong>
                <span>{bookingDate}</span>
                <small>{processingLabel}</small>
              </div>
            </div>
          ) : null}
        </>
      )}

      {screenPhase === "input" ? (
        <div className="scan-source-stage">
          <div className="scan-source-grid">
            <button type="button" className="scan-source-card camera" onClick={() => openSourcePicker("camera")}>
              <span>Camera Capture</span>
              <strong>Take photo</strong>
              <small>Opens the mobile camera and scans instantly after capture.</small>
            </button>

            <button type="button" className="scan-source-card" onClick={() => openSourcePicker("gallery")}>
              <span>Gallery Upload</span>
              <strong>Pick image</strong>
              <small>Choose any saved ticket image from the device gallery.</small>
            </button>

            <button type="button" className="scan-source-card whatsapp" onClick={() => openSourcePicker("whatsapp")}>
              <span>WhatsApp Image</span>
              <strong>Use shared photo</strong>
              <small>Open a forwarded or downloaded ticket image and scan it right away.</small>
            </button>
          </div>

          <div className="scan-source-pipeline">
            <div>
              <strong>Auto Crop</strong>
              <span>Ticket area is isolated before OCR starts.</span>
            </div>
            <div>
              <strong>Auto Rotate</strong>
              <span>Wrong orientation is retried automatically.</span>
            </div>
            <div>
              <strong>Confidence Engine</strong>
              <span>Only suspicious rows are highlighted for review.</span>
            </div>
          </div>
        </div>
      ) : null}

      {screenPhase === "processing" ? (
        <div className="scan-processing-stage">
          <div
            className="scan-processing-ring"
            style={{ "--scan-progress": `${Math.round(processingProgress * 360)}` }}
          >
            <strong>{Math.round(processingProgress * 100)}%</strong>
          </div>
          <div className="scan-processing-copy">
            <strong>{processingLabel}</strong>
            <span>Reading 3rd House, 4th House and Juri rows box by box.</span>
          </div>
        </div>
      ) : null}

      {screenPhase === "review" ? (
        <ScanEntryReview
          bookingDate={bookingDate}
          drawLabel={drawLabel}
          scanError={scanError}
          sectionItems={sectionItems}
          stats={stats}
          formatCurrency={formatCurrency}
          saving={saving}
          totalAmount={estimatedTotal}
          onConfirmAndSave={confirmAndSave}
          onRetake={resetScanner}
          onSelectItem={selectEditorItem}
        />
      ) : null}

      {screenPhase === "edit" ? (
        <ScanEntryEditScreen
          item={selectedItem}
          editorState={editorState}
          validationMessage={editorValidation.message}
          canApplyEditorFix={canApplyEditorFix}
          canRemoveSelectedRow={canRemoveSelectedRow}
          saving={saving}
          pressedKey={pressedKey}
          scanError={scanError}
          onBack={closeEditor}
          onFocusField={focusEditorField}
          onDigitPress={handleDigitPress}
          onBackspace={handleBackspace}
          onApplyFix={applyEditorFix}
          onRemoveRow={removeSelectedRow}
        />
      ) : null}

      {lastSavedTicketId ? (
        <div className="ticket-save-feedback fast-save-feedback">
          <div>
            <strong>Ticket #{lastSavedTicketId} saved</strong>
            <span>
              {lastSavedTicket
                ? `${lastSavedTicket.drawTime} | ${lastSavedTicket.date} | ${formatCurrency(lastSavedTicket.total)}`
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
    </div>
  );
}
