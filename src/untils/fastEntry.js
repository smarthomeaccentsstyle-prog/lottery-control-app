const FAST_ENTRY_REPLACERS = [
  [/o/gi, "0"],
  [/[li]/gi, "1"],
  [/s/gi, "5"],
];

export function normalizeFastCharacters(value) {
  return FAST_ENTRY_REPLACERS.reduce(
    (output, [pattern, replacement]) => output.replace(pattern, replacement),
    String(value || "")
  );
}

export function sanitizeFastDigits(value, maxLength) {
  const digits = normalizeFastCharacters(value).replace(/[^\d]/g, "");

  if (typeof maxLength === "number") {
    return digits.slice(0, maxLength);
  }

  return digits;
}

export function sanitizeFastQuantity(value, maxLength = 4) {
  return sanitizeFastDigits(value, maxLength).replace(/^0+(?=\d)/, "");
}

export function normalizeFastMode(value) {
  return ["third", "fourth", "juri"].includes(value) ? value : "third";
}

export function tokenizeJuriText(value) {
  return normalizeFastCharacters(value)
    .split(/[,\n]+/)
    .flatMap((line) => line.trim().split(/\s+/))
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseFastJuriText(value) {
  const invalid = [];
  const lookup = new Map();
  const order = [];

  tokenizeJuriText(value).forEach((token) => {
    const match = token.match(/^(\d{2})-(\d+)$/);

    if (!match) {
      invalid.push(token);
      return;
    }

    const qty = Number(match[2] || 0);

    if (!qty) {
      invalid.push(token);
      return;
    }

    if (!lookup.has(match[1])) {
      lookup.set(match[1], qty);
      order.push(match[1]);
      return;
    }

    lookup.set(match[1], lookup.get(match[1]) + qty);
  });

  return {
    entries: order.map((number) => ({
      num: number,
      qty: lookup.get(number),
    })),
    invalid,
  };
}

export function buildFastJuriText(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((item) => item && item.num && Number(item.qty) > 0)
    .map((item) => `${String(item.num).padStart(2, "0")}-${sanitizeFastDigits(item.qty)}`)
    .join(", ");
}

export function getJuriQuantity(text, number) {
  const normalizedNumber = sanitizeFastDigits(number, 2).padStart(2, "0");
  const parsed = parseFastJuriText(text);
  const matched = parsed.entries.find((entry) => entry.num === normalizedNumber);
  return matched ? matched.qty : 0;
}

export function upsertJuriText(text, number, qty) {
  const normalizedNumber = sanitizeFastDigits(number, 2).padStart(2, "0");
  const parsed = parseFastJuriText(text);
  const nextEntries = [...parsed.entries];
  const existingIndex = nextEntries.findIndex((entry) => entry.num === normalizedNumber);
  const numericQty = Number(sanitizeFastDigits(qty)) || 0;

  if (!numericQty) {
    if (existingIndex >= 0) {
      nextEntries.splice(existingIndex, 1);
    }

    return buildFastJuriText(nextEntries);
  }

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = {
      num: normalizedNumber,
      qty: numericQty,
    };
  } else {
    nextEntries.push({
      num: normalizedNumber,
      qty: numericQty,
    });
  }

  return buildFastJuriText(nextEntries);
}

export function normalizeSingleDraft(values) {
  const next = Array.isArray(values) ? [...values] : [];

  while (next.length < 10) {
    next.push("");
  }

  return next.slice(0, 10).map((value) => sanitizeFastQuantity(value));
}

export function findFirstFilledDigit(values) {
  const index = normalizeSingleDraft(values).findIndex((value) => Number(value || 0) > 0);
  return index >= 0 ? index : 0;
}
