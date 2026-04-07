const DEFAULT_COMMISSION = {
  single: 0.9,
  juri: 2.65,
};

const DEFAULT_ADMIN = {
  username: "admin",
  password: "1234",
};

const DEFAULT_MASTER = {
  username: "krishna",
  password: "131722",
};

const DEFAULT_SELLERS = [
  {
    id: 1,
    name: "Seller One",
    mobile: "",
    username: "seller1",
    password: "1234",
    active: true,
    singleCommission: DEFAULT_COMMISSION.single,
    juriCommission: DEFAULT_COMMISSION.juri,
  },
];

const DEFAULT_DB = {
  master: DEFAULT_MASTER,
  admin: DEFAULT_ADMIN,
  sellers: DEFAULT_SELLERS,
  tickets: [],
  results: [],
  settings: {
    commission: DEFAULT_COMMISSION,
    rates: {
      singleSell: 11,
      singlePayout: 100,
      juriSell: 10,
      juriPayout: 600,
    },
  },
};

function normalizeSeller(input = {}, index = 0) {
  return {
    id: input.id || Date.now() + index,
    name: input.name || `Seller ${index + 1}`,
    mobile: input.mobile || "",
    username: input.username || `seller${index + 1}`,
    password:
      typeof input.password === "string"
        ? input.password
        : DEFAULT_SELLERS[0].password,
    active: input.active !== undefined ? Boolean(input.active) : true,
    singleCommission:
      typeof input.singleCommission === "number"
        ? input.singleCommission
        : DEFAULT_COMMISSION.single,
    juriCommission:
      typeof input.juriCommission === "number"
        ? input.juriCommission
        : DEFAULT_COMMISSION.juri,
  };
}

function createSeller(input = {}, sellers = []) {
  return normalizeSeller(
    {
      ...input,
      id: input.id || Date.now(),
      active: input.active !== undefined ? input.active : true,
    },
    sellers.length
  );
}

function updateSeller(existing, input = {}) {
  return normalizeSeller({
    ...existing,
    ...input,
    id: existing.id,
  });
}

function normalizeTicket(input = {}, index = 0) {
  const now = new Date().toISOString();

  return {
    id: input.id || Date.now() + index,
    sellerUsername: input.sellerUsername || "",
    customerName: input.customerName || "Walk-in Customer",
    customerPhone: input.customerPhone || "",
    date: input.date || formatDate(new Date()),
    drawTime: input.drawTime || "11:00",
    paymentMode: input.paymentMode || "Paid",
    paidAmount: Number(input.paidAmount || 0),
    dueAmount: Number(input.dueAmount || 0),
    items: Array.isArray(input.items) ? input.items : [],
    total: Number(input.total || 0),
    commission: Number(input.commission || 0),
    claimed: Boolean(input.claimed),
    payout: Number(input.payout || 0),
    winningNumber: input.winningNumber || "",
    cancelled: Boolean(input.cancelled),
    cancelledAt: input.cancelledAt || "",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function createTicket(input = {}) {
  return normalizeTicket({
    ...input,
    id: input.id || Date.now(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function updateTicket(existing, input = {}) {
  return normalizeTicket({
    ...existing,
    ...input,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

function formatDate(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

module.exports = {
  DEFAULT_DB,
  createSeller,
  createTicket,
  normalizeSeller,
  normalizeTicket,
  updateSeller,
  updateTicket,
};
