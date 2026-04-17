const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canSessionAccessSeller,
  getAccessibleSellers,
  getAccessibleSellerUsernameSet,
  getSellerOwnerAdminId,
} = require("./access");

const primaryAdminId = 1;
const sellers = [
  { id: 11, username: "legacy-owner" },
  { id: 12, username: "admin-one", ownerAdminId: 1 },
  { id: 13, username: "admin-two", ownerAdminId: 2 },
  { id: 14, username: "master-only", ownerAdminId: null },
];

test("legacy sellers inherit the primary admin when ownership is missing", () => {
  assert.equal(getSellerOwnerAdminId(sellers[0], primaryAdminId), primaryAdminId);
  assert.equal(getSellerOwnerAdminId(sellers[3], primaryAdminId), null);
});

test("admin sessions only get sellers owned by that admin", () => {
  const visibleSellers = getAccessibleSellers(
    sellers,
    { role: "admin", adminId: 2 },
    { primaryAdminId }
  );

  assert.deepEqual(
    visibleSellers.map((seller) => seller.username),
    ["admin-two"]
  );
  assert.equal(
    canSessionAccessSeller(sellers[0], { role: "admin", adminId: 2 }, { primaryAdminId }),
    false
  );
});

test("master sessions can access every seller username", () => {
  const visibleUsernames = [...getAccessibleSellerUsernameSet(
    sellers,
    { role: "master", username: "krishna" },
    { primaryAdminId }
  )];

  assert.deepEqual(
    visibleUsernames,
    ["legacy-owner", "admin-one", "admin-two", "master-only"]
  );
});
