import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { canUserAccessInternalUserAdmin } from "./internalUserAdminAccess";

// Check email too: an approved external may not have completed the async link yet.
export async function isExternalRoleTarget(ctx: QueryCtx, userId: Id<"users">) {
  if (await ctx.db.query("approvedExternalUsers").withIndex("by_user", q => q.eq("userId", userId)).unique()) return true;
  const user = await ctx.db.get(userId);
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email && await ctx.db.query("approvedExternalUsers").withIndex("by_email", q => q.eq("email", email)).unique());
}

// Deliberately uses the existing allowlist. Stored platform roles are inert.
export async function requireUserRoleAdmin(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !canUserAccessInternalUserAdmin(String(userId)) || await isExternalRoleTarget(ctx, userId)) {
    throw new Error("No tienes permisos para administrar roles de usuarios.");
  }
  return userId;
}

export function normalizeWorkRole(value: string | undefined) {
  const role = value?.trim();
  if (role && role.length > 100) throw new Error("El rol de trabajo admite hasta 100 caracteres.");
  return role || undefined;
}

// Converting/linking an external must not leave a dormant internal admin role.
// Only new role metadata is removed; existing access assignments stay untouched.
export async function removeInternalRoleProfileForExternal(
  ctx: MutationCtx,
  userId: Id<"users">,
  approvedExternalUserId: Id<"approvedExternalUsers">,
  actorId: Id<"users">,
) {
  const profile = await ctx.db.query("userAccessProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!profile) return;
  await ctx.db.delete(profile._id);
  await ctx.db.insert("userRoleAuditLog", {
    actorId, targetUserId: userId, approvedExternalUserId,
    before: JSON.stringify({ platformRole: profile.platformRole, workRole: profile.workRole }),
    after: JSON.stringify({ platformRole: "user" }), createdAt: Date.now(),
  });
}
