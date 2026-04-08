import React from "react";

import { formatRowValue } from "./scanEntryUtils.js";

export default function ScanEntryJuriChip({ row, onClick }) {
  const isFlagged = row.tone === "low" || !row.isValid;

  return (
    <button
      type="button"
      className={`scan-juri-chip ${isFlagged ? "flagged" : "safe"}`}
      onClick={() => onClick(row)}
    >
      <span className="scan-juri-chip-value">{formatRowValue("juri", row.number, row.quantity)}</span>
      {isFlagged ? <span className="scan-juri-chip-flag">!</span> : null}
    </button>
  );
}
