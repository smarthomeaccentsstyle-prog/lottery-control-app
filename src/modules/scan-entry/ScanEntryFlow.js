import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./ScanEntry.css";
import {
  buildManualEntryDraft,
  buildScanReviewFromLines,
  createEmptyReviewState,
  findFirstIssueRow,
  getReviewStats,
  getSectionMeta,
  getSectionOrder,
  updateReviewRow,
} from "./scanEntryUtils.js";
import {
  captureVideoFrame,
  createPreviewDataUrl,
  enhanceCanvasForOcr,
  loadFileToCanvas,
  recognizeTicketImage,
  startRearCamera,
  stopMediaStream,
} from "./scanEntryOcr.js";

function emptyEditorState() {
  return {
    rowId: "",
    section: "",
    number: "",
    quantity: "",
  };
}

export default function ScanEntryFlow({
  isOpen,
  bookingDate,
  drawLabel,
  onApply,
  onClose,
}) {
  const [phase, setPhase] = useState("camera");
  const [reviewState, setReviewState] = useState(() => createEmptyReviewState());
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState("Opening camera...");
  const [scanError, setScanError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [editorState, setEditorState] = useState(() => emptyEditorState());
  const [cameraMessage, setCameraMessage] = useState("Point the camera at one handwritten ticket.");
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const quantityInputRef = useRef(null);

  const stats = useMemo(() => getReviewStats(reviewState), [reviewState]);
  const hasBlockingIssues = stats.issueCount > 0;
  const hasSafeRows = stats.safeCount > 0;

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return undefined;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setPhase("camera");
      setReviewState(createEmptyReviewState());
      setProcessingProgress(0);
      setProcessingLabel("Opening camera...");
      setScanError("");
      setPreviewUrl("");
      setEditorState(emptyEditorState());
      setCameraMessage("Point the camera at one handwritten ticket.");
      return undefined;
    }

    if (phase !== "camera" || !videoRef.current) {
      return undefined;
    }

    let active = true;

    const bootCamera = async () => {
      try {
        setScanError("");
        setPreviewUrl("");
        setCameraMessage("Opening rear camera...");
        stopMediaStream(streamRef.current);
        streamRef.current = await startRearCamera(videoRef.current);

        if (!active) {
          stopMediaStream(streamRef.current);
          streamRef.current = null;
          return;
        }

        setCameraMessage("Hold steady and capture the ticket inside the frame.");
      } catch (error) {
        if (active) {
          setScanError(error && error.message ? error.message : "Camera access failed");
          setCameraMessage("You can still upload a ticket photo.");
        }
      }
    };

    bootCamera();

    return () => {
      active = false;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    };
  }, [isOpen, phase]);

  useEffect(() => {
    if (!editorState.rowId || !quantityInputRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const input = quantityInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    }, 30);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editorState.rowId]);

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const closeEditor = () => {
    setEditorState(emptyEditorState());
  };

  const runOcr = async (rawCanvas) => {
    const enhancedCanvas = enhanceCanvasForOcr(rawCanvas);

    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setPhase("processing");
    setProcessingProgress(0.08);
    setProcessingLabel("Reading ticket...");
    setScanError("");
    setPreviewUrl(createPreviewDataUrl(rawCanvas));

    try {
      const result = await recognizeTicketImage(enhancedCanvas, {
        onProgress: (message) => {
          if (!message || typeof message.progress !== "number") {
            return;
          }

          setProcessingProgress(Math.max(0.08, Math.min(0.98, message.progress)));
          setProcessingLabel(
            message.status === "recognizing text"
              ? "Reading handwritten rows..."
              : "Preparing OCR..."
          );
        },
      });

      const nextReview = buildScanReviewFromLines(result.lines, result.text);
      const nextStats = getReviewStats(nextReview);

      if (nextStats.totalRows === 0 && nextStats.ignoredCount === 0) {
        throw new Error("No ticket rows were detected. Retake with better light or upload a clearer photo.");
      }

      setReviewState(nextReview);
      setProcessingProgress(1);
      setProcessingLabel("Review ready");
      setPhase("review");
    } catch (error) {
      setScanError(error && error.message ? error.message : "Scan failed");
      setPhase("camera");
      setProcessingProgress(0);
      setProcessingLabel("Opening camera...");
    }
  };

  const handleCapture = async () => {
    try {
      const canvas = captureVideoFrame(videoRef.current);
      await runOcr(canvas);
    } catch (error) {
      setScanError(error && error.message ? error.message : "Camera capture failed");
    }
  };

  const handleFileChange = async (event) => {
    const nextFile = event.target.files && event.target.files[0];

    if (!nextFile) {
      return;
    }

    try {
      const canvas = await loadFileToCanvas(nextFile);
      await runOcr(canvas);
    } catch (error) {
      setScanError(error && error.message ? error.message : "Ticket photo could not be read");
      setPhase("camera");
    } finally {
      event.target.value = "";
    }
  };

  const openEditor = (row) => {
    setEditorState({
      rowId: row.id,
      section: row.section,
      number: row.number,
      quantity: row.quantity,
    });
  };

  const saveEditor = () => {
    if (!editorState.rowId) {
      return;
    }

    setReviewState((current) =>
      updateReviewRow(current, editorState.rowId, {
        number: editorState.number,
        quantity: editorState.quantity,
      })
    );
    closeEditor();
  };

  const openFirstIssue = () => {
    const row = findFirstIssueRow(reviewState);

    if (row) {
      openEditor(row);
    }
  };

  const confirmScan = (safeOnly = false) => {
    const draft = buildManualEntryDraft(reviewState, {
      safeOnly,
    });

    if (draft.appliedRows.length === 0) {
      setScanError("No valid ticket rows are ready to apply.");
      return;
    }

    onApply({
      ...draft,
      safeOnly,
    });
    onClose();
  };

  const modalContent = (
    <div className="scan-entry-overlay" onClick={onClose}>
      <div className="scan-entry-shell" onClick={(event) => event.stopPropagation()}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFileChange}
        />

        {phase === "review" ? (
          <header className="scan-entry-header review-mode">
            <div>
              <span className="scan-entry-kicker">SCAN REVIEW</span>
              <h2>SCAN REVIEW</h2>
              <p>
                Ticket will stay on {bookingDate} | {drawLabel}. Tap any row to correct it before it reaches the existing save flow.
              </p>
            </div>
            <button type="button" className="outline-btn scan-close-btn" onClick={onClose}>
              Close
            </button>
          </header>
        ) : (
          <header className="scan-entry-header">
            <div>
              <span className="scan-entry-kicker">Scan Entry</span>
              <h2>Scan Entry</h2>
              <p>
                {bookingDate} | {drawLabel}. The scan only fills ticket rows. Save still uses the current seller ticket logic after your confirmation.
              </p>
            </div>
            <button type="button" className="outline-btn scan-close-btn" onClick={onClose}>
              Close
            </button>
          </header>
        )}

        {previewUrl ? (
          <div className="scan-preview-strip">
            <img src={previewUrl} alt="Captured ticket preview" />
            <div>
              <strong>{drawLabel}</strong>
              <span>{bookingDate}</span>
            </div>
          </div>
        ) : null}

        {scanError ? <div className="scan-feedback error">{scanError}</div> : null}

        {phase === "camera" ? (
          <div className="scan-camera-stage">
            <div className="scan-camera-frame">
              <video ref={videoRef} playsInline muted autoPlay />
              <div className="scan-camera-guide">
                <div />
              </div>
            </div>

            <div className="scan-camera-copy">
              <strong>3RD HOUSE, 4TH HOUSE and JURI</strong>
              <span>{cameraMessage}</span>
            </div>

            <div className="scan-camera-actions">
              <button type="button" onClick={handleCapture}>
                Capture Ticket
              </button>
              <button type="button" className="outline-btn" onClick={openFilePicker}>
                Upload Photo
              </button>
            </div>
          </div>
        ) : null}

        {phase === "processing" ? (
          <div className="scan-processing-stage">
            <div
              className="scan-processing-ring"
              style={{ "--scan-progress": `${Math.round(processingProgress * 360)}` }}
            >
              <strong>{Math.round(processingProgress * 100)}%</strong>
            </div>
            <div className="scan-processing-copy">
              <strong>{processingLabel}</strong>
              <span>OCR is only preparing draft rows. Nothing is saved until you confirm.</span>
            </div>
          </div>
        ) : null}

        {phase === "review" ? (
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
                {stats.ignoredCount} OCR line(s) were skipped because the format was unclear. Use Fix Now or confirm only the safe rows.
              </div>
            ) : null}

            <div className="scan-review-sections">
              {getSectionOrder().map((sectionKey) => (
                <ScanReviewSection
                  key={sectionKey}
                  sectionKey={sectionKey}
                  rows={reviewState.sections[sectionKey] || []}
                  onEdit={openEditor}
                />
              ))}
            </div>

            <div className="scan-review-actions">
              {!hasBlockingIssues ? (
                <button type="button" className="scan-confirm-btn" onClick={() => confirmScan(false)}>
                  Confirm Scan
                </button>
              ) : (
                <>
                  <button type="button" onClick={openFirstIssue}>
                    Fix Now
                  </button>
                  <button
                    type="button"
                    className="outline-btn"
                    onClick={() => confirmScan(true)}
                    disabled={!hasSafeRows}
                  >
                    Confirm Safe Entries
                  </button>
                </>
              )}

              <button
                type="button"
                className="outline-btn"
                onClick={() => {
                  setPreviewUrl("");
                  setScanError("");
                  setPhase("camera");
                }}
              >
                Retake
              </button>
            </div>
          </>
        ) : null}

        {editorState.rowId ? (
          <div className="scan-edit-overlay" onClick={closeEditor}>
            <div className="scan-edit-sheet" onClick={(event) => event.stopPropagation()}>
              <div className="scan-edit-head">
                <div>
                  <strong>{getSectionMeta(editorState.section).label}</strong>
                  <span>Quantity is auto-focused for quick correction.</span>
                </div>
                <button type="button" className="outline-btn" onClick={closeEditor}>
                  Close
                </button>
              </div>

              <div className="scan-edit-grid">
                <label>
                  <span>Number</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={editorState.number}
                    onChange={(event) =>
                      setEditorState((current) => ({
                        ...current,
                        number: event.target.value.replace(/[^\d]/g, "").slice(-2),
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Quantity</span>
                  <input
                    ref={quantityInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={editorState.quantity}
                    onChange={(event) =>
                      setEditorState((current) => ({
                        ...current,
                        quantity: event.target.value.replace(/[^\d]/g, "").slice(0, 3),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="scan-quick-actions">
                {[
                  { label: "+1", amount: 1 },
                  { label: "+5", amount: 5 },
                  { label: "+10", amount: 10 },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="outline-btn"
                    onClick={() =>
                      setEditorState((current) => ({
                        ...current,
                        quantity: String(Math.min(999, Number(current.quantity || 0) + item.amount)),
                      }))
                    }
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="outline-btn danger-btn"
                  onClick={() =>
                    setEditorState((current) => ({
                      ...current,
                      quantity: "",
                    }))
                  }
                >
                  CLEAR
                </button>
              </div>

              <div className="scan-edit-actions">
                <button type="button" onClick={saveEditor}>
                  Save Fix
                </button>
                <button type="button" className="outline-btn" onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(modalContent, document.body);
}

function ScanReviewSection({ sectionKey, rows, onEdit }) {
  const sectionMeta = getSectionMeta(sectionKey);

  return (
    <section className="scan-review-section">
      <div className="scan-section-head">
        <strong>{sectionMeta.label}</strong>
        <span>{rows.length} row(s)</span>
      </div>

      {rows.length === 0 ? (
        <p className="scan-empty-state">No rows detected.</p>
      ) : (
        <div className="scan-review-row-list">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`scan-review-row ${row.tone === "low" || !row.isValid ? "flagged" : "safe"}`}
              onClick={() => onEdit(row)}
            >
              <div className="scan-review-row-main">
                <span className="scan-review-value">
                  {row.number || "--"} - {row.quantity || "--"}
                </span>
                <span className={`scan-review-status ${row.tone === "low" || !row.isValid ? "warning" : "safe"}`}>
                  {row.tone === "low" || !row.isValid ? "Review" : "Check"}
                </span>
              </div>

              {row.issue || row.originalPreview ? (
                <small>{row.originalPreview || row.issue}</small>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
