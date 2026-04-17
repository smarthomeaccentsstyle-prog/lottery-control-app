const SINGLE_RATE = 11;
const SINGLE_PAYOUT = 100;
const JURI_RATE = 10;
const JURI_PAYOUT = 600;
const {
  DRAW_SCHEDULE: DRAW_OPTIONS,
  isTicketLocked,
} = require("./drawTiming");

function buildRiskBoard(tickets) {
  const activeTickets = tickets.filter((ticket) => !ticket.cancelled);
  const thirdRows = buildRiskRows(activeTickets, "single3", createDigitList(10), SINGLE_RATE, SINGLE_PAYOUT);
  const fourthRows = buildRiskRows(activeTickets, "single4", createDigitList(10), SINGLE_RATE, SINGLE_PAYOUT);
  const juriRows = buildRiskRows(activeTickets, "juri", createJuriList(), JURI_RATE, JURI_PAYOUT);
  const sellerCollection = activeTickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0);
  const commission = activeTickets.reduce((sum, ticket) => sum + Number(ticket.commission || 0), 0);
  const collection = sellerCollection - commission;
  const highestRisk = {
    third: getHighestRiskRow(thirdRows),
    fourth: getHighestRiskRow(fourthRows),
    juri: getHighestRiskRow(juriRows),
  };
  const payoutExposure =
    highestRisk.third.payoutRisk +
    highestRisk.fourth.payoutRisk +
    highestRisk.juri.payoutRisk;

  return {
    thirdRows,
    fourthRows,
    juriRows,
    sellerCollection,
    collection,
    commission,
    payoutExposure,
    highestRisk,
    adminNet: collection - payoutExposure,
  };
}

function buildAdminOverview(tickets, results) {
  const payout = tickets.reduce((sum, ticket) => {
    const winNumber = getWinningNumber(results, ticket.date, ticket.drawTime);
    return sum + getTicketPayoutForResult(ticket, winNumber);
  }, 0);

  const sale = tickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0);
  const commission = tickets.reduce((sum, ticket) => sum + Number(ticket.commission || 0), 0);
  const outstanding = tickets.reduce((sum, ticket) => sum + Number(ticket.dueAmount || 0), 0);
  const adminCollection = sale - commission;

  return {
    sale,
    adminCollection,
    payout,
    commission,
    outstanding,
    profitLoss: adminCollection - payout,
  };
}

function buildSellerReport(seller, tickets, results, filters = {}) {
  const normalizedTickets = [...tickets]
    .sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt || 0).getTime() -
        new Date(left.updatedAt || left.createdAt || 0).getTime()
    )
    .map((ticket) => {
      const totalQty = Array.isArray(ticket.items)
        ? ticket.items.reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0)
        : 0;
      const status = getTicketStatus(ticket);

      return {
        ...ticket,
        totalQty,
        adminCollection: Number(ticket.total || 0) - Number(ticket.commission || 0),
        statusLabel: status.label,
        statusTone: status.tone,
      };
    });
  const payout = tickets.reduce((sum, ticket) => {
    const winNumber = getWinningNumber(results, ticket.date, ticket.drawTime);
    return sum + getTicketPayoutForResult(ticket, winNumber);
  }, 0);
  const sale = tickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0);
  const commission = tickets.reduce((sum, ticket) => sum + Number(ticket.commission || 0), 0);
  const adminCollection = sale - commission;
  const totalQty = tickets.reduce(
    (sum, ticket) =>
      sum +
      (Array.isArray(ticket.items)
        ? ticket.items.reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0)
        : 0),
    0
  );
  const customerDue = tickets.reduce((sum, ticket) => sum + Number(ticket.dueAmount || 0), 0);

  const drawSummary = DRAW_OPTIONS.map((option) => {
    const rowTickets = tickets.filter((ticket) => ticket.drawTime === option.value);
    return {
      drawTime: option.value,
      drawLabel: option.label,
      ticketCount: rowTickets.length,
      totalQty: rowTickets.reduce(
        (sum, ticket) =>
          sum +
          (Array.isArray(ticket.items)
            ? ticket.items.reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0)
            : 0),
        0
      ),
      sale: rowTickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0),
      adminCollection: rowTickets.reduce(
        (sum, ticket) => sum + Number(ticket.total || 0) - Number(ticket.commission || 0),
        0
      ),
    };
  }).filter((row) => row.ticketCount > 0);

  return {
    seller: seller || null,
    filters,
    sale,
    adminCollection,
    commission,
    payout,
    customerDue,
    totalQty,
    ticketCount: tickets.length,
    openTickets: tickets.filter((ticket) => !ticket.claimed && !isLocked(ticket)).length,
    lockedTickets: tickets.filter((ticket) => !ticket.claimed && isLocked(ticket)).length,
    claimedTickets: tickets.filter((ticket) => ticket.claimed).length,
    profitLoss: adminCollection - payout,
    drawSummary,
    tickets: normalizedTickets,
  };
}

function buildRangeReportMetrics(tickets, results, range, today, sellerUsername = "") {
  const filteredTickets = tickets.filter((ticket) => {
    if (ticket.cancelled) {
      return false;
    }

    if (
      sellerUsername &&
      String(ticket.sellerUsername || "").toLowerCase() !== sellerUsername.toLowerCase()
    ) {
      return false;
    }

    return isDateInRange(ticket.date, range, today);
  });

  const getPaymentMode = (ticket) => {
    const normalized = String(ticket && ticket.paymentMode ? ticket.paymentMode : "").trim().toLowerCase();

    if (normalized === "unpaid") {
      return "Unpaid";
    }

    if (normalized.includes("partial")) {
      return "Partial";
    }

    return "Paid";
  };

  return {
    sale: filteredTickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0),
    collection: filteredTickets.reduce((sum, ticket) => sum + Number(ticket.paidAmount || 0), 0),
    due: filteredTickets.reduce((sum, ticket) => sum + Number(ticket.dueAmount || 0), 0),
    commission: filteredTickets.reduce((sum, ticket) => sum + Number(ticket.commission || 0), 0),
    payout: filteredTickets.reduce(
      (sum, ticket) => sum + getTicketPayoutForResult(ticket, getWinningNumber(results, ticket.date, ticket.drawTime)),
      0
    ),
    claimedPayout: filteredTickets.reduce((sum, ticket) => sum + Number(ticket.payout || 0), 0),
    ticketCount: filteredTickets.length,
    winCount: filteredTickets.filter(
      (ticket) =>
        getTicketPayoutForResult(ticket, getWinningNumber(results, ticket.date, ticket.drawTime)) > 0
    ).length,
    claimCount: filteredTickets.filter((ticket) => ticket.claimed).length,
    paidCount: filteredTickets.filter((ticket) => getPaymentMode(ticket) === "Paid").length,
    partialCount: filteredTickets.filter((ticket) => getPaymentMode(ticket) === "Partial").length,
    unpaidCount: filteredTickets.filter((ticket) => getPaymentMode(ticket) === "Unpaid").length,
    averageSale: filteredTickets.length
      ? filteredTickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0) / filteredTickets.length
      : 0,
    slotSummary: DRAW_OPTIONS.map((slot) => {
      const slotTickets = filteredTickets.filter((ticket) => ticket.drawTime === slot.value);

      return {
        label: slot.label,
        count: slotTickets.length,
        sale: slotTickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0),
        commission: slotTickets.reduce((sum, ticket) => sum + Number(ticket.commission || 0), 0),
        payout: slotTickets.reduce(
          (sum, ticket) => sum + getTicketPayoutForResult(ticket, getWinningNumber(results, ticket.date, ticket.drawTime)),
          0
        ),
      };
    }),
  };
}

function buildRiskRows(tickets, itemType, numbers, rate, payoutRate) {
  const collection = tickets.reduce((sum, ticket) => sum + Number(ticket.total || 0), 0);

  return numbers.map((number) => {
    const totalQty = tickets.reduce((sum, ticket) => {
      const qty = Array.isArray(ticket.items)
        ? ticket.items.reduce((itemSum, item) => {
            if (item.type !== itemType) {
              return itemSum;
            }

            return normalizeNumber(item.num, itemType === "juri" ? 2 : 1) === number
              ? itemSum + Number(item.qty || 0)
              : itemSum;
          }, 0)
        : 0;

      return sum + qty;
    }, 0);

    const payoutRisk = totalQty * payoutRate;

    return {
      number,
      totalQty,
      totalAmount: totalQty * rate,
      payoutRisk,
      tone: getRiskTone(payoutRisk, collection),
    };
  });
}

function getTicketPayoutForResult(ticket, winningNumber) {
  if (!winningNumber || !Array.isArray(ticket.items)) {
    return 0;
  }

  return ticket.items.reduce((sum, item) => {
    if (item.type === "juri" && normalizeNumber(item.num, 2) === winningNumber) {
      return sum + Number(item.qty || 0) * JURI_PAYOUT;
    }

    if (item.type === "single3" && String(item.num) === winningNumber.charAt(0)) {
      return sum + Number(item.qty || 0) * SINGLE_PAYOUT;
    }

    if (item.type === "single4" && String(item.num) === winningNumber.charAt(1)) {
      return sum + Number(item.qty || 0) * SINGLE_PAYOUT;
    }

    return sum;
  }, 0);
}

function getWinningNumber(results, date, drawTime) {
  const match = results.find((result) => result.date === date && result.drawTime === drawTime);
  return match ? match.winningNumber : "";
}

function getHighestRiskRow(rows) {
  const sorted = [...rows].sort((left, right) => right.payoutRisk - left.payoutRisk);
  return sorted[0] || { number: "--", payoutRisk: 0 };
}

function getRiskTone(riskValue, collectionValue) {
  if (riskValue <= 0) {
    return "safe";
  }

  if (!collectionValue) {
    return "warning";
  }

  if (riskValue >= collectionValue) {
    return "danger";
  }

  if (riskValue >= collectionValue * 0.5) {
    return "warning";
  }

  return "safe";
}

function getTicketStatus(ticket) {
  if (ticket && ticket.claimed) {
    return { label: "CLAIMED", tone: "claimed" };
  }

  if (isLocked(ticket)) {
    return { label: "LOCKED", tone: "locked" };
  }

  return { label: "OPEN", tone: "open" };
}

function isLocked(ticket) {
  return isTicketLocked(ticket);
}

function createDigitList(length) {
  return Array.from({ length }, (_, index) => String(index));
}

function createJuriList() {
  return Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));
}

function normalizeNumber(value, digits) {
  return String(value || "").padStart(digits, "0");
}

function isDateInRange(dateString, range, today) {
  const target = parseDateString(dateString);
  const current = parseDateString(today);

  if (!target || !current) {
    return false;
  }

  if (range === "Daily") {
    return isSameDate(target, current);
  }

  if (range === "Weekly") {
    const start = getWeekStart(current);
    return target >= start && target <= current;
  }

  if (range === "Monthly") {
    return (
      target.getFullYear() === current.getFullYear() &&
      target.getMonth() === current.getMonth()
    );
  }

  return target.getFullYear() === current.getFullYear();
}

function parseDateString(dateString) {
  const value = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function isSameDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getWeekStart(value) {
  const next = new Date(value);
  const diff = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

module.exports = {
  buildAdminOverview,
  buildRangeReportMetrics,
  buildRiskBoard,
  buildSellerReport,
};
