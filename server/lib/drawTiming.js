const INDIA_TIME_ZONE = "Asia/Kolkata";

const DRAW_SCHEDULE = [
  {
    value: "11:00",
    label: "11:00 AM",
    cutoff: "11:10",
    resultOpen: "11:29",
  },
  {
    value: "13:00",
    label: "1:00 PM",
    cutoff: "12:58",
    resultOpen: "13:01",
  },
  {
    value: "15:00",
    label: "3:00 PM",
    cutoff: "15:10",
    resultOpen: "15:29",
  },
  {
    value: "18:00",
    label: "6:00 PM",
    cutoff: "17:58",
    resultOpen: "18:01",
  },
  {
    value: "19:00",
    label: "7:00 PM",
    cutoff: "19:10",
    resultOpen: "19:29",
  },
  {
    value: "20:00",
    label: "8:00 PM",
    cutoff: "19:58",
    resultOpen: "20:01",
  },
];

const DRAW_LOOKUP = DRAW_SCHEDULE.reduce((accumulator, draw) => {
  accumulator[draw.value] = draw;
  return accumulator;
}, {});

const INDIA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: INDIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getIndiaTimeParts(referenceDate = new Date()) {
  const parts = INDIA_DATE_TIME_FORMATTER.formatToParts(referenceDate).reduce(
    (accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }

      return accumulator;
    },
    {}
  );

  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const second = `${time}:${parts.second}`;

  return {
    date,
    time,
    second,
    epochMs: referenceDate.getTime(),
    timeZone: INDIA_TIME_ZONE,
  };
}

function buildServerTimeSnapshot(referenceDate = new Date()) {
  const parts = getIndiaTimeParts(referenceDate);

  return {
    epochMs: referenceDate.getTime(),
    timeZone: INDIA_TIME_ZONE,
    businessDate: parts.date,
    businessTime: parts.second,
  };
}

function getCurrentBusinessDate(referenceDate = new Date()) {
  return getIndiaTimeParts(referenceDate).date;
}

function getEntryCutoffValue(drawTime) {
  const normalizedDrawTime = String(drawTime || "").trim();
  return DRAW_LOOKUP[normalizedDrawTime]
    ? DRAW_LOOKUP[normalizedDrawTime].cutoff
    : normalizedDrawTime || "11:00";
}

function getResultReleaseValue(drawTime) {
  const normalizedDrawTime = String(drawTime || "").trim();
  return DRAW_LOOKUP[normalizedDrawTime]
    ? DRAW_LOOKUP[normalizedDrawTime].resultOpen
    : normalizedDrawTime || "11:00";
}

function formatDrawLabel(drawTime) {
  const normalizedDrawTime = String(drawTime || "").trim();
  return DRAW_LOOKUP[normalizedDrawTime]
    ? DRAW_LOOKUP[normalizedDrawTime].label
    : normalizedDrawTime;
}

function getLatestAllowedTicketDate(referenceDate = new Date()) {
  return addDaysToDateString(getCurrentBusinessDate(referenceDate), 1);
}

function getNextValidTicketDate(dateString, drawTime, referenceDate = new Date()) {
  const today = getCurrentBusinessDate(referenceDate);
  const tomorrow = getLatestAllowedTicketDate(referenceDate);
  let candidate = normalizeBusinessDate(dateString) || today;

  if (compareDateStrings(candidate, today) < 0) {
    candidate = today;
  }

  if (compareDateStrings(candidate, tomorrow) > 0) {
    candidate = tomorrow;
  }

  if (isDrawClosedForDate(candidate, drawTime, referenceDate)) {
    candidate = tomorrow;
  }

  return candidate;
}

function isDrawClosedForDate(dateValue, drawTime, referenceDate = new Date()) {
  const candidateDate = normalizeBusinessDate(dateValue);

  if (!candidateDate) {
    return false;
  }

  const now = getIndiaTimeParts(referenceDate);

  if (compareDateStrings(candidateDate, now.date) < 0) {
    return true;
  }

  if (compareDateStrings(candidateDate, now.date) > 0) {
    return false;
  }

  return getEntryCutoffValue(drawTime) <= now.time;
}

function isTicketLocked(ticket, referenceDate = new Date()) {
  if (!ticket || !ticket.date || !ticket.drawTime) {
    return false;
  }

  return isDrawClosedForDate(ticket.date, ticket.drawTime, referenceDate);
}

function getResultAvailability(dateString, drawTime, referenceDate = new Date()) {
  const candidateDate = normalizeBusinessDate(dateString);
  const now = getIndiaTimeParts(referenceDate);
  const opensAt = getResultReleaseValue(drawTime);

  if (!candidateDate) {
    return {
      allowed: false,
      status: "invalid",
      message: "Result date is invalid.",
      opensAt,
      drawLabel: formatDrawLabel(drawTime),
    };
  }

  if (compareDateStrings(candidateDate, now.date) > 0) {
    return {
      allowed: false,
      status: "future",
      message: `Future date result is not allowed. Result for ${formatDrawLabel(drawTime)} opens on ${candidateDate} after ${opensAt} IST.`,
      opensAt,
      drawLabel: formatDrawLabel(drawTime),
    };
  }

  if (compareDateStrings(candidateDate, now.date) < 0 || now.time >= opensAt) {
    return {
      allowed: true,
      status: "open",
      message: "",
      opensAt,
      drawLabel: formatDrawLabel(drawTime),
    };
  }

  return {
    allowed: false,
    status: "waiting",
    message: `Result for ${formatDrawLabel(drawTime)} on ${candidateDate} can be saved after ${opensAt} IST.`,
    opensAt,
    drawLabel: formatDrawLabel(drawTime),
  };
}

function normalizeBusinessDate(dateValue) {
  const value = String(dateValue || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  return value;
}

function addDaysToDateString(dateString, days) {
  const parsedDate = parseBusinessDate(dateString);

  if (!parsedDate) {
    return "";
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + Number(days || 0));
  return formatBusinessDate(parsedDate);
}

function parseBusinessDate(dateString) {
  const normalizedDate = normalizeBusinessDate(dateString);

  if (!normalizedDate) {
    return null;
  }

  const [yearText, monthText, dayText] = normalizedDate.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function formatBusinessDate(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return "";
  }

  const year = String(dateValue.getUTCFullYear());
  const month = leftPad(String(dateValue.getUTCMonth() + 1), 2, "0");
  const day = leftPad(String(dateValue.getUTCDate()), 2, "0");
  return `${year}-${month}-${day}`;
}

function compareDateStrings(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function leftPad(value, targetLength, fillCharacter) {
  let output = String(value);

  while (output.length < targetLength) {
    output = fillCharacter + output;
  }

  return output;
}

module.exports = {
  DRAW_SCHEDULE,
  INDIA_TIME_ZONE,
  buildServerTimeSnapshot,
  compareDateStrings,
  formatDrawLabel,
  getCurrentBusinessDate,
  getEntryCutoffValue,
  getIndiaTimeParts,
  getLatestAllowedTicketDate,
  getNextValidTicketDate,
  getResultAvailability,
  getResultReleaseValue,
  isDrawClosedForDate,
  isTicketLocked,
};
