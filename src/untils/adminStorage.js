import { DEFAULT_COMMISSION } from "./constants.js";
import { load } from "./storage.js";

export const SELLER_PANEL_STORAGE_KEY = "seller-panel-state-v3";
export const PANEL_SESSION_KEY = "lottery-panel-session-v1";
export const SELLER_LIST_KEY = "lottery-sellers-v1";

export const DEFAULT_SELLERS = [
  {
    id: 1,
    name: "Seller One",
    mobile: "",
    username: "seller1",
    password: "",
    active: true,
    singleCommission: DEFAULT_COMMISSION.single,
    juriCommission: DEFAULT_COMMISSION.juri,
  },
];

export function getStoredSellers() {
  const stored = load(SELLER_LIST_KEY, DEFAULT_SELLERS);

  if (!Array.isArray(stored)) {
    return DEFAULT_SELLERS;
  }

  return stored.map((seller, index) => ({
    id: seller && seller.id ? seller.id : Date.now() + index,
    name: seller && seller.name ? seller.name : `Seller ${index + 1}`,
    mobile: seller && seller.mobile ? seller.mobile : "",
    username: seller && seller.username ? seller.username : `seller${index + 1}`,
    password: "",
    active: seller && seller.active !== undefined ? Boolean(seller.active) : true,
    singleCommission:
      seller && typeof seller.singleCommission === "number" && !Number.isNaN(seller.singleCommission)
        ? seller.singleCommission
        : DEFAULT_COMMISSION.single,
    juriCommission:
      seller && typeof seller.juriCommission === "number" && !Number.isNaN(seller.juriCommission)
        ? seller.juriCommission
        : DEFAULT_COMMISSION.juri,
  }));
}

export function getSellerCommissionSettings(username) {
  const matchedSeller = getStoredSellers().find(
    (seller) =>
      username &&
      seller.username &&
      seller.username.toLowerCase() === String(username).toLowerCase()
  );

  return {
    single: matchedSeller ? matchedSeller.singleCommission : DEFAULT_COMMISSION.single,
    juri: matchedSeller ? matchedSeller.juriCommission : DEFAULT_COMMISSION.juri,
  };
}
