const sharp = require("sharp");

const { createOpenAiResponse } = require("./openai");

const DEFAULT_SCAN_MODEL = String(process.env.OPENAI_SCAN_MODEL || "gpt-4.1").trim();
const SUPPORTED_CONFIDENCE = new Set(["low", "medium", "high"]);
const SUPPORTED_SIDE_HINTS = new Set(["left", "right", "center", "unknown"]);
const SUPPORTED_VISION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_DATA_URL_SIZE = 12 * 1024 * 1024;
const MAX_PREP_DIMENSION = 2200;

class TicketScanValidationError extends Error {}

const TICKET_SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "houseCandidates",
    "juriCandidates",
    "thirdHouse",
    "fourthHouse",
    "unassignedHouse",
    "juri",
    "rawLines",
    "notes",
    "confidence",
  ],
  properties: {
    houseCandidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["digit", "qty", "sideHint", "confidence", "sourceText"],
        properties: {
          digit: { type: "string" },
          qty: { type: "integer" },
          sideHint: {
            type: "string",
            enum: ["left", "right", "center", "unknown"],
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          sourceText: { type: "string" },
          clusterLabel: { type: "string" },
        },
      },
    },
    juriCandidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "qty", "confidence", "sourceText"],
        properties: {
          number: { type: "string" },
          qty: { type: "integer" },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          sourceText: { type: "string" },
          clusterLabel: { type: "string" },
          sideHint: {
            type: "string",
            enum: ["left", "right", "center", "unknown"],
          },
        },
      },
    },
    thirdHouse: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["digit", "qty"],
        properties: {
          digit: { type: "string" },
          qty: { type: "integer" },
        },
      },
    },
    fourthHouse: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["digit", "qty"],
        properties: {
          digit: { type: "string" },
          qty: { type: "integer" },
        },
      },
    },
    unassignedHouse: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["digit", "qty", "reason"],
        properties: {
          digit: { type: "string" },
          qty: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
    juri: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "qty"],
        properties: {
          number: { type: "string" },
          qty: { type: "integer" },
        },
      },
    },
    rawLines: {
      type: "array",
      items: {
        type: "string",
      },
    },
    notes: {
      type: "array",
      items: {
        type: "string",
      },
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
  },
};

const EXTRACTION_INSTRUCTIONS = `
You extract messy handwritten lottery ticket entries from seller photos.

The images may contain:
- torn paper or notebook paper
- rotated phone photos
- perspective distortion
- mixed left / center / right clusters
- date text, session marks like 5/7hm, 6/7hm, 8/7hm
- Bengali or English surrounding scribbles
- underlines, headings, names, or decorative marks

Your job:
1. Read only number-qty ticket rows from the handwriting.
2. A valid row should look like leftPart-qty.
3. If leftPart has one digit, it is a house candidate.
4. If leftPart has two digits, it is a juri candidate.
5. Preserve leading zeros for juri like 01, 03, 06.
6. Ignore dates, names, headings, session markers, and unrelated scribbles.
7. Use page layout and cluster position to assign house rows:
   - left-side cluster is likely thirdHouse
   - right-side cluster is likely fourthHouse
   - if the house side is unclear, put the row in unassignedHouse with a short reason
8. Juri rows can appear anywhere on the page.
9. Never invent rows.
10. Prefer omission plus a note over hallucination.
11. If uncertain, include your best guess and lower the confidence or add a note.
12. Return valid JSON only.

Important reminders:
- Never convert juri 03 into 3.
- Never convert juri 06 into 6.
- House rows are only digits 0 to 9.
- Juri rows are exactly two digits 00 to 99.
- Include all valid clusters found on the page.
`.trim();

const FALLBACK_EXTRACTION_INSTRUCTIONS = `
You are doing a second-pass rescue extraction on a messy handwritten seller ticket image.

Focus on finding every plausible handwritten row that matches:
- one digit + "-" + qty  => house candidate
- two digits + "-" + qty => juri candidate

Do not force thirdHouse or fourthHouse assignment unless the side is clearly visible.
If unsure about house side, use sideHint "unknown" or "center" and let normalization place it in unassignedHouse.
Ignore dates, session text, names, decorative words, and headings.
Preserve leading zeros exactly for juri.
Return valid JSON only and prefer partial safe extraction over hallucination.
`.trim();

async function scanTicketFromImage({ imageDataUrl, fileName = "" } = {}) {
  const parsedImage = parseImageDataUrl(imageDataUrl);
  const preparedImages = await preprocessImageForScan(parsedImage);
  const primaryParsed = await requestTicketScanExtraction({
    fileName,
    images: preparedImages,
    instructions: EXTRACTION_INSTRUCTIONS,
    rescueMode: false,
  });
  const primaryScan = normalizeTicketScan(primaryParsed, {
    preprocessingNotes: preparedImages.notes,
  });

  if (!shouldRetryExtraction(primaryScan)) {
    return primaryScan;
  }

  const fallbackParsed = await requestTicketScanExtraction({
    fileName,
    images: preparedImages,
    instructions: FALLBACK_EXTRACTION_INSTRUCTIONS,
    rescueMode: true,
  });

  return normalizeTicketScan(fallbackParsed, {
    preprocessingNotes: [
      ...preparedImages.notes,
      "Ran a second-pass rescue extraction for a difficult handwritten image.",
    ],
  });
}

async function requestTicketScanExtraction({ fileName = "", images, instructions, rescueMode }) {
  const response = await createOpenAiResponse({
    model: DEFAULT_SCAN_MODEL,
    store: false,
    max_output_tokens: rescueMode ? 2800 : 2400,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "These images all represent the same seller ticket photo.",
              "Image 1 is the original upload.",
              "Image 2 is a cleaned version for readability.",
              fileName ? `Source filename: ${fileName}` : "",
              rescueMode
                ? "This is a rescue pass. Prioritize finding candidate rows even if grouping is uncertain."
                : "Read all valid handwritten ticket rows from every cluster you can identify.",
              "Return houseCandidates and juriCandidates first, then final grouped sections.",
              "Messy real-world examples may include: 0-5, 1-10, 50-30, 81-9, 06-1, 15-5.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
          {
            type: "input_image",
            image_url: images.originalDataUrl,
            detail: "high",
          },
          {
            type: "input_image",
            image_url: images.cleanedDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "lottery_ticket_scan",
        schema: TICKET_SCAN_SCHEMA,
        strict: true,
      },
    },
  });

  return parseStructuredJsonResponse(response);
}

async function preprocessImageForScan(parsedImage) {
  const notes = [];
  let originalDataUrl = toDataUrl(parsedImage.mimeType, parsedImage.buffer);

  try {
    if (!SUPPORTED_VISION_MIME_TYPES.has(parsedImage.mimeType)) {
      const convertedOriginalBuffer = await sharp(parsedImage.buffer, { failOn: "none" })
        .rotate()
        .flatten({ background: "#ffffff" })
        .jpeg({
          quality: 92,
          mozjpeg: true,
        })
        .toBuffer();

      originalDataUrl = toDataUrl("image/jpeg", convertedOriginalBuffer);
      notes.push("Converted the uploaded image into JPEG for scan compatibility.");
    }

    const baseSharp = sharp(parsedImage.buffer, { failOn: "none" }).rotate();
    const metadata = await baseSharp.metadata();
    const resized =
      Number(metadata.width || 0) > MAX_PREP_DIMENSION ||
      Number(metadata.height || 0) > MAX_PREP_DIMENSION;

    const cleanedBuffer = await sharp(parsedImage.buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: MAX_PREP_DIMENSION,
        height: MAX_PREP_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .normalise()
      .sharpen()
      .jpeg({
        quality: 92,
        mozjpeg: true,
      })
      .toBuffer();

    notes.push("Prepared a cleaned scan image with rotation handling and readability enhancement.");

    if (resized) {
      notes.push("Large image was resized for stable model processing.");
    }

    return {
      originalDataUrl,
      cleanedDataUrl: toDataUrl("image/jpeg", cleanedBuffer),
      notes,
    };
  } catch {
    notes.push("Image preprocessing was limited, so the original upload was used as-is.");
    return {
      originalDataUrl,
      cleanedDataUrl: originalDataUrl,
      notes,
    };
  }
}

function normalizeTicketScan(payload = {}, options = {}) {
  const notes = normalizeNotes(payload.notes);
  const preprocessingNotes = normalizeNotes(options.preprocessingNotes);
  const houseCandidates = normalizeHouseCandidates(payload.houseCandidates, notes);
  const juriCandidates = normalizeJuriCandidates(payload.juriCandidates, notes);

  let thirdHouse = normalizeHouseSection(payload.thirdHouse, notes, "thirdHouse");
  let fourthHouse = normalizeHouseSection(payload.fourthHouse, notes, "fourthHouse");
  let unassignedHouse = normalizeUnassignedHouse(payload.unassignedHouse, notes);
  let juri = normalizeJuriSection(payload.juri, notes);

  if (thirdHouse.length === 0 && fourthHouse.length === 0 && unassignedHouse.length === 0 && houseCandidates.length > 0) {
    const derivedHouseSections = deriveHouseSectionsFromCandidates(houseCandidates, notes);
    thirdHouse = derivedHouseSections.thirdHouse;
    fourthHouse = derivedHouseSections.fourthHouse;
    unassignedHouse = derivedHouseSections.unassignedHouse;
    notes.push("Derived house assignment from page layout hints because the image was not clearly labeled.");
  }

  if (juri.length === 0 && juriCandidates.length > 0) {
    juri = normalizeJuriSection(
      juriCandidates.map((item) => ({
        number: item.number,
        qty: item.qty,
      })),
      notes
    );
  }

  const resolvedHouseCandidates =
    houseCandidates.length > 0
      ? houseCandidates
      : buildHouseCandidatesFromSections(thirdHouse, fourthHouse, unassignedHouse);
  const resolvedJuriCandidates =
    juriCandidates.length > 0 ? juriCandidates : buildJuriCandidatesFromSection(juri);
  const rawLines = normalizeRawLines(payload.rawLines, {
    thirdHouse,
    fourthHouse,
    unassignedHouse,
    juri,
    houseCandidates: resolvedHouseCandidates,
    juriCandidates: resolvedJuriCandidates,
  });

  if (unassignedHouse.length > 0) {
    notes.push("Some house rows could not be confidently assigned to 3rd or 4th House.");
  }

  if (thirdHouse.length + fourthHouse.length + unassignedHouse.length + juri.length === 0) {
    notes.push("No valid ticket rows were extracted from the image.");
  }

  return {
    houseCandidates: resolvedHouseCandidates,
    juriCandidates: resolvedJuriCandidates,
    thirdHouse,
    fourthHouse,
    unassignedHouse,
    juri,
    rawLines,
    notes: dedupeStrings([...notes, ...preprocessingNotes]),
    confidence: tuneConfidence(normalizeConfidence(payload.confidence), {
      thirdHouse,
      fourthHouse,
      unassignedHouse,
      juri,
      notes,
    }),
  };
}

function normalizeHouseCandidates(entries, notes) {
  const seen = new Set();
  const normalized = [];

  safeArray(entries).forEach((entry, index) => {
    const digit = normalizeDigit(entry && entry.digit);
    const qty = normalizeQty(entry && entry.qty);
    const sideHint = normalizeSideHint(entry && entry.sideHint);
    const confidence = normalizeConfidence(entry && entry.confidence);
    const sourceText = String(entry && entry.sourceText ? entry.sourceText : "").trim();
    const clusterLabel = String(entry && entry.clusterLabel ? entry.clusterLabel : "").trim();

    if (!digit) {
      notes.push(`Dropped house candidate ${index + 1}: digit must be 0 to 9.`);
      return;
    }

    if (!qty) {
      notes.push(`Dropped house candidate ${index + 1}: qty must be a positive integer.`);
      return;
    }

    const dedupeKey = `${digit}|${qty}|${sideHint}|${sourceText}`;

    if (seen.has(dedupeKey)) {
      notes.push(`Removed duplicate house candidate ${digit}-${qty}.`);
      return;
    }

    seen.add(dedupeKey);
    normalized.push({
      digit,
      qty,
      sideHint,
      confidence,
      sourceText,
      clusterLabel,
    });
  });

  return normalized;
}

function normalizeJuriCandidates(entries, notes) {
  const seen = new Set();
  const normalized = [];

  safeArray(entries).forEach((entry, index) => {
    const number = normalizeJuriNumber(entry && entry.number);
    const qty = normalizeQty(entry && entry.qty);
    const confidence = normalizeConfidence(entry && entry.confidence);
    const sourceText = String(entry && entry.sourceText ? entry.sourceText : "").trim();
    const clusterLabel = String(entry && entry.clusterLabel ? entry.clusterLabel : "").trim();
    const sideHint = normalizeSideHint(entry && entry.sideHint);

    if (!number) {
      notes.push(`Dropped juri candidate ${index + 1}: number must be 00 to 99.`);
      return;
    }

    if (!qty) {
      notes.push(`Dropped juri candidate ${index + 1}: qty must be a positive integer.`);
      return;
    }

    const dedupeKey = `${number}|${qty}|${sourceText}`;

    if (seen.has(dedupeKey)) {
      notes.push(`Removed duplicate juri candidate ${number}-${qty}.`);
      return;
    }

    seen.add(dedupeKey);
    normalized.push({
      number,
      qty,
      confidence,
      sourceText,
      clusterLabel,
      sideHint,
    });
  });

  return normalized;
}

function normalizeHouseSection(entries, notes, sectionName) {
  const merged = new Map();
  const order = [];

  safeArray(entries).forEach((entry, index) => {
    const digit = normalizeDigit(entry && entry.digit);
    const qty = normalizeQty(entry && entry.qty);

    if (!digit) {
      notes.push(`Dropped ${sectionName} row ${index + 1}: digit must be 0 to 9.`);
      return;
    }

    if (!qty) {
      notes.push(`Dropped ${sectionName} row ${index + 1}: qty must be a positive integer.`);
      return;
    }

    if (!merged.has(digit)) {
      merged.set(digit, qty);
      order.push(digit);
      return;
    }

    merged.set(digit, merged.get(digit) + qty);
    notes.push(`Merged repeated ${sectionName} digit ${digit}.`);
  });

  return order.map((digit) => ({
    digit,
    qty: merged.get(digit),
  }));
}

function normalizeUnassignedHouse(entries, notes) {
  const merged = new Map();
  const order = [];

  safeArray(entries).forEach((entry, index) => {
    const digit = normalizeDigit(entry && entry.digit);
    const qty = normalizeQty(entry && entry.qty);
    const reason = String(entry && entry.reason ? entry.reason : "").trim();

    if (!digit) {
      notes.push(`Dropped unassigned house row ${index + 1}: digit must be 0 to 9.`);
      return;
    }

    if (!qty) {
      notes.push(`Dropped unassigned house row ${index + 1}: qty must be a positive integer.`);
      return;
    }

    if (!merged.has(digit)) {
      merged.set(digit, {
        qty,
        reason: reason || "house row found but side/section unclear",
      });
      order.push(digit);
      return;
    }

    const current = merged.get(digit);
    merged.set(digit, {
      qty: current.qty + qty,
      reason: current.reason || reason || "house row found but side/section unclear",
    });
    notes.push(`Merged repeated unassigned house digit ${digit}.`);
  });

  return order.map((digit) => ({
    digit,
    qty: merged.get(digit).qty,
    reason: merged.get(digit).reason,
  }));
}

function normalizeJuriSection(entries, notes) {
  const merged = new Map();
  const order = [];

  safeArray(entries).forEach((entry, index) => {
    const number = normalizeJuriNumber(entry && entry.number);
    const qty = normalizeQty(entry && entry.qty);

    if (!number) {
      notes.push(`Dropped juri row ${index + 1}: number must be 00 to 99.`);
      return;
    }

    if (!qty) {
      notes.push(`Dropped juri row ${index + 1}: qty must be a positive integer.`);
      return;
    }

    if (!merged.has(number)) {
      merged.set(number, qty);
      order.push(number);
      return;
    }

    merged.set(number, merged.get(number) + qty);
    notes.push(`Merged repeated juri number ${number}.`);
  });

  return order.map((number) => ({
    number,
    qty: merged.get(number),
  }));
}

function deriveHouseSectionsFromCandidates(houseCandidates, notes) {
  const thirdHouseSeed = [];
  const fourthHouseSeed = [];
  const unassignedSeed = [];

  houseCandidates.forEach((candidate) => {
    if (candidate.sideHint === "left") {
      thirdHouseSeed.push({
        digit: candidate.digit,
        qty: candidate.qty,
      });
      return;
    }

    if (candidate.sideHint === "right") {
      fourthHouseSeed.push({
        digit: candidate.digit,
        qty: candidate.qty,
      });
      return;
    }

    unassignedSeed.push({
      digit: candidate.digit,
      qty: candidate.qty,
      reason:
        candidate.sideHint === "center"
          ? "house row found in a center or mixed cluster"
          : "house row found but side/section unclear",
    });
  });

  return {
    thirdHouse: normalizeHouseSection(thirdHouseSeed, notes, "derived thirdHouse"),
    fourthHouse: normalizeHouseSection(fourthHouseSeed, notes, "derived fourthHouse"),
    unassignedHouse: normalizeUnassignedHouse(unassignedSeed, notes),
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

function normalizeRawLines(rawLines, sections) {
  const normalizedRawLines = safeArray(rawLines)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (normalizedRawLines.length > 0) {
    return normalizedRawLines;
  }

  const candidateLines = [
    ...safeArray(sections.houseCandidates).map((item) => item.sourceText),
    ...safeArray(sections.juriCandidates).map((item) => item.sourceText),
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (candidateLines.length > 0) {
    return dedupeStrings(candidateLines);
  }

  return [
    ...safeArray(sections.thirdHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(sections.fourthHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(sections.unassignedHouse).map((row) => `${row.digit}-${row.qty}`),
    ...safeArray(sections.juri).map((row) => `${row.number}-${row.qty}`),
  ];
}

function tuneConfidence(confidence, sections) {
  const totalRows =
    safeArray(sections.thirdHouse).length +
    safeArray(sections.fourthHouse).length +
    safeArray(sections.unassignedHouse).length +
    safeArray(sections.juri).length;
  const noteCount = safeArray(sections.notes).length;
  const unresolved = safeArray(sections.unassignedHouse).length;

  if (totalRows === 0) {
    return "low";
  }

  if (confidence === "high" && (unresolved > 0 || noteCount >= 4)) {
    return "medium";
  }

  if (unresolved >= 3 && confidence !== "low") {
    return "medium";
  }

  return confidence;
}

function shouldRetryExtraction(scan) {
  const totalRows =
    safeArray(scan.thirdHouse).length +
    safeArray(scan.fourthHouse).length +
    safeArray(scan.unassignedHouse).length +
    safeArray(scan.juri).length;
  const candidateRows =
    safeArray(scan.houseCandidates).length + safeArray(scan.juriCandidates).length;

  if (totalRows === 0) {
    return true;
  }

  if (totalRows <= 2 && candidateRows <= 2 && scan.confidence === "low") {
    return true;
  }

  return false;
}

function parseStructuredJsonResponse(response = {}) {
  const refusal = extractRefusal(response);

  if (refusal) {
    throw new Error(`OpenAI refused the scan request: ${refusal}`);
  }

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("OpenAI scan response did not include structured JSON output.");
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI scan response returned invalid JSON.");
  }
}

function extractOutputText(response = {}) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const outputItems = safeArray(response.output);

  for (const item of outputItems) {
    const content = safeArray(item && item.content);

    for (const block of content) {
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
    }
  }

  return "";
}

function extractRefusal(response = {}) {
  const outputItems = safeArray(response.output);

  for (const item of outputItems) {
    const content = safeArray(item && item.content);

    for (const block of content) {
      if (typeof block.refusal === "string" && block.refusal.trim()) {
        return block.refusal.trim();
      }
    }
  }

  return "";
}

function parseImageDataUrl(value) {
  const imageDataUrl = String(value || "").trim();

  if (!imageDataUrl.startsWith("data:image/")) {
    throw new TicketScanValidationError("A valid image data URL is required.");
  }

  if (imageDataUrl.length > MAX_DATA_URL_SIZE) {
    throw new TicketScanValidationError("Image is too large. Please upload a smaller image.");
  }

  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new TicketScanValidationError("Unsupported image upload format.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function toDataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeDigit(value) {
  const digit = String(value === undefined ? "" : value).replace(/[^\d]/g, "").slice(0, 1);
  return digit !== "" && Number(digit) <= 9 ? digit : "";
}

function normalizeJuriNumber(value) {
  const digits = String(value === undefined ? "" : value).replace(/[^\d]/g, "").slice(-2);

  if (!digits) {
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
  return SUPPORTED_CONFIDENCE.has(normalized) ? normalized : "medium";
}

function normalizeSideHint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SUPPORTED_SIDE_HINTS.has(normalized) ? normalized : "unknown";
}

function normalizeNotes(notes) {
  return safeArray(notes)
    .map((note) => String(note || "").trim())
    .filter(Boolean);
}

function dedupeStrings(values) {
  return Array.from(new Set(safeArray(values)));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  TicketScanValidationError,
  normalizeTicketScan,
  scanTicketFromImage,
};
