import {
  buildManualEntryDraft,
  buildScanReviewFromLines,
  getReviewStats,
  updateReviewRow,
} from "./scanEntryUtils.js";

test("parses ticket sections into review rows and flags low confidence items", () => {
  const reviewState = buildScanReviewFromLines([
    { text: "3RD HOUSE", confidence: 95 },
    { text: "01-10", confidence: 92 },
    { text: "4TH HOUSE", confidence: 95 },
    { text: "05 24", confidence: 61 },
    { text: "JURI", confidence: 95 },
    { text: "08-19", confidence: 90 },
  ]);

  expect(reviewState.sections.third).toHaveLength(1);
  expect(reviewState.sections.fourth).toHaveLength(1);
  expect(reviewState.sections.juri).toHaveLength(1);
  expect(reviewState.sections.third[0].normalizedText).toBe("01-10");
  expect(reviewState.sections.fourth[0].normalizedText).toBe("05-24");
  expect(reviewState.sections.fourth[0].tone).toBe("low");
  expect(getReviewStats(reviewState).issueCount).toBe(1);
});

test("builds the existing manual entry draft shape from safe rows only", () => {
  const reviewState = buildScanReviewFromLines([
    { text: "3RD HOUSE", confidence: 95 },
    { text: "01-10", confidence: 95 },
    { text: "01 05", confidence: 55 },
    { text: "JURI", confidence: 95 },
    { text: "08-19", confidence: 95 },
  ]);

  const safeDraft = buildManualEntryDraft(reviewState, {
    safeOnly: true,
  });

  expect(safeDraft.third[1]).toBe("10");
  expect(safeDraft.juriText).toBe("08-19");
  expect(safeDraft.skippedRows).toHaveLength(1);
});

test("edited rows become safe and stay compatible with ticket form state", () => {
  const reviewState = buildScanReviewFromLines([
    { text: "4TH HOUSE", confidence: 95 },
    { text: "05 24", confidence: 55 },
  ]);

  const updatedState = updateReviewRow(reviewState, reviewState.sections.fourth[0].id, {
    number: "05",
    quantity: "74",
  });
  const draft = buildManualEntryDraft(updatedState, {
    safeOnly: false,
  });

  expect(updatedState.sections.fourth[0].tone).toBe("corrected");
  expect(updatedState.sections.fourth[0].isValid).toBe(true);
  expect(draft.fourth[5]).toBe("74");
});
