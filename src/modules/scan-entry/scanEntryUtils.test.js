import {
  buildManualEntryDraft,
  buildScanReviewFromLines,
  buildScanReviewFromScanPayload,
  getReviewStats,
  updateReviewRow,
} from "./scanEntryUtils.js";

test("parses strict handwritten layout into 3rd house, 4th house, and juri rows", () => {
  const reviewState = buildScanReviewFromScanPayload({
    text: "2=5\n7=9\n7=8\n5=21\n05-20 15-10\n22-05 48-09\n67-03",
    sections: {
      third: {
        lines: [
          { text: "2=5", confidence: 94 },
          { text: "7=9", confidence: 92 },
        ],
      },
      fourth: {
        lines: [
          { text: "7=8", confidence: 95 },
          { text: "5=21", confidence: 94 },
        ],
      },
      juri: {
        lines: [
          { text: "05-20   15-10", confidence: 93 },
          { text: "22-05   48-09", confidence: 91 },
          { text: "67-03", confidence: 92 },
        ],
      },
    },
  });

  expect(reviewState.sections.third).toHaveLength(2);
  expect(reviewState.sections.fourth).toHaveLength(2);
  expect(reviewState.sections.juri).toHaveLength(5);
  expect(reviewState.sections.third[0].normalizedText).toBe("2=5");
  expect(reviewState.sections.fourth[1].normalizedText).toBe("5=21");
  expect(reviewState.sections.juri[0].normalizedText).toBe("05-20");
  expect(reviewState.sections.juri[4].normalizedText).toBe("67-03");
  expect(reviewState.parsedData).toEqual({
    h3: [
      { number: "2", qty: "5" },
      { number: "7", qty: "9" },
    ],
    h4: [
      { number: "7", qty: "8" },
      { number: "5", qty: "21" },
    ],
    juri: [
      { number: "05", qty: "20" },
      { number: "15", qty: "10" },
      { number: "22", qty: "05" },
      { number: "48", qty: "09" },
      { number: "67", qty: "03" },
    ],
  });
});

test("normalizes leading zero house numbers but keeps one-digit juri numbers invalid", () => {
  const reviewState = buildScanReviewFromScanPayload({
    sections: {
      third: {
        lines: [{ text: "02=5", confidence: 95 }],
      },
      fourth: {
        lines: [],
      },
      juri: {
        lines: [{ text: "5-20", confidence: 95 }],
      },
    },
  });

  expect(reviewState.sections.third[0].number).toBe("2");
  expect(reviewState.sections.third[0].isValid).toBe(true);
  expect(reviewState.sections.third[0].tone).toBe("high");
  expect(reviewState.sections.juri[0].number).toBe("5");
  expect(reviewState.sections.juri[0].isValid).toBe(false);
  expect(reviewState.sections.juri[0].issue).toBe("Juri number must stay 2 digits");
});

test("builds the existing manual entry draft shape from safe rows only", () => {
  const reviewState = buildScanReviewFromScanPayload({
    sections: {
      third: {
        lines: [
          { text: "2=5", confidence: 95 },
          { text: "7 9", confidence: 61 },
        ],
      },
      fourth: {
        lines: [{ text: "5=21", confidence: 95 }],
      },
      juri: {
        lines: [{ text: "08-19", confidence: 95 }],
      },
    },
  });

  const safeDraft = buildManualEntryDraft(reviewState, {
    safeOnly: true,
  });

  expect(safeDraft.third[2]).toBe("5");
  expect(safeDraft.fourth[5]).toBe("21");
  expect(safeDraft.juriText).toBe("08-19");
  expect(safeDraft.skippedRows).toHaveLength(1);
});

test("edited juri rows become safe and stay compatible with ticket form state", () => {
  const reviewState = buildScanReviewFromScanPayload({
    sections: {
      third: { lines: [] },
      fourth: { lines: [] },
      juri: {
        lines: [{ text: "15-70", confidence: 45 }],
      },
    },
  });

  expect(getReviewStats(reviewState).issueCount).toBe(1);

  const updatedState = updateReviewRow(reviewState, reviewState.sections.juri[0].id, {
    number: "15",
    quantity: "10",
  });
  const draft = buildManualEntryDraft(updatedState, {
    safeOnly: false,
  });

  expect(updatedState.sections.juri[0].tone).toBe("corrected");
  expect(updatedState.sections.juri[0].isValid).toBe(true);
  expect(draft.juriText).toBe("15-10");
});

test("legacy line-based parsing still supports explicit section headers", () => {
  const reviewState = buildScanReviewFromLines([
    { text: "3RD HOUSE", confidence: 95 },
    { text: "2=5", confidence: 95 },
    { text: "4TH HOUSE", confidence: 95 },
    { text: "7=8", confidence: 95 },
    { text: "JURI", confidence: 95 },
    { text: "05-20   15-10", confidence: 95 },
  ]);

  expect(reviewState.sections.third[0].normalizedText).toBe("2=5");
  expect(reviewState.sections.fourth[0].normalizedText).toBe("7=8");
  expect(reviewState.sections.juri).toHaveLength(2);
});
