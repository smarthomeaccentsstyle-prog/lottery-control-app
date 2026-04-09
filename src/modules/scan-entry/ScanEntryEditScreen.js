import React from "react";

const SECTION_TITLES = {
  third: "3rd House",
  fourth: "4th House",
  juri: "Juri",
};

function formatDisplayNumber(sectionKey, value) {
  const number = String(value || "");

  if (sectionKey === "juri") {
    if (!number) {
      return "__";
    }

    return number.length === 1 ? `${number}_` : number.padStart(2, "0");
  }

  return number || "_";
}

function isFlaggedItem(item) {
  return item.sourceKind === "ignored" || item.tone === "low" || !item.isValid;
}

export default function ScanEntryEditScreen({
  item,
  editorState,
  validationMessage,
  canApplyEditorFix,
  canRemoveSelectedRow,
  saving,
  pressedKey,
  scanError,
  onBack,
  onFocusField,
  onDigitPress,
  onBackspace,
  onApplyFix,
  onRemoveRow,
}) {
  if (!item) {
    return null;
  }

  const flagged = isFlaggedItem(item);
  const sourceText = String(item.originalText || item.originalPreview || "").trim();

  return (
    <div className="scan-edit-screen">
      <div className="scan-screen-topbar">
        <button
          type="button"
          className="scan-screen-back-btn"
          aria-label="Back to review"
          onClick={onBack}
        >
          ←
        </button>

        <div className="scan-screen-title">
          <strong>Edit Entry</strong>
          <span>
            {SECTION_TITLES[item.section]} · {flagged ? "fix this highlighted row" : "adjust and return"}
          </span>
        </div>
      </div>

      {scanError ? <div className="scan-feedback error">{scanError}</div> : null}

      <div className="scan-edit-hero">
        <div>
          <span>{SECTION_TITLES[item.section]}</span>
          <strong>{flagged ? "Correct this row fast" : "Update this row"}</strong>
          <small>
            Tap Number or Quantity, then use the keypad. If OCR was right, just apply the fix and go back.
          </small>
        </div>

        {flagged ? <div className="scan-edit-flag">⚠️ Needs review</div> : null}
      </div>

      {sourceText ? (
        <div className="scan-edit-source">
          <span>Scanned Text</span>
          <strong>{sourceText}</strong>
        </div>
      ) : null}

      <div className="scan-edit-display-grid">
        <button
          type="button"
          className={`scan-edit-display ${editorState.activeField === "number" ? "active" : ""}`}
          onClick={() => onFocusField("number")}
        >
          <span>Number</span>
          <strong>{formatDisplayNumber(editorState.section, editorState.number)}</strong>
        </button>

        <button
          type="button"
          className={`scan-edit-display ${editorState.activeField === "quantity" ? "active" : ""}`}
          onClick={() => onFocusField("quantity")}
        >
          <span>Quantity</span>
          <strong>{editorState.quantity || "0"}</strong>
        </button>
      </div>

      <div className="scan-edit-keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            className={`scan-keypad-btn ${pressedKey === `digit-${digit}` ? "active" : ""}`}
            onClick={() => onDigitPress(digit)}
          >
            {digit}
          </button>
        ))}

        <button
          type="button"
          className={`scan-keypad-btn zero ${pressedKey === "digit-0" ? "active" : ""}`}
          onClick={() => onDigitPress("0")}
        >
          0
        </button>

        <button
          type="button"
          className={`scan-keypad-btn backspace ${pressedKey === "digit-backspace" ? "active" : ""}`}
          onClick={onBackspace}
        >
          ⌫
        </button>
      </div>

      <div className="scan-edit-actions">
        <div className="scan-edit-hint">
          {canApplyEditorFix ? "Row is ready to save back into the ticket." : validationMessage || "Finish both fields to continue."}
        </div>

        {canRemoveSelectedRow ? (
          <button type="button" className="outline-btn danger-btn" onClick={onRemoveRow}>
            Remove Row
          </button>
        ) : null}

        <button type="button" onClick={onApplyFix} disabled={!canApplyEditorFix || saving}>
          {saving ? "Saving..." : "Apply Fix"}
        </button>
      </div>
    </div>
  );
}
