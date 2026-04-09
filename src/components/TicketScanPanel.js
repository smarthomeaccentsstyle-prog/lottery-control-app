import React, { useRef } from "react";

export default function TicketScanPanel({
  busy,
  fileName,
  onSelectFile,
}) {
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const handleFileChange = (event) => {
    const [file] = Array.from(event.target.files || []);

    if (file) {
      onSelectFile(file);
    }

    event.target.value = "";
  };

  return (
    <section className="seller-entry-panel seller-entry-scan-panel">
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
          disabled={busy}
        >
          {busy ? "Scanning..." : "Camera Capture"}
        </button>

        <button
          type="button"
          className="seller-entry-scan-btn seller-entry-scan-btn-secondary"
          onClick={() => uploadInputRef.current && uploadInputRef.current.click()}
          disabled={busy}
        >
          Gallery Upload
        </button>
      </div>

      <small className="seller-entry-scan-note">
        Works with clustered handwriting, rough paper, loose notes, and rotated phone images. Review is always required before apply.
      </small>

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
