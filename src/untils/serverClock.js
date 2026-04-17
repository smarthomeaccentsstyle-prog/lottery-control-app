const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const serverClockState = {
  epochMs: 0,
  syncedAtPerformanceMs: 0,
  timeZone: DEFAULT_TIME_ZONE,
};

const formatterCache = new Map();

export function syncServerClock(serverTime) {
  const epochMs =
    serverTime && Number.isFinite(Number(serverTime.epochMs))
      ? Number(serverTime.epochMs)
      : 0;

  if (!epochMs) {
    return;
  }

  serverClockState.epochMs = epochMs;
  serverClockState.syncedAtPerformanceMs = getPerformanceNow();
  serverClockState.timeZone =
    serverTime && typeof serverTime.timeZone === "string" && serverTime.timeZone.trim()
      ? serverTime.timeZone.trim()
      : DEFAULT_TIME_ZONE;
}

export function resetServerClock() {
  serverClockState.epochMs = 0;
  serverClockState.syncedAtPerformanceMs = 0;
  serverClockState.timeZone = DEFAULT_TIME_ZONE;
}

export function getServerTimeZone() {
  return serverClockState.timeZone || DEFAULT_TIME_ZONE;
}

export function getServerNowDate() {
  if (!serverClockState.epochMs) {
    return new Date();
  }

  const elapsedMs = getPerformanceNow() - serverClockState.syncedAtPerformanceMs;
  return new Date(serverClockState.epochMs + elapsedMs);
}

export function getBusinessNowParts() {
  return getDatePartsInTimeZone(getServerNowDate(), getServerTimeZone());
}

function getDatePartsInTimeZone(dateValue, timeZone) {
  const formatter = getCachedFormatter(timeZone);
  const parts = formatter.formatToParts(dateValue).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    second: `${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone,
  };
}

function getCachedFormatter(timeZone) {
  const cacheKey = timeZone || DEFAULT_TIME_ZONE;

  if (!formatterCache.has(cacheKey)) {
    formatterCache.set(
      cacheKey,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: cacheKey,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
    );
  }

  return formatterCache.get(cacheKey);
}

function getPerformanceNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}
