import React from "react";

import { getSectionMeta, getSectionOrder } from "./scanEntryUtils.js";

function formatReviewNumber(sectionKey, number) {
  const value = String(number || "");

  if (!value) {
    return sectionKey === "juri" ? "__" : "_";
  }

  if (sectionKey === "juri") {
    return value.length === 1 ? `${value}_` : value.padStart(2, "0");
  }

  return value;
}

function formatReviewValue(sectionKey, number, quantity) {
  return `${formatReviewNumber(sectionKey, number)} × ${quantity || "0"}`;
}

export default function ScanEntryReview({
  sectionItems,
  stats,
  selectedItemId,
  formatCurrency,
  saving,
  totalAmount,
  onConfirmAndSave,
  onRetake,
  onSelectItem,
}) {
  const hasBlockingIssues = stats.issueCount > 0;
  const hasRows = stats.totalRows > 0;

  return (
    <div className="scan-review-shell">
      <div className="scan-review-summary">
        <div className="scan-summary-card">
          <span>Detected</span>
          <strong>{stats.totalRows}</strong>
        </div>
        <div className="scan-summary-card safe">
          <span>Auto Ready</span>
          <strong>{stats.safeCount}</strong>
        </div>
        <div className="scan-summary-card warning">
          <span>Need Fix</span>
          <strong>{stats.issueCount}</strong>
        </div>
        <div className="scan-summary-card total">
          <span>Total</span>
          <strong>{formatCurrency(totalAmount)}</strong>
        </div>
      </div>

      {stats.ignoredCount > 0 ? (
        <div className="scan-feedback warning">
          {stats.ignoredCount} unclear OCR line(s) still need a manual fix before save.
        </div>
      ) : null}

      <div className="scan-review-sections">
        {getSectionOrder().map((sectionKey) => (
          <section key={sectionKey} className="scan-review-section">
            <div className="scan-section-head">
              <div>
                <strong>{getSectionMeta(sectionKey).label}</strong>
                <span>{(sectionItems[sectionKey] || []).length} row(s)</span>
              </div>
              <small>Tap any row to correct it.</small>
            </div>

            {(sectionItems[sectionKey] || []).length === 0 ? (
              <div className="scan-empty-state">No rows detected.</div>
            ) : (
              <div className="scan-review-row-list">
                {(sectionItems[sectionKey] || []).map((item) => {
                  const isFlagged = item.sourceKind === "ignored" || item.tone === "low" || !item.isValid;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`scan-review-row ${isFlagged ? "flagged" : "safe"} ${
                        selectedItemId === item.id ? "active" : ""
                      }`}
                      onClick={() => onSelectItem(item)}
                    >
                      <div className="scan-review-row-main">
                        <span className="scan-review-value">
                          {formatReviewValue(sectionKey, item.number, item.quantity)}
                        </span>
                        {isFlagged ? (
                          <span className="scan-review-status warning">Review</span>
                        ) : (
                          <span className="scan-review-status safe">Ready</span>
                        )}
                      </div>

                      {item.issue || item.originalPreview ? (
                        <small>{item.issue || item.originalPreview}</small>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="scan-review-actions">
        <button type="button" className="outline-btn" onClick={onRetake} disabled={saving}>
          Retake Scan
        </button>
        <button
          type="button"
          className="scan-confirm-btn"
          onClick={onConfirmAndSave}
          disabled={!hasRows || hasBlockingIssues || saving}
        >
          {saving ? "Saving..." : "Confirm & Save"}
        </button>
      </div>
    </div>
  );
}
