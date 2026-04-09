import React from "react";

export default function TicketFormat({ layout, compact = false }) {
  if (!layout || (!layout.pairedRows.length && !layout.juriLines.length)) {
    return null;
  }

  return (
    <div className={`ticket-format ${compact ? "compact-ticket-format" : ""}`}>
      <div className="ticket-format-grid">
        <div className="ticket-format-head">3rd</div>
        <div className="ticket-format-head">4th</div>
        {layout.pairedRows.length === 0 ? (
          <>
            <div className="ticket-format-cell empty-ticket-cell">--</div>
            <div className="ticket-format-cell empty-ticket-cell">--</div>
          </>
        ) : (
          layout.pairedRows.map((row, index) => (
            <React.Fragment key={`ticket-row-${index}`}>
              <div className={`ticket-format-cell ${!row.third ? "empty-ticket-cell" : ""}`}>
                {row.third || "--"}
              </div>
              <div className={`ticket-format-cell ${!row.fourth ? "empty-ticket-cell" : ""}`}>
                {row.fourth || "--"}
              </div>
            </React.Fragment>
          ))
        )}
      </div>

      {layout.juriLines.length > 0 ? (
        <div className="ticket-juri-block">
          <div className="ticket-format-head full-width-head">Juri</div>
          {layout.juriLines.map((line) => (
            <div key={line} className="ticket-juri-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {!compact ? (
        <div className="ticket-print-preview">
          <span>Ticket Print Format</span>
          <pre>{layout.printText}</pre>
        </div>
      ) : null}
    </div>
  );
}
