import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { isExternalRoleTarget } from "../lib/userRoles";

export async function requireQaAdmin(ctx: QueryCtx) {
  const user = await getAuthUserId(ctx);
  if (!user) throw new Error("Acceso denegado");
  const role = await ctx.db
    .query("userAccessProfiles")
    .withIndex("by_user", (q) => q.eq("userId", user))
    .unique();
  if (
    role?.platformRole !== "super_admin" ||
    (await isExternalRoleTarget(ctx, user))
  ) {
    throw new Error("Acceso denegado");
  }
  return user;
}

export const viewerIsQaAdmin = internalQuery({
  args: {},
  handler: async (ctx) => Boolean(await requireQaAdmin(ctx)),
});
