function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeOptionalId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
  }

  return value;
}

function getSellerOwnerAdminId(seller = {}, primaryAdminId = null) {
  const hasOwnerAdminId =
    seller && Object.prototype.hasOwnProperty.call(seller, "ownerAdminId");

  if (hasOwnerAdminId) {
    return normalizeOptionalId(seller.ownerAdminId);
  }

  return normalizeOptionalId(primaryAdminId);
}

function sellerBelongsToAdmin(seller, adminId, primaryAdminId = null) {
  const ownerAdminId = getSellerOwnerAdminId(seller, primaryAdminId);
  const normalizedAdminId = normalizeOptionalId(adminId);

  if (ownerAdminId === null || normalizedAdminId === null) {
    return false;
  }

  return String(ownerAdminId) === String(normalizedAdminId);
}

function canSessionAccessSeller(seller, session = {}, options = {}) {
  if (!seller || !session || !session.role) {
    return false;
  }

  if (session.role === "master") {
    return true;
  }

  if (session.role === "admin") {
    return sellerBelongsToAdmin(
      seller,
      session.adminId,
      options.primaryAdminId
    );
  }

  if (session.role === "seller") {
    return (
      normalizeUsername(seller.username) === normalizeUsername(session.username)
    );
  }

  return false;
}

function getAccessibleSellers(sellers = [], session = {}, options = {}) {
  const list = Array.isArray(sellers) ? sellers : [];

  return list.filter((seller) =>
    canSessionAccessSeller(seller, session, options)
  );
}

function getAccessibleSellerUsernameSet(sellers = [], session = {}, options = {}) {
  return new Set(
    getAccessibleSellers(sellers, session, options)
      .map((seller) => normalizeUsername(seller.username))
      .filter(Boolean)
  );
}

module.exports = {
  canSessionAccessSeller,
  getAccessibleSellers,
  getAccessibleSellerUsernameSet,
  getSellerOwnerAdminId,
  normalizeOptionalId,
  normalizeUsername,
  sellerBelongsToAdmin,
};
