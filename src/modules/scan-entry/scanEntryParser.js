const SCAN_SECTION_ORDER = ["third", "fourth", "juri"];
const LOW_CONFIDENCE_THRESHOLD = 68;
const MAX_QTY_LENGTH = 5;
const DIGIT_CONFUSION_HINTS = [
  {
    digits: ["1", "7"],
    label: "1 / 7",
  },
  {
    digits: ["3", "8"],
    label: "3 / 8",
  },
  {
    digits: ["0", "6"],
    label: "0 / 6",
  },
];

const SCAN_SECTION_META = {
  third: {
    key: "third",
    label: "3RD HOUSE",
    expectedSeparator: "=",
  },
  fourth: {
    key: "fourth",
    label: "4TH HOUSE",
    expectedSeparator: "=",
  },
  juri: {
    key: "juri",
    label: "JURI",
    expectedSeparator: "-",
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
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLineText(value) {
  return normalizeWhitespace(value).replace(/\s+/g, " ").trim();
}

function normalizeHeader(value) {
  return normalizeLineText(value)
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

  if (normalized.includes("4TH") || normalized.includes("4 T H")) {
    return "fourth";
  }

  return null;
}

function stripHeaderPrefix(value, sectionKey) {
  if (!sectionKey) {
    return normalizeLineText(value);
  }

  const patterns = {
    third: [/3\s*R[D0]\s*HOUSE/i, /3\s*R[D0]/i],
    fourth: [/4\s*T\s*H\s*HOUSE/i, /4\s*T\s*H/i],
    juri: [/JURI/i],
  };

  return patterns[sectionKey].reduce(
    (currentValue, pattern) => currentValue.replace(pattern, " "),
    normalizeLineText(value)
  ).trim();
}

function normalizeDigitCandidates(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function normalizeQuantity(value) {
  return String(value || "").replace(/[^\d]/g, "").slice(0, MAX_QTY_LENGTH);
}

function normalizeHouseNumber(value) {
  const digits = String(value || "").replace(/[^\d]/g, "").slice(-2);

  if (!digits) {
    return "";
  }

  if (digits.length === 1) {
    return digits;
  }

  if (/^0\d$/.test(digits)) {
    return digits[1];
  }

  if (/^00$/.test(digits)) {
    return "0";
  }

  return digits;
}

function normalizeJuriNumber(value) {
  return String(value || "").replace(/[^\d]/g, "").slice(-2);
}

function isPositiveQuantity(value) {
  return /^\d+$/.test(String(value || "")) && Number(value) > 0;
}

function buildRowId(sectionKey, rowIndex) {
  return `${sectionKey}-${rowIndex}`;
}

function splitJuriLineIntoFragments(lineText) {
  const cleaned = normalizeLineText(lineText);

  if (!cleaned) {
    return [];
  }

  const rawTokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const tokensWithDigits = rawTokens.filter((token) => /\d/.test(token));

  if (tokensWithDigits.length > 0) {
    return tokensWithDigits;
  }

  return [];
}

function splitHouseLineIntoFragments(lineText) {
  const cleaned = normalizeLineText(lineText);

  if (!cleaned) {
    return [];
  }

  const regexMatches = cleaned.match(/\d{1,2}\s*[=\-:;_~]\s*\d{1,5}/g);

  if (Array.isArray(regexMatches) && regexMatches.length > 0) {
    return regexMatches;
  }

  const tokens = cleaned
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length > 0) {
    return tokens;
  }

  return /\d/.test(cleaned) ? [cleaned] : [];
}

function extractFragmentsFromLine(sectionKey, lineText) {
  if (sectionKey === "juri") {
    return splitJuriLineIntoFragments(lineText);
  }

  return splitHouseLineIntoFragments(lineText);
}

function getExpectedSeparator(sectionKey) {
  return SCAN_SECTION_META[sectionKey].expectedSeparator;
}

function getAcceptedSeparators(sectionKey) {
  if (sectionKey === "juri") {
    return ["-", ""];
  }

  return ["=", "-", ""];
}

function normalizeSeparatorText(value, sectionKey) {
  const expectedSeparator = getExpectedSeparator(sectionKey);

  return String(value || "")
    .replace(/[–—−]/g, "-")
    .replace(/[=:;_~]/g, expectedSeparator === "=" ? "=" : "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCandidate(sectionKey, fragment) {
  const cleaned = normalizeLineText(fragment);
  const digitNormalized = normalizeDigitCandidates(cleaned);
  const separatorNormalized = normalizeSeparatorText(digitNormalized, sectionKey);
  const directMatch = separatorNormalized.match(/^(\d{1,2})\s*([=\-])\s*(\d{1,5})$/);

  if (directMatch) {
    return {
      rawText: cleaned,
      parseText: separatorNormalized,
      numberCandidate: directMatch[1],
      quantityCandidate: directMatch[3],
      separatorFound: directMatch[2],
      usedFallback: false,
      digitCorrected: cleaned !== digitNormalized,
      separatorCorrected: digitNormalized !== separatorNormalized,
    };
  }

  const digitGroups = separatorNormalized.match(/\d+/g) || [];

  if (digitGroups.length >= 2) {
    return {
      rawText: cleaned,
      parseText: separatorNormalized,
      numberCandidate: digitGroups[0],
      quantityCandidate: digitGroups[1],
      separatorFound: "",
      usedFallback: true,
      digitCorrected: cleaned !== digitNormalized,
      separatorCorrected: digitNormalized !== separatorNormalized,
    };
  }

  return {
    rawText: cleaned,
    parseText: separatorNormalized,
    numberCandidate: "",
    quantityCandidate: "",
    separatorFound: "",
    usedFallback: true,
    digitCorrected: cleaned !== digitNormalized,
    separatorCorrected: digitNormalized !== separatorNormalized,
  };
}

function validateScanRow(sectionKey, row, parseMeta) {
  const acceptedSeparators = getAcceptedSeparators(sectionKey);

  if (!row.number || !row.quantity) {
    return {
      ok: false,
      message: "Enter number and quantity",
    };
  }

  if (!acceptedSeparators.includes(parseMeta.separatorFound)) {
    return {
      ok: false,
      message: `Use ${getExpectedSeparator(sectionKey)} in ${SCAN_SECTION_META[sectionKey].label}`,
    };
  }

  if (!isPositiveQuantity(row.quantity)) {
    return {
      ok: false,
      message: "Quantity must be greater than 0",
    };
  }

  if (sectionKey === "juri") {
    if (!/^\d{2}$/.test(row.number)) {
      return {
        ok: false,
        message: "Juri number must stay 2 digits",
      };
    }

    return {
      ok: true,
      message: "",
    };
  }

  if (!/^\d$/.test(row.number)) {
    return {
      ok: false,
      message: "House number must stay 0 to 9",
    };
  }

  return {
    ok: true,
    message: "",
  };
}

function buildOriginalPreview(originalText, normalizedText) {
  const cleanedOriginal = normalizeLineText(originalText);

  if (!cleanedOriginal || cleanedOriginal === normalizedText) {
    return "";
  }

  return `${cleanedOriginal} -> ${normalizedText}`;
}

function buildConfusionSuggestions(number, quantity) {
  const value = `${number || ""}${quantity || ""}`;

  return DIGIT_CONFUSION_HINTS.filter(({ digits }) =>
    digits.some((digit) => value.includes(digit))
  ).map((item) => item.label);
}

function buildReviewRow(sectionKey, fragment, confidence, rowIndex) {
  const parseMeta = parseCandidate(sectionKey, fragment);
  const number =
    sectionKey === "juri"
      ? normalizeJuriNumber(parseMeta.numberCandidate)
      : normalizeHouseNumber(parseMeta.numberCandidate);
  const quantity = normalizeQuantity(parseMeta.quantityCandidate);
  const expectedSeparator = getExpectedSeparator(sectionKey);
  const normalizedText =
    number && quantity ? `${number}${expectedSeparator}${quantity}` : parseMeta.rawText;
  const validation = validateScanRow(
    sectionKey,
    {
      number,
      quantity,
    },
    parseMeta
  );
  const lineConfidence = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  const separatorNeedsReview = parseMeta.separatorFound !== expectedSeparator;
  const confusionSuggestions =
    lineConfidence < LOW_CONFIDENCE_THRESHOLD
      ? buildConfusionSuggestions(number, quantity)
      : [];
  const shouldReview =
    !validation.ok ||
    lineConfidence < LOW_CONFIDENCE_THRESHOLD ||
    separatorNeedsReview ||
    parseMeta.digitCorrected ||
    parseMeta.separatorCorrected ||
    parseMeta.usedFallback;

  return {
    id: buildRowId(sectionKey, rowIndex),
    section: sectionKey,
    number,
    quantity,
    normalizedText,
    originalText: parseMeta.rawText,
    originalPreview: buildOriginalPreview(parseMeta.rawText, normalizedText),
    confidence: lineConfidence,
    tone: shouldReview ? "low" : "high",
    isValid: validation.ok,
    issue:
      !validation.ok
        ? validation.message
        : confusionSuggestions.length > 0
          ? `Check ${confusionSuggestions.join(", ")}`
        : lineConfidence < LOW_CONFIDENCE_THRESHOLD
          ? "Low OCR confidence"
          : separatorNeedsReview
            ? "Separator was normalized"
            : parseMeta.usedFallback
              ? "Separator was not clearly read"
              : parseMeta.digitCorrected || parseMeta.separatorCorrected
                ? "OCR normalization applied"
                : "",
    edited: false,
    suggestions: confusionSuggestions,
  };
}

function buildParsedData(sections) {
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

function buildReviewStateFromSections(sectionLines, ocrText, layout) {
  const nextSections = createEmptySections();
  const ignoredLines = [];
  let rowIndex = 0;

  SCAN_SECTION_ORDER.forEach((sectionKey) => {
    const lines = Array.isArray(sectionLines[sectionKey]) ? sectionLines[sectionKey] : [];

    lines.forEach((line, lineIndex) => {
      const lineText = normalizeLineText(line && line.text ? line.text : "");

      if (!lineText) {
        return;
      }

      const fragments = extractFragmentsFromLine(sectionKey, lineText);

      if (fragments.length === 0) {
        if (/\d/.test(lineText)) {
          ignoredLines.push({
            id: `ignored-${sectionKey}-${lineIndex}`,
            section: sectionKey,
            text: lineText,
            confidence: Number(line && line.confidence ? line.confidence : 0),
            reason: "Enter this row manually",
          });
        }
        return;
      }

      fragments.forEach((fragment) => {
        const nextRow = buildReviewRow(
          sectionKey,
          fragment,
          line && line.confidence ? line.confidence : 0,
          rowIndex
        );

        nextSections[sectionKey].push(nextRow);
        rowIndex += 1;
      });
    });
  });

  return {
    sections: nextSections,
    ignoredLines,
    ocrText: String(ocrText || ""),
    layout: layout || null,
    parsedData: buildParsedData(nextSections),
  };
}

export function createEmptyReviewState() {
  const sections = createEmptySections();

  return {
    sections,
    ignoredLines: [],
    ocrText: "",
    layout: null,
    parsedData: buildParsedData(sections),
  };
}

export function buildScanReviewFromScanPayload(scanPayload = {}) {
  const payloadSections = scanPayload && scanPayload.sections ? scanPayload.sections : {};
  const sectionLines = SCAN_SECTION_ORDER.reduce((accumulator, sectionKey) => {
    const payloadSection = payloadSections[sectionKey];
    accumulator[sectionKey] = Array.isArray(payloadSection && payloadSection.lines)
      ? payloadSection.lines
      : [];
    return accumulator;
  }, {});

  return buildReviewStateFromSections(sectionLines, scanPayload.text, scanPayload.layout);
}

export function scoreScanPayload(scanPayload = {}) {
  const reviewState = buildScanReviewFromScanPayload(scanPayload);
  const rows = SCAN_SECTION_ORDER.flatMap((sectionKey) => reviewState.sections[sectionKey] || []);
  const validCount = rows.filter((row) => row.isValid).length;
  const safeCount = rows.filter((row) => row.isValid && row.tone !== "low").length;
  const lowCount = rows.filter((row) => row.tone === "low").length;
  const ignoredCount = Array.isArray(reviewState.ignoredLines) ? reviewState.ignoredLines.length : 0;

  return {
    reviewState,
    score: validCount * 100 + safeCount * 20 - lowCount * 8 - ignoredCount * 10,
    validCount,
    safeCount,
    lowCount,
    ignoredCount,
  };
}

export function buildScanReviewFromLines(sourceLines = [], ocrText = "") {
  const sectionLines = createEmptySections();
  let currentSection = null;

  sourceLines.forEach((line) => {
    const lineText = normalizeLineText(line && line.text ? line.text : "");

    if (!lineText) {
      return;
    }

    const detectedSection = detectSectionFromLine(lineText);

    if (detectedSection) {
      currentSection = detectedSection;
    }

    const effectiveSection = detectedSection || currentSection;
    const contentText = stripHeaderPrefix(lineText, detectedSection);

    if (!effectiveSection || !contentText) {
      return;
    }

    sectionLines[effectiveSection].push({
      text: contentText,
      confidence: line && line.confidence ? line.confidence : 0,
    });
  });

  return buildReviewStateFromSections(sectionLines, ocrText, null);
}

export function getSectionMeta(sectionKey) {
  return SCAN_SECTION_META[sectionKey];
}

export function getSectionOrder() {
  return SCAN_SECTION_ORDER;
}

export function formatRowValue(sectionKey, number, quantity) {
  const separator = getExpectedSeparator(sectionKey);

  return `${number || "--"}${separator}${quantity || "--"}`;
}

export function normalizeEditedNumber(sectionKey, value) {
  return sectionKey === "juri" ? normalizeJuriNumber(value) : normalizeHouseNumber(value);
}

export function normalizeEditedQuantity(value) {
  return normalizeQuantity(value);
}

export function validateEditedRow(sectionKey, number, quantity) {
  return validateScanRow(
    sectionKey,
    {
      number,
      quantity,
    },
    {
      separatorFound: getExpectedSeparator(sectionKey),
    }
  );
}
