const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getCurrentBusinessDate,
  getNextValidTicketDate,
  getResultAvailability,
  isDrawClosedForDate,
} = require("./drawTiming");

function atIndiaTime(isoLikeUtcString) {
  return new Date(isoLikeUtcString);
}

test("keeps 11 AM booking open until 11:10 AM India time", () => {
  const referenceDate = atIndiaTime("2026-04-06T05:35:00.000Z");

  assert.equal(getCurrentBusinessDate(referenceDate), "2026-04-06");
  assert.equal(isDrawClosedForDate("2026-04-06", "11:00", referenceDate), false);
  assert.equal(getNextValidTicketDate("2026-04-06", "11:00", referenceDate), "2026-04-06");
});

test("moves 1 PM booking to next day after 12:58 PM India cutoff", () => {
  const referenceDate = atIndiaTime("2026-04-06T07:29:00.000Z");

  assert.equal(isDrawClosedForDate("2026-04-06", "13:00", referenceDate), true);
  assert.equal(getNextValidTicketDate("2026-04-06", "13:00", referenceDate), "2026-04-07");
});

test("only allows tomorrow as the furthest booking date", () => {
  const referenceDate = atIndiaTime("2026-04-06T03:30:00.000Z");

  assert.equal(getNextValidTicketDate("2026-04-10", "11:00", referenceDate), "2026-04-07");
});

test("opens 1 PM result save at 1:01 PM India time", () => {
  const beforeOpen = atIndiaTime("2026-04-06T07:30:00.000Z");
  const afterOpen = atIndiaTime("2026-04-06T07:31:00.000Z");

  assert.equal(getResultAvailability("2026-04-06", "13:00", beforeOpen).allowed, false);
  assert.equal(getResultAvailability("2026-04-06", "13:00", afterOpen).allowed, true);
});

test("opens 11 AM result save at 11:29 AM India time", () => {
  const beforeOpen = atIndiaTime("2026-04-06T05:58:00.000Z");
  const afterOpen = atIndiaTime("2026-04-06T05:59:00.000Z");

  assert.equal(getResultAvailability("2026-04-06", "11:00", beforeOpen).allowed, false);
  assert.equal(getResultAvailability("2026-04-06", "11:00", afterOpen).allowed, true);
});
