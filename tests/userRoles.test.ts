import test from "node:test";
import assert from "node:assert/strict";
import { setInternalUserRoles, viewerCanAccessInternalUserAdmin } from "../convex/data/internalUserAdmin";
import { setExternalUserRoles, viewerCanAccessExternalUserAdmin } from "../convex/data/externalUserAdmin";
import { viewerCanAccessAnalytics } from "../convex/data/analytics";
import { viewerAccessProfile } from "../convex/data/userAccess";
import { INTERNAL_USER_ADMIN_ALLOWED_USER_IDS } from "../convex/lib/internalUserAdminAccess";
import { linkApprovedExternalUser } from "../convex/data/approvedExternalUsers";

function fixture() {
  const adminId = INTERNAL_USER_ADMIN_ALLOWED_USER_IDS[0];
  const rows = new Map<string, any>();
  let counter = 0;
  let actor: string | null = adminId;
  const put = (table: string, row: any) => rows.set(row._id, { ...row, _table: table });
  put("users", { _id: adminId, email: "admin@example.com" });
  put("users", { _id: "internal", email: "internal@example.com" });
  put("users", { _id: "external", email: "external@example.com" });
  put("approvedExternalUsers", { _id: "approved", userId: "external", email: "external@example.com" });
  put("clientUserAssignments", { _id: "assignment", userId: "external", clientId: "client" });
  const ctx: any = {
    auth: { getUserIdentity: async () => actor ? { subject: `${actor}|session` } : null },
    db: {
      get: async (id: string) => rows.get(id) ?? null,
      delete: async (id: string) => { rows.delete(id); },
      insert: async (table: string, row: any) => { const id = `insert-${++counter}`; put(table, { _id: id, ...row }); return id; },
      patch: async (id: string, patch: any) => { for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete rows.get(id)[key]; else rows.get(id)[key] = value; } },
      query: (table: string) => {
        const filters: Array<(row: any) => boolean> = [];
        const builder: any = { eq: (key: string, value: any) => { filters.push(row => row[key] === value); return builder; } };
        const selected = () => [...rows.values()].filter(row => row._table === table && filters.every(f => f(row)));
        const q: any = { withIndex: (_: string, build: any) => { build(builder); return q; }, unique: async () => { assert.ok(selected().length <= 1); return selected()[0] ?? null; }, collect: async () => selected() };
        return q;
      },
    },
  };
  return { ctx, rows, put, adminId, as: (id: string | null) => { actor = id; }, call: (fn: any, args: any = {}) => fn._handler(ctx, args), table: (name: string) => [...rows.values()].filter(row => row._table === name) };
}

test("saving a future super_admin does not grant any legacy administration or analytics access", async () => {
  const f = fixture();
  await f.call(setInternalUserRoles, { targetUserId: "internal", platformRole: "super_admin", workRole: "  " });
  assert.equal(f.table("userAccessProfiles")[0].platformRole, "super_admin");
  assert.equal(f.table("userAccessProfiles")[0].workRole, undefined);
  f.as("internal");
  for (const fn of [viewerCanAccessInternalUserAdmin, viewerCanAccessExternalUserAdmin, viewerCanAccessAnalytics]) {
    assert.equal((await f.call(fn)).canAccess, false);
  }
  await assert.rejects(f.call(setInternalUserRoles, { targetUserId: "internal", platformRole: "admin" }), /permisos/);
  f.as(f.adminId);
  assert.equal((await f.call(viewerCanAccessInternalUserAdmin)).canAccess, true);
});

test("no external, including an allowlisted or not-yet-linked external, can receive an internal role", async () => {
  for (const platformRole of ["user", "admin", "super_admin"]) {
    for (const linked of [true, false]) {
      const f = fixture();
      if (!linked) delete f.rows.get("approved").userId;
      await assert.rejects(f.call(setInternalUserRoles, { targetUserId: "external", platformRole }), /externo/);
      assert.equal(f.table("userAccessProfiles").length, 0);
      assert.equal(f.table("userRoleAuditLog").length, 0);
    }
  }
  const f = fixture();
  f.put("approvedExternalUsers", { _id: "external-admin", userId: f.adminId, email: "admin@example.com", isCoordinator: true });
  for (const [fn, args] of [
    [setInternalUserRoles, { targetUserId: "internal", platformRole: "super_admin" }],
    [setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: true }],
  ] as const) await assert.rejects(f.call(fn, args), /permisos/);
});

test("anonymous, regular internal and external users cannot change anyone's roles", async () => {
  const f = fixture();
  const before = structuredClone([...f.rows]);
  for (const id of [null, "internal", "external"]) {
    f.as(id);
    await assert.rejects(f.call(setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: true }), /permisos/);
    await assert.rejects(f.call(setInternalUserRoles, { targetUserId: "internal", platformRole: "admin" }), /permisos/);
  }
  assert.deepEqual([...f.rows], before);
});

test("coordinator metadata preserves kind, feature visibility and assignments, including before first login", async () => {
  const f = fixture();
  f.as("external");
  const beforeAccess = await f.call(viewerAccessProfile);
  const assignments = structuredClone(f.table("clientUserAssignments"));
  f.as(f.adminId);
  await f.call(setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: true, workRole: "" });
  f.as("external");
  assert.deepEqual(await f.call(viewerAccessProfile), beforeAccess);
  assert.deepEqual(f.table("clientUserAssignments"), assignments);
  assert.equal(f.rows.get("approved").isCoordinator, true);
  assert.equal(f.rows.get("approved").workRole, undefined);
  assert.equal(f.table("userAccessProfiles").length, 0);
  for (const fn of [viewerCanAccessInternalUserAdmin, viewerCanAccessExternalUserAdmin, viewerCanAccessAnalytics]) assert.equal((await f.call(fn)).canAccess, false);
  f.as(f.adminId);
  f.put("approvedExternalUsers", { _id: "invited", email: "invited@example.com" });
  await f.call(setExternalUserRoles, { approvedExternalUserId: "invited", isCoordinator: true });
  assert.equal(f.rows.get("invited").isCoordinator, true);
  assert.equal(f.rows.get("invited").userId, undefined);
});

test("role updates audit actor and before/after values, remain idempotent and allow clearing work roles", async () => {
  const f = fixture();
  const args = { targetUserId: "internal", platformRole: "admin", workRole: " Cuentas " };
  await f.call(setInternalUserRoles, args);
  await f.call(setInternalUserRoles, args);
  assert.equal(f.table("userAccessProfiles").length, 1);
  assert.equal(f.table("userRoleAuditLog").length, 1);
  const log = f.table("userRoleAuditLog")[0];
  assert.equal(log.actorId, f.adminId);
  assert.deepEqual(JSON.parse(log.before), { platformRole: "user" });
  assert.deepEqual(JSON.parse(log.after), { platformRole: "admin", workRole: "Cuentas" });
  await f.call(setInternalUserRoles, { ...args, workRole: "" });
  assert.equal(f.table("userAccessProfiles")[0].workRole, undefined);
  await f.call(setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: true });
  await f.call(setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: false });
  assert.equal(f.rows.get("approved").isCoordinator, false);
  const externalLog = f.table("userRoleAuditLog").at(-1);
  assert.equal(externalLog.approvedExternalUserId, "approved");
  assert.deepEqual(JSON.parse(externalLog.after), { isCoordinator: false });
});

test("invalid targets and oversized work roles do not create profiles or change access", async () => {
  const f = fixture();
  const before = structuredClone([...f.rows]);
  await assert.rejects(f.call(setInternalUserRoles, { targetUserId: "missing", platformRole: "admin" }));
  await assert.rejects(f.call(setExternalUserRoles, { approvedExternalUserId: "missing", isCoordinator: true }));
  await assert.rejects(f.call(setInternalUserRoles, { targetUserId: "internal", platformRole: "admin", workRole: "x".repeat(101) }));
  await assert.rejects(f.call(setExternalUserRoles, { approvedExternalUserId: "approved", isCoordinator: true, workRole: "x".repeat(101) }));
  assert.deepEqual([...f.rows], before);
});

test("linking an external removes any previously stored internal role, retaining coordinator metadata and assignments", async () => {
  for (const alreadyLinked of [false, true]) {
    const f = fixture();
    f.put("userAccessProfiles", { _id: "old-profile", userId: "external", platformRole: "super_admin", workRole: "Cuentas" });
    f.rows.get("approved").isCoordinator = true;
    f.rows.get("approved").workRole = "";
    if (!alreadyLinked) delete f.rows.get("approved").userId;
    const assignments = structuredClone(f.table("clientUserAssignments"));
    await f.call(linkApprovedExternalUser, { userId: "external", email: "external@example.com" });
    assert.equal(f.table("userAccessProfiles").length, 0);
    assert.equal(f.rows.get("approved").userId, "external");
    assert.equal(f.rows.get("approved").isCoordinator, true);
    assert.deepEqual(f.table("clientUserAssignments"), assignments);
    assert.equal(f.table("userRoleAuditLog").length, 1);
    await f.call(linkApprovedExternalUser, { userId: "external", email: "external@example.com" });
    assert.equal(f.table("userRoleAuditLog").length, 1);
  }
});
