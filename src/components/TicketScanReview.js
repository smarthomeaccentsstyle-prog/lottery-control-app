import React, { useEffect, useMemo, useState } from "react";

import {
  buildScanFromReviewDraft,
  createScanReviewDraft,
  getScannedRowCount,
  SCAN_SECTION_LABELS,
} from "../untils/ticketScan.js";

const SECTION_ORDER = ["thirdHouse", "fourthHouse", "unassignedHouse", "juri"];

function ScanReviewSection({
  invalidById,
  onAddRow,
  onDeleteRow,
  onRowChange,
  rows,
  section,
}) {
  const isJuri = section === "juri";

  return (
    <div className="seller-entry-scan-review-section">
      <div className="seller-entry-scan-review-section-head">
        <div>
          <span>{SCAN_SECTION_LABELS[section]}</span>
          <strong>{rows.length} row(s)</strong>
        </div>
        <button
          type="button"
          className="seller-entry-inline-btn seller-entry-scan-add-row-btn"
          onClick={() => onAddRow(section)}
        >
          Add Row
        </button>
      </div>

      {rows.length > 0 ? (
        <div className="seller-entry-scan-edit-list">
          {rows.map((row) => {
            const invalidMessage = invalidById[row.id] || "";

            return (
              <div
                key={row.id}
                className={`seller-entry-scan-edit-row ${invalidMessage ? "invalid" : ""}`}
              >
                <label className="seller-entry-scan-edit-field seller-entry-scan-edit-field-number">
                  <span>{isJuri ? "Number" : "Digit"}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={isJuri ? 2 : 1}
                    value={row.value}
                    placeholder={isJuri ? "03" : "3"}
                    onChange={(event) => onRowChange(row.id, "value", event.target.value)}
                  />
                </label>

                <label className="seller-entry-scan-edit-field seller-entry-scan-edit-field-qty">
                  <span>Qty</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={row.qty}
                    placeholder="0"
                    onChange={(event) => onRowChange(row.id, "qty", event.target.value)}
                  />
                </label>

                <label className="seller-entry-scan-edit-field seller-entry-scan-edit-field-section">
                  <span>Section</span>
                  <select
                    value={row.section}
                    onChange={(event) => onRowChange(row.id, "section", event.target.value)}
                  >
                    {SECTION_ORDER.map((option) => (
                      <option key={option} value={option}>
                        {SCAN_SECTION_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="seller-entry-scan-delete-btn"
                  aria-label={`Delete ${SCAN_SECTION_LABELS[row.section]} row`}
                  onClick={() => onDeleteRow(row.id)}
                >
                  Delete
                </button>

                {row.section === "unassignedHouse" ? (
                  <label className="seller-entry-scan-edit-field seller-entry-scan-edit-field-reason">
                    <span>Reason</span>
                    <input
                      type="text"
                      value={row.reason}
                      placeholder="Why this row is still unclear"
                      onChange={(event) => onRowChange(row.id, "reason", event.target.value)}
                    />
                  </label>
                ) : null}

                {invalidMessage ? (
                  <div className="seller-entry-scan-row-error">{invalidMessage}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="seller-entry-scan-review-empty">
          No rows in {SCAN_SECTION_LABELS[section]} yet.
        </div>
      )}
    </div>
  );
}

export default function TicketScanReview({
  hasExistingRows,
  result,
  onCancel,
  onConfirm,
}) {
  const [reviewDraft, setReviewDraft] = useState(() => createScanReviewDraft(result));

  useEffect(() => {
    setReviewDraft(createScanReviewDraft(result));
  }, [result]);

  const prepared = useMemo(() => buildScanFromReviewDraft(reviewDraft), [reviewDraft]);
  const totalRows = getScannedRowCount(prepared.scan);
  const invalidById = useMemo(
    () =>
      prepared.invalidRows.reduce((lookup, row) => {
        lookup[row.rowId] = row.message;
        return lookup;
      }, {}),
    [prepared.invalidRows]
  );
  const unresolvedHouseRows = prepared.scan.unassignedHouse.length;
  const confirmDisabled =
    totalRows === 0 || prepared.invalidRows.length > 0 || unresolvedHouseRows > 0;

  const handleRowChange = (rowId, field, value) => {
    setReviewDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...row,
          [field]: value,
        };
      }),
    }));
  };

  const handleDeleteRow = (rowId) => {
    setReviewDraft((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.id !== rowId),
    }));
  };

  const handleAddRow = (section) => {
    setReviewDraft((current) => ({
      ...current,
      rows: [
        ...current.rows,
        {
          id: `${section}-manual-${Date.now()}-${current.rows.length}`,
          section,
          value: "",
          qty: "",
          reason: section === "unassignedHouse" ? "manual review required" : "",
        },
      ],
    }));
  };

  return (
    <section className="seller-entry-panel seller-entry-scan-review">
      <div className="seller-entry-scan-review-head">
        <div>
          <span>Review Scan</span>
          <strong>Fix and assign rows before loading the ticket</strong>
          <small>
            Confidence: <strong>{prepared.scan.confidence}</strong>
          </small>
        </div>

        <div className="seller-entry-scan-file">
          <span>Rows Found</span>
          <strong>{totalRows}</strong>
        </div>
      </div>

      {hasExistingRows ? (
        <div className="seller-entry-scan-warning">
          Applying this scan will replace the current unsaved ticket rows.
        </div>
      ) : null}

      {unresolvedHouseRows > 0 ? (
        <div className="seller-entry-scan-warning seller-entry-scan-warning-neutral">
          Resolve or delete all Unassigned House rows before applying to the live ticket.
        </div>
      ) : null}

      {prepared.invalidRows.length > 0 ? (
        <div className="seller-entry-scan-warning seller-entry-scan-warning-danger">
          Fix the highlighted rows before applying the scan.
        </div>
      ) : null}

      <div className="seller-entry-scan-review-grid seller-entry-scan-review-grid-editable">
        {SECTION_ORDER.map((section) => (
          <ScanReviewSection
            key={section}
            invalidById={invalidById}
            onAddRow={handleAddRow}
            onDeleteRow={handleDeleteRow}
            onRowChange={handleRowChange}
            rows={reviewDraft.rows.filter((row) => row.section === section)}
            section={section}
          />
        ))}
      </div>

      {prepared.scan.notes.length > 0 ? (
        <div className="seller-entry-scan-notes">
          <span>Notes</span>
          <ul>
            {prepared.scan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewDraft.rawLines.length > 0 ? (
        <details className="seller-entry-scan-raw-lines">
          <summary>Raw detected lines ({reviewDraft.rawLines.length})</summary>
          <div className="seller-entry-scan-raw-list">
            {reviewDraft.rawLines.map((line) => (
              <div key={line} className="seller-entry-scan-raw-row">
                {line}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="seller-entry-scan-review-actions">
        <button type="button" className="outline-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(prepared.scan)}
          disabled={confirmDisabled}
        >
          Apply To Ticket
        </button>
      </div>
    </section>
  );
}
