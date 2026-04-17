const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSessionRecord,
  findSessionByToken,
  pruneExpiredSessions,
  removeSessionByToken,
  removeSessionsForAccount,
  sessionMatchesAccount,
  toSessionPayload,
} = require("./sessionStore");

test("created sessions can be found by token until they expire", () => {
  const now = new Date("2026-04-17T10:00:00.000Z");
  const created = createSessionRecord(
    {
      role: "seller",
      username: "seller1",
      sellerId: 12,
      sellerName: "Seller One",
    },
    {
      now,
      ttlMs: 60 * 60 * 1000,
    }
  );

  const session = findSessionByToken([created.session], created.token, {
    now: new Date("2026-04-17T10:30:00.000Z"),
  });

  assert.ok(session);
  assert.equal(session.role, "seller");
  assert.equal(session.sellerId, 12);
  assert.equal(toSessionPayload(session, created.token).token, created.token);
});

test("expired sessions are pruned and no longer authenticate", () => {
  const created = createSessionRecord(
    {
      role: "admin",
      username: "office",
      adminId: 2,
    },
    {
      now: new Date("2026-04-17T10:00:00.000Z"),
      ttlMs: 5 * 1000,
    }
  );

  assert.equal(
    findSessionByToken([created.session], created.token, {
      now: new Date("2026-04-17T10:00:10.000Z"),
    }),
    null
  );
  assert.deepEqual(
    pruneExpiredSessions([created.session], {
      now: new Date("2026-04-17T10:00:10.000Z"),
    }),
    []
  );
});

test("session removal can target a token or an account", () => {
  const sellerSession = createSessionRecord({
    role: "seller",
    username: "seller1",
    sellerId: 10,
  });
  const adminSession = createSessionRecord({
    role: "admin",
    username: "admin2",
    adminId: 20,
  });

  const remainingAfterTokenRemoval = removeSessionByToken(
    [sellerSession.session, adminSession.session],
    sellerSession.token
  );
  assert.equal(remainingAfterTokenRemoval.length, 1);
  assert.equal(remainingAfterTokenRemoval[0].role, "admin");

  const remainingAfterAccountRemoval = removeSessionsForAccount(
    [sellerSession.session, adminSession.session],
    {
      role: "admin",
      adminId: 20,
      username: "admin2",
    }
  );
  assert.equal(remainingAfterAccountRemoval.length, 1);
  assert.equal(remainingAfterAccountRemoval[0].role, "seller");
  assert.equal(
    sessionMatchesAccount(adminSession.session, {
      role: "admin",
      adminId: 20,
      username: "admin2",
    }),
    true
  );
});
