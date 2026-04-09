import React, { useRef } from "react";

export default function TicketScanPanel({
  busy,
  fileName,
  panelRef,
  scanStatus,
  onSelectFile,
}) {
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const scanUnavailable = Boolean(scanStatus && scanStatus.available === false);
  const disableActions = busy || scanUnavailable;

  const handleFileChange = (event) => {
    const [file] = Array.from(event.target.files || []);

    if (file) {
      onSelectFile(file);
    }

    event.target.value = "";
  };

  return (
    <section ref={panelRef} className="seller-entry-panel seller-entry-scan-panel">
      <div className="seller-entry-scan-head">
        <div>
          <span>Scan Entry</span>
          <strong>Capture or upload handwritten ticket rows</strong>
          <small>Supports messy seller photos. Review, edit, and assign rows before anything reaches the live ticket.</small>
        </div>

        {fileName ? (
          <div className="seller-entry-scan-file">
            <span>Latest Image</span>
            <strong>{fileName}</strong>
          </div>
        ) : null}
      </div>

      <div className="seller-entry-scan-actions">
        <button
          type="button"
          className="seller-entry-scan-btn"
          onClick={() => cameraInputRef.current && cameraInputRef.current.click()}
          disabled={disableActions}
        >
          {busy ? "Scanning..." : "Camera Capture"}
        </button>

        <button
          type="button"
          className="seller-entry-scan-btn seller-entry-scan-btn-secondary"
          onClick={() => uploadInputRef.current && uploadInputRef.current.click()}
          disabled={disableActions}
        >
          Gallery Upload
        </button>
      </div>

      <small className="seller-entry-scan-note">
        Works with clustered handwriting, rough paper, loose notes, and rotated phone images.
      </small>

      {scanUnavailable ? (
        <div className="seller-entry-scan-status seller-entry-scan-status-warning">
          {scanStatus.message || "Ticket scan is not configured on the server."}
        </div>
      ) : null}

      {busy ? (
        <div className="seller-entry-scan-status">
          Scanning selected image. Please wait and keep this page open.
        </div>
      ) : null}

      <input
        ref={cameraInputRef}
        className="seller-entry-hidden-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />
      <input
        ref={uploadInputRef}
        className="seller-entry-hidden-input"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
    </section>
  );
}
