import {
  buildScanFromReviewDraft,
  canAutoApplyScan,
  mapScanResultToDraft,
  normalizeScanResponse,
} from "./ticketScan.js";

test("maps scanned ticket payload into the existing draft shape", () => {
  const scan = normalizeScanResponse({
    thirdHouse: [
      { digit: "0", qty: 10 },
      { digit: "1", qty: 7 },
      { digit: "2", qty: 8 },
      { digit: "3", qty: 6 },
      { digit: "4", qty: 11 },
    ],
    fourthHouse: [
      { digit: "7", qty: 15 },
      { digit: "5", qty: 27 },
      { digit: "6", qty: 22 },
      { digit: "8", qty: 3 },
      { digit: "9", qty: 52 },
    ],
    juri: [
      { number: "08", qty: 19 },
      { number: "12", qty: 10 },
      { number: "21", qty: 9 },
      { number: "43", qty: 5 },
      { number: "04", qty: 3 },
      { number: "80", qty: 8 },
      { number: "98", qty: 17 },
      { number: "73", qty: 5 },
      { number: "37", qty: 5 },
      { number: "78", qty: 5 },
      { number: "90", qty: 72 },
    ],
    rawLines: [
      "0-10",
      "1-7",
      "2-8",
      "3-6",
      "4-11",
      "7-15",
      "5-27",
      "6-22",
      "8-3",
      "9-52",
      "08-19",
      "12-10",
      "21-9",
      "43-5",
      "04-3",
      "80-8",
      "98-17",
      "73-5",
      "37-5",
      "78-5",
      "90-72",
    ],
    notes: [],
    confidence: "medium",
  });

  expect(mapScanResultToDraft(scan)).toEqual({
    third: ["10", "7", "8", "6", "11", "", "", "", "", ""],
    fourth: ["", "", "", "", "", "27", "22", "15", "3", "52"],
    juriText:
      "08-19, 12-10, 21-9, 43-5, 04-3, 80-8, 98-17, 73-5, 37-5, 78-5, 90-72",
  });
});

test("keeps ambiguous house rows in unassignedHouse until review resolves them", () => {
  const scan = normalizeScanResponse({
    houseCandidates: [
      { digit: "0", qty: 5, sideHint: "left", confidence: "medium", sourceText: "0-5" },
      { digit: "1", qty: 10, sideHint: "unknown", confidence: "medium", sourceText: "1-10" },
      { digit: "3", qty: 5, sideHint: "right", confidence: "medium", sourceText: "3-5" },
    ],
    juriCandidates: [
      { number: "03", qty: 1, confidence: "medium", sourceText: "03-1" },
      { number: "01", qty: 1, confidence: "medium", sourceText: "01-1" },
    ],
    thirdHouse: [],
    fourthHouse: [],
    unassignedHouse: [],
    juri: [],
    rawLines: ["0-5", "1-10", "3-5", "03-1", "01-1"],
    notes: ["Detected multiple loose clusters"],
    confidence: "medium",
  });

  expect(scan.thirdHouse).toEqual([{ digit: "0", qty: 5 }]);
  expect(scan.fourthHouse).toEqual([{ digit: "3", qty: 5 }]);
  expect(scan.unassignedHouse).toEqual([
    { digit: "1", qty: 10, reason: "house row found but side/section unclear" },
  ]);
  expect(scan.juri).toEqual([
    { number: "03", qty: 1 },
    { number: "01", qty: 1 },
  ]);
});

test("review draft blocks invalid rows and preserves unresolved house rows", () => {
  const prepared = buildScanFromReviewDraft({
    rows: [
      { id: "a", section: "thirdHouse", value: "0", qty: "5", reason: "" },
      { id: "b", section: "unassignedHouse", value: "1", qty: "10", reason: "unclear side" },
      { id: "c", section: "juri", value: "03", qty: "1", reason: "" },
      { id: "d", section: "juri", value: "x", qty: "1", reason: "" },
    ],
    notes: ["Detected mixed clusters"],
    rawLines: ["0-5", "1-10", "03-1"],
    confidence: "medium",
  });

  expect(prepared.invalidRows).toEqual([
    { rowId: "d", message: "Juri number must be exactly two digits." },
  ]);
  expect(prepared.scan.thirdHouse).toEqual([{ digit: "0", qty: 5 }]);
  expect(prepared.scan.unassignedHouse).toEqual([
    { digit: "1", qty: 10, reason: "unclear side" },
  ]);
  expect(prepared.scan.juri).toEqual([{ number: "03", qty: 1 }]);
});

test("does not double identical rows when a scan sees the same entry more than once", () => {
  const scan = normalizeScanResponse({
    thirdHouse: [
      { digit: "0", qty: 10 },
      { digit: "0", qty: 10 },
      { digit: "1", qty: 7 },
    ],
    fourthHouse: [
      { digit: "7", qty: 15 },
      { digit: "7", qty: 15 },
    ],
    juri: [
      { number: "08", qty: 19 },
      { number: "08", qty: 19 },
      { number: "12", qty: 10 },
    ],
    rawLines: [],
    notes: [],
    confidence: "medium",
  });

  expect(scan.thirdHouse).toEqual([
    { digit: "0", qty: 10 },
    { digit: "1", qty: 7 },
  ]);
  expect(scan.fourthHouse).toEqual([{ digit: "7", qty: 15 }]);
  expect(scan.juri).toEqual([
    { number: "08", qty: 19 },
    { number: "12", qty: 10 },
  ]);
});

test("auto-applies clean scans and keeps ambiguous house scans in review", () => {
  expect(
    canAutoApplyScan({
      thirdHouse: [{ digit: "0", qty: 10 }],
      fourthHouse: [{ digit: "7", qty: 15 }],
      unassignedHouse: [],
      juri: [{ number: "08", qty: 19 }],
    })
  ).toBe(true);

  expect(
    canAutoApplyScan({
      thirdHouse: [{ digit: "0", qty: 10 }],
      fourthHouse: [],
      unassignedHouse: [{ digit: "1", qty: 7, reason: "unclear side" }],
      juri: [{ number: "08", qty: 19 }],
    })
  ).toBe(false);

  expect(
    canAutoApplyScan({
      thirdHouse: [],
      fourthHouse: [],
      unassignedHouse: [],
      juri: [],
    })
  ).toBe(false);
});
