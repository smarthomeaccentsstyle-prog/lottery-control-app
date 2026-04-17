import { getBusinessNowParts } from "./serverClock.js";

export const DRAW_OPTIONS = [
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

export function getCurrentBusinessDate() {
  return getBusinessNowParts().date;
}

export function getEntryCutoffValue(drawTime) {
  const match = DRAW_OPTIONS.find((option) => option.value === drawTime);
  return match && match.cutoff ? match.cutoff : drawTime;
}

export function getResultReleaseValue(drawTime) {
  const match = DRAW_OPTIONS.find((option) => option.value === drawTime);
  return match && match.resultOpen ? match.resultOpen : drawTime;
}

export function getNextAvailableDrawSelection(baseDate = getCurrentBusinessDate()) {
  let candidate = parseDateString(baseDate) || parseDateString(getCurrentBusinessDate());

  while (candidate) {
    const nextOpenDraw = DRAW_OPTIONS.find(
      (option) => !isDrawClosedForDate(candidate, option.value)
    );

    if (nextOpenDraw) {
      return {
        date: formatDate(candidate),
        drawTime: nextOpenDraw.value,
      };
    }

    candidate = addDays(candidate, 1);
  }

  return {
    date: getCurrentBusinessDate(),
    drawTime: DRAW_OPTIONS[0].value,
  };
}

export function getLatestAllowedBookingDate() {
  const today = parseDateString(getCurrentBusinessDate()) || parseDateString("2000-01-01");
  return formatDate(addDays(today, 1));
}

export function getNextValidBookingDate(dateString, drawTime) {
  const today = parseDateString(getCurrentBusinessDate());
  const tomorrow = parseDateString(getLatestAllowedBookingDate());
  let candidate = parseDateString(dateString) || today;

  if (candidate < today) {
    candidate = new Date(today);
  }

  if (candidate > tomorrow) {
    candidate = new Date(tomorrow);
  }

  if (isDrawClosedForDate(candidate, drawTime)) {
    candidate = new Date(tomorrow);
  }

  return formatDate(candidate);
}

export function isDrawClosedForDate(dateValue, drawTime) {
  const candidateDate = normalizeDateValue(dateValue);

  if (!candidateDate) {
    return false;
  }

  const now = getBusinessNowParts();

  if (candidateDate < now.date) {
    return true;
  }

  if (candidateDate > now.date) {
    return false;
  }

  return getEntryCutoffValue(drawTime) <= now.time;
}

export function isLockedTicket(ticket) {
  if (!ticket || !ticket.date || !ticket.drawTime) {
    return false;
  }

  return isDrawClosedForDate(ticket.date, ticket.drawTime);
}

export function getDefaultAdminDrawTime() {
  const today = getCurrentBusinessDate();
  const nextOpenDraw = DRAW_OPTIONS.find(
    (option) => !isDrawClosedForDate(today, option.value)
  );

  return nextOpenDraw ? nextOpenDraw.value : DRAW_OPTIONS[DRAW_OPTIONS.length - 1].value;
}

export function getResultAvailability(dateString, drawTime) {
  const now = getBusinessNowParts();
  const candidateDate = normalizeDateValue(dateString) || now.date;
  const opensAt = getResultReleaseValue(drawTime);

  if (candidateDate > now.date) {
    return {
      canSave: false,
      opensAt,
      message: `Future date result is not allowed. Result opens after ${formatTimeValue(opensAt)} IST on ${candidateDate}.`,
    };
  }

  if (candidateDate < now.date || now.time >= opensAt) {
    return {
      canSave: true,
      opensAt,
      message: `Result is open for ${candidateDate}.`,
    };
  }

  return {
    canSave: false,
    opensAt,
    message: `Result for ${formatDrawTime(drawTime)} on ${candidateDate} can be saved after ${formatTimeValue(opensAt)} IST.`,
  };
}

export function formatDrawTime(value) {
  const match = DRAW_OPTIONS.find((option) => option.value === value);
  return match ? match.label : value;
}

export function formatTimeValue(value) {
  const [hourText = "0", minuteText = "00"] = String(value || "").split(":");
  const hour = Number(hourText) || 0;
  const minute = String(Number(minuteText) || 0).padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minute} ${suffix}`;
}

export function formatEntryCutoffTime(value) {
  return formatTimeValue(getEntryCutoffValue(value));
}

function normalizeDateValue(value) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.getTime === "function" &&
    !Number.isNaN(value.getTime())
  ) {
    return formatDate(value);
  }

  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateString(dateString) {
  const normalized = normalizeDateValue(dateString);

  if (!normalized) {
    return null;
  }

  const [yearText, monthText, dayText] = normalized.split("-");
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}

function addDays(dateValue, days) {
  const next = new Date(dateValue);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(dateValue) {
  return [
    dateValue.getUTCFullYear(),
    String(dateValue.getUTCMonth() + 1).padStart(2, "0"),
    String(dateValue.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
