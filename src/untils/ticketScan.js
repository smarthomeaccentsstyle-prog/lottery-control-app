import {
  buildFastJuriText,
  normalizeSingleDraft,
  sanitizeFastDigits,
} from "./fastEntry.js";

export const SCAN_SECTION_LABELS = {
  thirdHouse: "3rd House",
  fourthHouse: "4th House",
  unassignedHouse: "Unassigned House",
  juri: "Juri",
};

const REVIEW_SECTION_ORDER = ["thirdHouse", "fourthHouse", "unassignedHouse", "juri"];

export function normalizeScanResponse(scan = {}) {
  const notes = normalizeStringList(scan.notes);
  const houseCandidates = normalizeHouseCandidates(scan.houseCandidates);
  const juriCandidates = normalizeJuriCandidates(scan.juriCandidates);
  let thirdHouse = normalizeHouseSection(scan.thirdHouse);
  let fourthHouse = normalizeHouseSection(scan.fourthHouse);
  let unassignedHouse = normalizeUnassignedHouse(scan.unassignedHouse);
  let juri = normalizeJuriSection(scan.juri);

  if (thirdHouse.length === 0 && fourthHouse.length === 0 && unassignedHouse.length === 0 && houseCandidates.length > 0) {
    const derived = deriveHouseSectionsFromCandidates(houseCandidates);
    thirdHouse = derived.thirdHouse;
    fourthHouse = derived.fourthHouse;
    unassignedHouse = derived.unassignedHouse;
  }

  if (juri.length === 0 && juriCandidates.length > 0) {
    juri = normalizeJuriSection(
      juriCandidates.map((item) => ({
        number: item.number,
        qty: item.qty,
      }))
    );
  }

  return {
    houseCandidates:
      houseCandidates.length > 0
        ? houseCandidates
        : buildHouseCandidatesFromSections(thirdHouse, fourthHouse, unassignedHouse),
    juriCandidates:
      juriCandidates.length > 0 ? juriCandidates : buildJuriCandidatesFromSection(juri),
    thirdHouse,
    fourthHouse,
    unassignedHouse,
    juri,
    rawLines: normalizeRawLines(scan.rawLines, thirdHouse, fourthHouse, unassignedHouse, juri),
    notes,
    confidence: normalizeConfidence(scan.confidence),
  };
}

export function mapScanResultToDraft(scan = {}) {
  const normalizedScan = normalizeScanResponse(scan);
  const third = normalizeSingleDraft([]);
  const fourth = normalizeSingleDraft([]);
  const juriLookup = new Map();
  const juriOrder = [];

  normalizedScan.thirdHouse.forEach((row) => {
    const index = Number(row.digit);
    third[index] = String(Number(third[index] || 0) + row.qty);
  });

  normalizedScan.fourthHouse.forEach((row) => {
    const index = Number(row.digit);
    fourth[index] = String(Number(fourth[index] || 0) + row.qty);
  });

  normalizedScan.juri.forEach((row) => {
    if (!juriLookup.has(row.number)) {
      juriLookup.set(row.number, row.qty);
      juriOrder.push(row.number);
      return;
    }

    juriLookup.set(row.number, juriLookup.get(row.number) + row.qty);
  });

  return {
    third,
    fourth,
    juriText: buildFastJuriText(
      juriOrder.map((number) => ({
        num: number,
        qty: juriLookup.get(number),
      }))
    ),
  };
}

export function createScanReviewDraft(scan = {}) {
  const normalizedScan = normalizeScanResponse(scan);
  let rowIndex = 0;

  const rows = REVIEW_SECTION_ORDER.flatMap((section) => {
    const sectionRows = normalizedScan[section] || [];

    return sectionRows.map((row) => {
      rowIndex += 1;
      return {
        id: `${section}-${rowIndex}-${row.number || row.digit || "new"}`,
        section,
        value: section === "juri" ? row.number : row.digit,
        qty: String(row.qty || ""),
        reason: section === "unassignedHouse" ? String(row.reason || "") : "",
      };
    });
  });

  return {
    rows,
    notes: normalizedScan.notes,
    rawLines: normalizedScan.rawLines,
    confidence: normalizedScan.confidence,
  };
}

export function buildScanFromReviewDraft(reviewDraft = {}) {
  const rows = Array.isArray(reviewDraft.rows) ? reviewDraft.rows : [];
  const invalidRows = [];
  const thirdHouse = [];
  const fourthHouse = [];
  const unassignedHouse = [];
  const juri = [];

  rows.forEach((row, index) => {
    const section = normalizeSection(row && row.section);
    const qty = normalizeQty(row && row.qty);
    const rowId = String((row && row.id) || `row-${index}`);

    if (!qty) {
      invalidRows.push({
        rowId,
        message: "Quantity must be a positive integer.",
      });
      return;
    }

    if (section === "juri") {
      const number = normalizeJuriNumber(row && row.value);

      if (!number) {
        invalidRows.push({
          rowId,
          message: "Juri number must be exactly two digits.",
        });
        return;
      }

      juri.push({
        number,
        qty,
      });
      return;
    }

    const digit = normalizeDigit(row && row.value);

    if (!digit) {
      invalidRows.push({
        rowId,
        message: "House digit must be 0 to 9.",
      });
      return;
    }

    if (section === "thirdHouse") {
      thirdHouse.push({
        digit,
        qty,
      });
      return;
    }

    if (section === "fourthHouse") {
      fourthHouse.push({
        digit,
        qty,
      });
      return;
    }

    unassignedHouse.push({
      digit,
      qty,
      reason: String((row && row.reason) || "").trim() || "house row found but side/section unclear",
    });
  });

  const scan = normalizeScanResponse({
    thirdHouse,
    fourthHouse,
    unassignedHouse,
    juri,
    rawLines: reviewDraft.rawLines,
    notes: [
      ...normalizeStringList(reviewDraft.notes),
      ...invalidRows.map((item) => item.message),
    ],
    confidence: reviewDraft.confidence,
  });

  return {
    scan,
    invalidRows,
  };
}

export function getScannedRowCount(scan = {}) {
  const normalizedScan = normalizeScanResponse(scan);

  return (
    normalizedScan.thirdHouse.length +
    normalizedScan.fourthHouse.length +
    normalizedScan.unassignedHouse.length +
    normalizedScan.juri.length
  );
}

export function canAutoApplyScan(scan = {}) {
  const normalizedScan = normalizeScanResponse(scan);

  return (
    getScannedRowCount(normalizedScan) > 0 &&
    normalizedScan.unassignedHouse.length === 0
  );
}

export function getFirstScannedMode(scan = {}) {
  const normalizedScan = normalizeScanResponse(scan);

  if (normalizedScan.thirdHouse.length > 0) {
    return "third";
  }

  if (normalizedScan.fourthHouse.length > 0) {
    return "fourth";
  }

  if (normalizedScan.juri.length > 0) {
    return "juri";
  }

  return "third";
}

export function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Choose an image before scanning."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.onerror = () => {
      reject(new Error("Unable to read the selected image."));
    };
    reader.readAsDataURL(file);
  });
}

function normalizeHouseSection(rows) {
  const merged = new Map();
  const order = [];
  const seenExactRows = new Set();

  safeArray(rows).forEach((row) => {
    const digit = normalizeDigit(row && row.digit);
    const qty = normalizeQty(row && row.qty);

    if (!digit || qty <= 0) {
      return;
    }

    const exactRowKey = `${digit}|${qty}`;

    if (seenExactRows.has(exactRowKey)) {
      return;
    }

    seenExactRows.add(exactRowKey);

    if (!merged.has(digit)) {
      merged.set(digit, qty);
      order.push(digit);
      return;
    }

    merged.set(digit, merged.get(digit) + qty);
  });

  return order.map((digit) => ({
    digit,
    qty: merged.get(digit),
  }));
}

function normalizeUnassignedHouse(rows) {
  const merged = new Map();
  const order = [];
  const seenExactRows = new Set();

  safeArray(rows).forEach((row) => {
    const digit = normalizeDigit(row && row.digit);
    const qty = normalizeQty(row && row.qty);
    const reason = String(row && row.reason ? row.reason : "").trim();

    if (!digit || qty <= 0) {
      return;
    }

    const normalizedReason = reason || "house row found but side/section unclear";
    const exactRowKey = `${digit}|${qty}|${normalizedReason}`;

    if (seenExactRows.has(exactRowKey)) {
      return;
    }

    seenExactRows.add(exactRowKey);

    if (!merged.has(digit)) {
      merged.set(digit, {
        qty,
        reason: normalizedReason,
      });
      order.push(digit);
      return;
    }

    const current = merged.get(digit);
    merged.set(digit, {
      qty: current.qty + qty,
      reason: current.reason || reason || "house row found but side/section unclear",
    });
  });

  return order.map((digit) => ({
    digit,
    qty: merged.get(digit).qty,
    reason: merged.get(digit).reason,
  }));
}

function normalizeJuriSection(rows) {
  const merged = new Map();
  const order = [];
  const seenExactRows = new Set();

  safeArray(rows).forEach((row) => {
    const number = normalizeJuriNumber(row && row.number);
    const qty = normalizeQty(row && row.qty);

    if (!number || qty <= 0) {
      return;
    }

    const exactRowKey = `${number}|${qty}`;

    if (seenExactRows.has(exactRowKey)) {
      return;
    }

    seenExactRows.add(exactRowKey);

    if (!merged.has(number)) {
      merged.set(number, qty);
      order.push(number);
      return;
    }

    merged.set(number, merged.get(number) + qty);
  });

  return order.map((number) => ({
    number,
    qty: merged.get(number),
  }));
}

function normalizeHouseCandidates(rows) {
  const seen = new Set();

  return safeArray(rows)
    .map((row) => {
      const digit = normalizeDigit(row && row.digit);
      const qty = normalizeQty(row && row.qty);

      if (!digit || qty <= 0) {
        return null;
      }

      return {
        digit,
        qty,
        sideHint: normalizeSideHint(row && row.sideHint),
        confidence: normalizeConfidence(row && row.confidence),
        sourceText: String(row && row.sourceText ? row.sourceText : "").trim(),
        clusterLabel: String(row && row.clusterLabel ? row.clusterLabel : "").trim(),
      };
    })
    .filter(Boolean)
    .filter((row) => {
      const dedupeKey = `${row.digit}|${row.qty}|${row.sideHint}|${row.clusterLabel}`;

      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    });
}

function normalizeJuriCandidates(rows) {
  const seen = new Set();

  return safeArray(rows)
    .map((row) => {
      const number = normalizeJuriNumber(row && row.number);
      const qty = normalizeQty(row && row.qty);

      if (!number || qty <= 0) {
        return null;
      }

      return {
        number,
        qty,
        confidence: normalizeConfidence(row && row.confidence),
        sourceText: String(row && row.sourceText ? row.sourceText : "").trim(),
        clusterLabel: String(row && row.clusterLabel ? row.clusterLabel : "").trim(),
        sideHint: normalizeSideHint(row && row.sideHint),
      };
    })
    .filter(Boolean)
    .filter((row) => {
      const dedupeKey = `${row.number}|${row.qty}|${row.clusterLabel}|${row.sideHint}`;

      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    });
}

function deriveHouseSectionsFromCandidates(houseCandidates) {
  return {
    thirdHouse: normalizeHouseSection(
      houseCandidates
        .filter((item) => item.sideHint === "left")
        .map((item) => ({ digit: item.digit, qty: item.qty }))
    ),
    fourthHouse: normalizeHouseSection(
      houseCandidates
        .filter((item) => item.sideHint === "right")
        .map((item) => ({ digit: item.digit, qty: item.qty }))
    ),
    unassignedHouse: normalizeUnassignedHouse(
      houseCandidates
        .filter((item) => item.sideHint !== "left" && item.sideHint !== "right")
        .map((item) => ({
          digit: item.digit,
          qty: item.qty,
          reason:
            item.sideHint === "center"
              ? "house row found in a center or mixed cluster"
              : "house row found but side/section unclear",
        }))
    ),
  };
}

function buildHouseCandidatesFromSections(thirdHouse, fourthHouse, unassignedHouse) {
  return [
    ...safeArray(thirdHouse).map((row) => ({
      digit: row.digit,
      qty: row.qty,
      sideHint: "left",
      confidence: "medium",
      sourceText: `${row.digit}-${row.qty}`,
      clusterLabel: "thirdHouse",
    })),
    ...safeArray(fourthHouse).map((row) => ({
      digit: row.digit,
      qty: row.qty,
      sideHint: "right",
      confidence: "medium",
      sourceText: `${row.digit}-${row.qty}`,
      clusterLabel: "fourthHouse",
    })),
    ...safeArray(unassignedHouse).map((row) => ({
      digit: row.digit,
      qty: row.qty,
      sideHint: "unknown",
      confidence: "low",
      sourceText: `${row.digit}-${row.qty}`,
      clusterLabel: "unassignedHouse",
    })),
  ];
}

function buildJuriCandidatesFromSection(juri) {
  return safeArray(juri).map((row) => ({
    number: row.number,
    qty: row.qty,
    confidence: "medium",
    sourceText: `${row.number}-${row.qty}`,
    clusterLabel: "juri",
    sideHint: "unknown",
  }));
}

function normalizeRawLines(rawLines, thirdHouse, fourthHouse, unassignedHouse, juri) {
  const explicitRawLines = normalizeStringList(rawLines);

  if (explicitRawLines.length > 0) {
    return explicitRawLines;
  }

  return [
    ...safeArray(thirdHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(fourthHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(unassignedHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(juri).map((row) => `${row.number}-${row.qty}`),
  ];
}

function normalizeDigit(value) {
  const digit = sanitizeFastDigits(value, 1);
  return digit !== "" && Number(digit) <= 9 ? digit : "";
}

function normalizeJuriNumber(value) {
  const digits = sanitizeFastDigits(value, 2);

  if (digits.length === 0) {
    return "";
  }

  const number = digits.padStart(2, "0");
  return /^\d{2}$/.test(number) ? number : "";
}

function normalizeQty(value) {
  const numericValue =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value === undefined ? "" : value), 10);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  const qty = Math.trunc(numericValue);
  return qty > 0 ? qty : 0;
}

function normalizeConfidence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(normalized) ? normalized : "medium";
}

function normalizeSideHint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["left", "right", "center", "unknown"].includes(normalized) ? normalized : "unknown";
}

function normalizeStringList(values) {
  return safeArray(values)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizeSection(value) {
  return REVIEW_SECTION_ORDER.includes(value) ? value : "thirdHouse";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
