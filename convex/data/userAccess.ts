import { hasExternalRequestsAccess } from "../lib/externalRequestsAccess";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { canAdministerPlatform, isExternalRoleTarget } from "../lib/userRoles";

// Actions resolve the same database-backed authorization as queries/mutations.
export const hasPlatformAdminAccess = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => await canAdministerPlatform(ctx, userId),
});

async function getApprovedExternalUser(ctx: any, userId: string) {
  return await ctx.db
    .query("approvedExternalUsers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
}

export const viewerAccessProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { isAuthenticated: false, kind: "anonymous" as const };

    const approvedExternalUser = await getApprovedExternalUser(ctx, userId);
    const role = await ctx.db.query("userAccessProfiles").withIndex("by_user", q => q.eq("userId", userId)).unique();
    const canAccessQaVisual = role?.platformRole === "super_admin" && !(await isExternalRoleTarget(ctx, userId));
    return {
      canAccessQaVisual,
      isAuthenticated: true,
      canAccessExternalRequests: Boolean(approvedExternalUser) && await hasExternalRequestsAccess(ctx, userId),
      userId,
      kind: approvedExternalUser ? ("external" as const) : ("internal" as const),
      approvedExternalUserId: approvedExternalUser?._id,
    };
  },
});

export const getAccessProfileByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const approvedExternalUser = await getApprovedExternalUser(ctx, args.userId);
    return {
      userId: args.userId,
      kind: approvedExternalUser ? ("external" as const) : ("internal" as const),
      approvedExternalUserId: approvedExternalUser?._id,
    };
  },
});

export const getAccessProfileByThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("chatThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (!thread) return null;

    const approvedExternalUser = await getApprovedExternalUser(
      ctx,
      thread.userId,
    );
    return {
      userId: thread.userId,
      kind: approvedExternalUser ? ("external" as const) : ("internal" as const),
      approvedExternalUserId: approvedExternalUser?._id,
    };
  },
});
