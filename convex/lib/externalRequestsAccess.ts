import { clientConfig } from "../../config/tenant.config";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Categories do not restrict this feature: any assignment to the enabled client qualifies.
export async function hasExternalRequestsAccess(ctx: QueryCtx, userId: Id<"users">) {
  const configured = clientConfig.ui.externalRequestsClientId.trim();
  if (!configured) return false;
  const clientId = ctx.db.normalizeId("corClients", configured);
  if (!clientId) return false;
  const external = await ctx.db.query("approvedExternalUsers").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!external) return false;
  const assignment = await ctx.db.query("clientUserAssignments").withIndex("by_client_and_user", q => q.eq("clientId", clientId).eq("userId", userId)).first();
  return Boolean(assignment);
}

export async function canViewExternalRequest(ctx: QueryCtx, userId: Id<"users">, task: Doc<"tasks">) {
  if (task.source !== "external" || task.createdBy !== String(userId) || task.convexStatus === "deleted") return false;
  if (!(await hasExternalRequestsAccess(ctx, userId))) return false;
  return await isRequestsClientTask(ctx, task);
}

export async function isRequestsClientTask(ctx: QueryCtx, task: Doc<"tasks">) {
  const configured = clientConfig.ui.externalRequestsClientId.trim();
  if (!configured) return false;
  let clientId = task.clientId;
  if (task.clientBrandId) clientId = (await ctx.db.get(task.clientBrandId))?.clientId;
  if (!clientId && task.corClientId !== undefined) clientId = (await ctx.db.query("corClients").withIndex("by_corClientId", q => q.eq("corClientId", task.corClientId!)).unique())?._id;
  return String(clientId) === configured;
}
