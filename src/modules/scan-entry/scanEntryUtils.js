const SCAN_SECTION_ORDER = ["third", "fourth", "juri"];

const SCAN_SECTION_META = {
  third: {
    key: "third",
    label: "3RD HOUSE",
    minNumber: 0,
    maxNumber: 9,
  },
  fourth: {
    key: "fourth",
    label: "4TH HOUSE",
    minNumber: 0,
    maxNumber: 9,
  },
  juri: {
    key: "juri",
    label: "JURI",
    minNumber: 1,
    maxNumber: 99,
  },
};

function createEmptySections() {
  return SCAN_SECTION_ORDER.reduce((accumulator, sectionKey) => {
    accumulator[sectionKey] = [];
    return accumulator;
  }, {});
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/[^A-Z0-9 ]/g, "");
}

function detectSectionFromLine(value) {
  const normalized = normalizeHeader(value);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("JURI")) {
    return "juri";
  }

  if (normalized.includes("3RD") || normalized.includes("3RO") || normalized.includes("3 R D")) {
    return "third";
  }

  if (normalized.includes("4TH") || normalized.includes("4T H")) {
    return "fourth";
  }

  return null;
}

function stripHeaderPrefix(value, sectionKey) {
  if (!sectionKey) {
    return normalizeWhitespace(value);
  }

  const patterns = {
    third: [/3\s*R[D0]\s*HOUSE/i, /3\s*R[D0]/i],
    fourth: [/4\s*T\s*H\s*HOUSE/i, /4\s*T\s*H/i],
    juri: [/JURI/i],
  };

  return patterns[sectionKey].reduce(
    (currentValue, pattern) => currentValue.replace(pattern, " "),
    normalizeWhitespace(value)
  ).trim();
}

function normalizeDigitCandidates(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[OQ]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/[S]/g, "5")
    .replace(/[B]/g, "8");
}

function normalizeSeparatorCandidates(value) {
  return String(value || "")
    .replace(/[–—−_:;=]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeQuantity(value) {
  return String(value || "")
    .replace(/[^\d]/g, "")
    .slice(0, 3)
    .replace(/^0+(?=\d)/, "");
}

function leftPad(value, targetLength, fillCharacter) {
  let output = String(value || "");

  while (output.length < targetLength) {
    output = `${fillCharacter}${output}`;
  }

  return output;
}

function validateScanRow(sectionKey, number, quantity) {
  const sectionMeta = SCAN_SECTION_META[sectionKey];

  if (!sectionMeta) {
    return {
      ok: false,
      message: "Unknown section",
    };
  }

  if (!/^\d{2}$/.test(number)) {
    return {
      ok: false,
      message: "Use a 2 digit number",
    };
  }

  const numericNumber = Number(number);

  if (numericNumber < sectionMeta.minNumber || numericNumber > sectionMeta.maxNumber) {
    return {
      ok: false,
      message:
        sectionKey === "juri"
          ? "Juri number must stay between 01 and 99"
          : "House number must stay between 00 and 09",
    };
  }

  if (!/^\d{1,3}$/.test(String(quantity || "")) || Number(quantity) <= 0) {
    return {
      ok: false,
      message: "Quantity must be between 1 and 999",
    };
  }

  return {
    ok: true,
    message: "",
  };
}

function createRowId(sectionKey, rowIndex) {
  return `${sectionKey}-${rowIndex}-${Date.now()}`;
}

function buildOriginalPreview(originalText, normalizedText) {
  const normalizedOriginal = normalizeSeparatorCandidates(normalizeDigitCandidates(originalText));

  if (!normalizedOriginal || normalizedOriginal === normalizedText) {
    return "";
  }

  return `${normalizedOriginal} -> ${normalizedText} ?`;
}

function buildReviewRow(sectionKey, fragment, fallbackConfidence, rowIndex) {
  const cleanedFragment = normalizeWhitespace(fragment);
  const repairedDigits = normalizeDigitCandidates(cleanedFragment);
  const normalizedFragment = normalizeSeparatorCandidates(repairedDigits);
  const strictMatch = normalizedFragment.match(/^(\d{1,2})-(\d{1,3})$/);
  const relaxedMatch =
    strictMatch || normalizedFragment.match(/(\d{1,2})\s*[- ]\s*(\d{1,3})/);
  const digitGroups = normalizedFragment.match(/\d+/g) || [];
  const numberCandidate = relaxedMatch ? relaxedMatch[1] : digitGroups[0] || "";
  const quantityCandidate = relaxedMatch ? relaxedMatch[2] : digitGroups[1] || "";
  const number = numberCandidate ? leftPad(numberCandidate.slice(-2), 2, "0") : "";
  const quantity = normalizeQuantity(quantityCandidate);
  const normalizedText =
    number && quantity ? `${number}-${quantity}` : normalizeWhitespace(normalizedFragment);
  const validation = validateScanRow(sectionKey, number, quantity);
  const repaired = repairedDigits !== cleanedFragment;
  const normalizedBySeparator = normalizedFragment !== cleanedFragment;
  const confidence = Number.isFinite(Number(fallbackConfidence))
    ? Math.max(0, Math.min(100, Number(fallbackConfidence)))
    : 0;
  const needsReview =
    !validation.ok ||
    !strictMatch ||
    repaired ||
    normalizedBySeparator ||
    confidence < 78;

  return {
    id: createRowId(sectionKey, rowIndex),
    section: sectionKey,
    number,
    quantity,
    normalizedText,
    originalText: cleanedFragment,
    originalPreview: buildOriginalPreview(cleanedFragment, normalizedText),
    confidence,
    tone: needsReview ? "low" : "high",
    isValid: validation.ok,
    issue:
      !validation.ok
        ? validation.message
        : confidence < 78
          ? "Low OCR confidence"
          : repaired || normalizedBySeparator
            ? "OCR normalization applied"
            : "",
    edited: false,
  };
}

function extractFragmentsFromLine(lineText) {
  const cleanedLine = normalizeWhitespace(lineText);

  if (!cleanedLine) {
    return [];
  }

  const matchingFragments = cleanedLine.match(/\d{1,2}\s*[-–—−_:;= ]\s*\d{1,3}/g);

  if (Array.isArray(matchingFragments) && matchingFragments.length > 0) {
    return matchingFragments;
  }

  if (!/\d/.test(cleanedLine)) {
    return [];
  }

  return cleanedLine
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function createEmptyReviewState() {
  return {
    sections: createEmptySections(),
    ignoredLines: [],
    ocrText: "",
  };
}

export function buildScanReviewFromLines(sourceLines = [], ocrText = "") {
  const nextSections = createEmptySections();
  const ignoredLines = [];
  let currentSection = null;
  let rowIndex = 0;

  sourceLines.forEach((line, index) => {
    const lineText = normalizeWhitespace(line && line.text ? line.text : "");

    if (!lineText) {
      return;
    }

    const detectedSection = detectSectionFromLine(lineText);

    if (detectedSection) {
      currentSection = detectedSection;
    }

    const effectiveSection = detectedSection || currentSection;
    const contentText = stripHeaderPrefix(lineText, detectedSection);
    const fragments = extractFragmentsFromLine(contentText);

    if (!effectiveSection) {
      if (fragments.length > 0) {
        ignoredLines.push({
          id: `ignored-${index}`,
          text: lineText,
          confidence: Number(line && line.confidence ? line.confidence : 0),
          reason: "Section header not found",
        });
      }
      return;
    }

    if (fragments.length === 0) {
      if (/\d/.test(contentText)) {
        ignoredLines.push({
          id: `ignored-${effectiveSection}-${index}`,
          text: lineText,
          confidence: Number(line && line.confidence ? line.confidence : 0),
          reason: "Ticket row format not recognized",
        });
      }
      return;
    }

    fragments.forEach((fragment) => {
      nextSections[effectiveSection].push(
        buildReviewRow(
          effectiveSection,
          fragment,
          line && line.confidence ? line.confidence : 0,
          rowIndex
        )
      );
      rowIndex += 1;
    });
  });

  return {
    sections: nextSections,
    ignoredLines,
    ocrText: String(ocrText || ""),
  };
}

export function getReviewStats(reviewState) {
  const rows = getFlattenedRows(reviewState);
  const issueRows = rows.filter((row) => !row.isValid || row.tone === "low");
  const safeRows = rows.filter((row) => row.isValid && row.tone !== "low");

  return {
    totalRows: rows.length,
    issueCount: issueRows.length + Number(reviewState && reviewState.ignoredLines ? reviewState.ignoredLines.length : 0),
    lowConfidenceCount: rows.filter((row) => row.tone === "low").length,
    safeCount: safeRows.length,
    ignoredCount: Array.isArray(reviewState && reviewState.ignoredLines)
      ? reviewState.ignoredLines.length
      : 0,
  };
}

export function getFlattenedRows(reviewState) {
  return SCAN_SECTION_ORDER.flatMap((sectionKey) =>
    Array.isArray(reviewState && reviewState.sections && reviewState.sections[sectionKey])
      ? reviewState.sections[sectionKey]
      : []
  );
}

export function findFirstIssueRow(reviewState) {
  return getFlattenedRows(reviewState).find((row) => !row.isValid || row.tone === "low") || null;
}

export function updateReviewRow(reviewState, rowId, updates) {
  const nextState = {
    ...reviewState,
    sections: {
      ...(reviewState && reviewState.sections ? reviewState.sections : createEmptySections()),
    },
  };

  SCAN_SECTION_ORDER.forEach((sectionKey) => {
    nextState.sections[sectionKey] = (nextState.sections[sectionKey] || []).map((row) => {
      if (row.id !== rowId) {
        return row;
      }

      const number = leftPad(String(updates.number || "").replace(/[^\d]/g, "").slice(-2), 2, "0");
      const quantity = normalizeQuantity(updates.quantity);
      const validation = validateScanRow(sectionKey, number, quantity);

      return {
        ...row,
        number,
        quantity,
        normalizedText: number && quantity ? `${number}-${quantity}` : row.normalizedText,
        originalPreview: row.originalPreview,
        tone: validation.ok ? "corrected" : "low",
        isValid: validation.ok,
        issue: validation.ok ? "" : validation.message,
        edited: true,
      };
    }).filter((row) => Number(row.quantity || 0) > 0);
  });

  return nextState;
}

function accumulateQuantity(map, number, quantity) {
  const currentValue = Number(map[number] || 0);
  const nextValue = currentValue + Number(quantity || 0);
  map[number] = String(nextValue);
}

export function buildManualEntryDraft(reviewState, options = {}) {
  const { safeOnly = false } = options;
  const third = Array(10).fill("");
  const fourth = Array(10).fill("");
  const juriMap = {};
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

    accumulateQuantity(juriMap, row.number, row.quantity);
  });

  return {
    third,
    fourth,
    juriText: Object.keys(juriMap)
      .sort((left, right) => Number(left) - Number(right))
      .map((number) => `${number}-${juriMap[number]}`)
      .join(", "),
    appliedRows,
    skippedRows,
  };
}

export function getSectionMeta(sectionKey) {
  return SCAN_SECTION_META[sectionKey];
}

export function getSectionOrder() {
  return SCAN_SECTION_ORDER;
}

