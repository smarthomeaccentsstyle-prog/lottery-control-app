import React from "react";

import { getSectionOrder } from "./scanEntryUtils.js";

const SECTION_TITLES = {
  third: "3rd House",
  fourth: "4th House",
  juri: "Juri",
};

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

function formatReviewQuantity(quantity) {
  const value = String(quantity || "");
  return value || "__";
}

function formatReviewValue(sectionKey, number, quantity) {
  return `${formatReviewNumber(sectionKey, number)} × ${formatReviewQuantity(quantity)}`;
}

function isFlaggedItem(item) {
  return item.sourceKind === "ignored" || item.tone === "low" || !item.isValid;
}

function getSectionIssueCount(items = []) {
  return items.filter((item) => isFlaggedItem(item)).length;
}

function getRowNote(item) {
  if (!isFlaggedItem(item)) {
    return "";
  }

  const preview = String(item.originalText || item.originalPreview || "").trim();

  return preview ? `Scanned: ${preview}` : "Low-confidence row";
}

export default function ScanEntryReview({
  bookingDate,
  drawLabel,
  scanError,
  sectionItems,
  stats,
  formatCurrency,
  saving,
  totalAmount,
  onConfirmAndSave,
  onRetake,
  onSelectItem,
}) {
  const hasBlockingIssues = stats.issueCount > 0;
  const hasRows = stats.totalRows > 0;
  const subtitle = hasBlockingIssues
    ? `${stats.issueCount} highlighted row${stats.issueCount === 1 ? "" : "s"} need attention`
    : `${stats.totalRows || 0} row${stats.totalRows === 1 ? "" : "s"} ready to confirm`;

  return (
    <div className="scan-review-screen">
      <div className="scan-screen-topbar">
        <button
          type="button"
          className="scan-screen-back-btn"
          aria-label="Back to scanner"
          onClick={onRetake}
        >
          ←
        </button>

        <div className="scan-screen-title">
          <strong>Review Entries</strong>
          <span>
            {subtitle}
            {drawLabel ? ` · ${drawLabel}` : ""}
            {bookingDate ? ` · ${bookingDate}` : ""}
          </span>
        </div>
      </div>

      {scanError ? <div className="scan-feedback error">{scanError}</div> : null}

      <div className="scan-review-guidance">
        <strong>Only highlighted rows need fixing.</strong>
        <span>Tap any row to open the full-screen editor.</span>
      </div>

      <div className="scan-review-sections">
        {getSectionOrder().map((sectionKey) => {
          const items = sectionItems[sectionKey] || [];
          const issueCount = getSectionIssueCount(items);

          return (
            <section key={sectionKey} className="scan-review-section">
              <div className="scan-review-section-head">
                <div>
                  <h3>{SECTION_TITLES[sectionKey]}</h3>
                  <span>
                    {items.length} entr{items.length === 1 ? "y" : "ies"}
                  </span>
                </div>

                {issueCount > 0 ? (
                  <small className="warning">
                    {issueCount} tap to fix
                  </small>
                ) : (
                  <small>Clear</small>
                )}
              </div>

              {items.length === 0 ? (
                <div className="scan-empty-state">No rows detected.</div>
              ) : (
                <div className="scan-review-row-list">
                  {items.map((item) => {
                    const isFlagged = isFlaggedItem(item);
                    const note = getRowNote(item);

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`scan-review-row ${isFlagged ? "flagged" : ""}`}
                        onClick={() => onSelectItem(item)}
                      >
                        <div className="scan-review-row-main">
                          <div className="scan-review-row-copy">
                            <strong className="scan-review-value">
                              {formatReviewValue(sectionKey, item.number, item.quantity)}
                            </strong>
                            {note ? <small>{note}</small> : null}
                          </div>

                          <div className="scan-review-row-meta">
                            {isFlagged ? (
                              <>
                                <span className="scan-review-warning-icon" aria-hidden="true">
                                  ⚠️
                                </span>
                                <span className="scan-review-fix-pill">Tap to fix</span>
                              </>
                            ) : (
                              <span className="scan-review-chevron" aria-hidden="true">
                                ›
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="scan-review-footer">
        <div className="scan-review-total">
          <span>Total Amount</span>
          <strong>{formatCurrency(totalAmount)}</strong>
          <small>
            {hasBlockingIssues
              ? `${stats.issueCount} row${stats.issueCount === 1 ? "" : "s"} still need fixing`
              : "Ticket is ready to confirm"}
          </small>
        </div>

        <button
          type="button"
          className="scan-confirm-btn"
          onClick={onConfirmAndSave}
          disabled={!hasRows || hasBlockingIssues || saving}
        >
          {saving ? "Saving..." : "Confirm Ticket"}
        </button>
      </div>
    </div>
  );
}
