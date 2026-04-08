import React from "react";

import ScanEntryJuriChip from "./ScanEntryJuriChip.js";
import { formatRowValue, getSectionMeta, getSectionOrder } from "./scanEntryUtils.js";

export default function ScanEntryReview({
  reviewState,
  stats,
  hasBlockingIssues,
  hasSafeRows,
  onEdit,
  onFixFirstIssue,
  onConfirmAll,
  onConfirmSafe,
  onRetake,
}) {
  return (
    <>
      <div className="scan-review-summary">
        <div className="scan-summary-card">
          <span>Detected Rows</span>
          <strong>{stats.totalRows}</strong>
        </div>
        <div className="scan-summary-card safe">
          <span>Safe Rows</span>
          <strong>{stats.safeCount}</strong>
        </div>
        <div className="scan-summary-card warning">
          <span>Need Review</span>
          <strong>{stats.issueCount}</strong>
        </div>
      </div>

      {stats.ignoredCount > 0 ? (
        <div className="scan-feedback warning">
          {stats.ignoredCount} OCR line(s) were unclear. Fix the warning rows or confirm only the safe entries.
        </div>
      ) : null}

      <div className="scan-review-sections">
        {getSectionOrder().map((sectionKey) => (
          <ScanReviewSection
            key={sectionKey}
            sectionKey={sectionKey}
            rows={reviewState.sections[sectionKey] || []}
            onEdit={onEdit}
          />
        ))}
      </div>

      <div className="scan-review-actions">
        {!hasBlockingIssues ? (
          <button type="button" className="scan-confirm-btn" onClick={onConfirmAll}>
            Confirm Scan
          </button>
        ) : (
          <>
            <button type="button" onClick={onFixFirstIssue}>
              Fix Now
            </button>
            <button type="button" className="outline-btn" onClick={onConfirmSafe} disabled={!hasSafeRows}>
              Confirm Safe Entries
            </button>
          </>
        )}

        <button type="button" className="outline-btn" onClick={onRetake}>
          Retake
        </button>
      </div>
    </>
  );
}

function ScanReviewSection({ sectionKey, rows, onEdit }) {
  const sectionMeta = getSectionMeta(sectionKey);

  return (
    <section className={`scan-review-section ${sectionKey === "juri" ? "juri-section" : ""}`}>
      <div className="scan-section-head">
        <strong>{sectionMeta.label}</strong>
        <span>{rows.length} row(s)</span>
      </div>

      {rows.length === 0 ? (
        <p className="scan-empty-state">No rows detected.</p>
      ) : sectionKey === "juri" ? (
        <div className="scan-juri-grid">
          {rows.map((row) => (
            <div key={row.id} className="scan-juri-box">
              <ScanEntryJuriChip row={row} onClick={onEdit} />
              {row.issue || row.originalPreview ? (
                <small className="scan-juri-box-note">{row.issue || row.originalPreview}</small>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="scan-review-row-list">
          {rows.map((row) => {
            const isFlagged = row.tone === "low" || !row.isValid;

            return (
              <button
                key={row.id}
                type="button"
                className={`scan-review-row ${isFlagged ? "flagged" : "safe"}`}
                onClick={() => onEdit(row)}
              >
                <div className="scan-review-row-main">
                  <span className="scan-review-value">
                    {formatRowValue(sectionKey, row.number, row.quantity)}
                  </span>
                  <span className={`scan-review-status ${isFlagged ? "warning" : "safe"}`}>
                    {isFlagged ? "Review" : "Ready"}
                  </span>
                </div>

                {row.issue || row.originalPreview ? (
                  <small>{row.issue || row.originalPreview}</small>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
