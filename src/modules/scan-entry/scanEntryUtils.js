import {
  buildScanReviewFromLines,
  buildScanReviewFromScanPayload,
  createEmptyReviewState,
  formatRowValue,
  getSectionMeta,
  getSectionOrder,
  normalizeEditedNumber,
  normalizeEditedQuantity,
  validateEditedRow,
} from "./scanEntryParser.js";

function getFlattenedRows(reviewState) {
  return getSectionOrder().flatMap((sectionKey) =>
    Array.isArray(reviewState && reviewState.sections && reviewState.sections[sectionKey])
      ? reviewState.sections[sectionKey]
      : []
  );
}

function accumulateQuantity(map, number, quantity) {
  const currentValue = Number(map[number] || 0);
  const nextValue = currentValue + Number(quantity || 0);
  map[number] = String(nextValue);
}

function buildParsedDataFromSections(sections = {}) {
  return {
    h3: (sections.third || [])
      .filter((row) => row.isValid)
      .map((row) => ({ number: row.number, qty: row.quantity })),
    h4: (sections.fourth || [])
      .filter((row) => row.isValid)
      .map((row) => ({ number: row.number, qty: row.quantity })),
    juri: (sections.juri || [])
      .filter((row) => row.isValid)
      .map((row) => ({ number: row.number, qty: row.quantity })),
  };
}

export {
  buildScanReviewFromLines,
  buildScanReviewFromScanPayload,
  createEmptyReviewState,
  formatRowValue,
  getSectionMeta,
  getSectionOrder,
  normalizeEditedNumber,
  normalizeEditedQuantity,
  validateEditedRow,
};

export function getReviewStats(reviewState) {
  const rows = getFlattenedRows(reviewState);
  const issueRows = rows.filter((row) => !row.isValid || row.tone === "low");
  const safeRows = rows.filter((row) => row.isValid && row.tone !== "low");

  return {
    totalRows: rows.length,
    issueCount:
      issueRows.length +
      Number(reviewState && reviewState.ignoredLines ? reviewState.ignoredLines.length : 0),
    lowConfidenceCount: rows.filter((row) => row.tone === "low").length,
    safeCount: safeRows.length,
    ignoredCount: Array.isArray(reviewState && reviewState.ignoredLines)
      ? reviewState.ignoredLines.length
      : 0,
  };
}

export function findFirstIssueRow(reviewState) {
  return getFlattenedRows(reviewState).find((row) => !row.isValid || row.tone === "low") || null;
}

export function updateReviewRow(reviewState, rowId, updates) {
  const nextState = {
    ...reviewState,
    sections: {
      ...(reviewState && reviewState.sections ? reviewState.sections : {}),
    },
  };

  getSectionOrder().forEach((sectionKey) => {
    nextState.sections[sectionKey] = (nextState.sections[sectionKey] || [])
      .map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        const number = normalizeEditedNumber(sectionKey, updates.number);
        const quantity = normalizeEditedQuantity(updates.quantity);
        const validation = validateEditedRow(sectionKey, number, quantity);

        return {
          ...row,
          number,
          quantity,
          normalizedText:
            number && quantity ? formatRowValue(sectionKey, number, quantity) : row.normalizedText,
          tone: validation.ok ? "corrected" : "low",
          isValid: validation.ok,
          issue: validation.ok ? "" : validation.message,
          edited: true,
          suggestions: [],
        };
      })
      .filter((row) => Number(row.quantity || 0) > 0);
  });

  return {
    ...nextState,
    parsedData: buildParsedDataFromSections(nextState.sections),
  };
}

export function insertReviewRow(reviewState, sectionKey, updates, options = {}) {
  const number = normalizeEditedNumber(sectionKey, updates.number);
  const quantity = normalizeEditedQuantity(updates.quantity);
  const validation = validateEditedRow(sectionKey, number, quantity);
  const normalizedText = number && quantity ? formatRowValue(sectionKey, number, quantity) : "";
  const originalText = String(options.originalText || "").trim();
  const nextSections = {
    ...(reviewState && reviewState.sections ? reviewState.sections : {}),
  };
  const nextRows = Array.isArray(nextSections[sectionKey]) ? [...nextSections[sectionKey]] : [];

  if (Number(quantity || 0) > 0) {
    nextRows.push({
      id: options.rowId || `${sectionKey}-manual-${Date.now()}`,
      section: sectionKey,
      number,
      quantity,
      normalizedText,
      originalText,
      originalPreview: originalText && originalText !== normalizedText ? `${originalText} -> ${normalizedText}` : originalText,
      confidence: Number(options.confidence || 0),
      tone: validation.ok ? "corrected" : "low",
      isValid: validation.ok,
      issue: validation.ok ? "" : validation.message,
      edited: true,
      suggestions: [],
    });
  }

  nextSections[sectionKey] = nextRows;

  return {
    ...(reviewState || {}),
    sections: nextSections,
    ignoredLines: Array.isArray(reviewState && reviewState.ignoredLines)
      ? reviewState.ignoredLines.filter((line) => line.id !== options.ignoredId)
      : [],
    parsedData: buildParsedDataFromSections(nextSections),
  };
}

export function buildManualEntryDraft(reviewState, options = {}) {
  const { safeOnly = false } = options;
  const third = Array(10).fill("");
  const fourth = Array(10).fill("");
  const juriMap = {};
  const juriOrder = [];
  const appliedRows = [];
  const skippedRows = [];

  getFlattenedRows(reviewState).forEach((row) => {
    const isSafeRow = row.isValid && row.tone !== "low";
    const shouldApply = row.isValid && (!safeOnly || isSafeRow);

    if (!shouldApply) {
      skippedRows.push(row);
      return;
    }

    appliedRows.push(row);

    if (row.section === "third") {
      accumulateQuantity(third, Number(row.number), row.quantity);
      return;
    }

    if (row.section === "fourth") {
      accumulateQuantity(fourth, Number(row.number), row.quantity);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(juriMap, row.number)) {
      juriOrder.push(row.number);
    }

    accumulateQuantity(juriMap, row.number, row.quantity);
  });

  return {
    third,
    fourth,
    juriText: juriOrder.map((number) => `${number}-${juriMap[number]}`).join(", "),
    appliedRows,
    skippedRows,
  };
}
