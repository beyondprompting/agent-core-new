import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { isExternalRoleTarget } from "../lib/userRoles";

/** Backend switch: QA_VISUAL_ENABLED=false in a Convex deployment turns every QA function off. */
export function qaVisualDisabled() {
  return process.env.QA_VISUAL_ENABLED === "false";
}

export async function requireQaAdmin(ctx: QueryCtx) {
  if (qaVisualDisabled()) throw new Error("QA Visual no está habilitado");
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

export async function requireCampaign(
  ctx: QueryCtx,
  campaignId: Id<"qaVisualCampaigns">,
) {
  const user = await requireQaAdmin(ctx);
  const campaign = await ctx.db.get(campaignId);
  if (!campaign || campaign.status !== "active")
    throw new ConvexError({
      code: "campaign_unavailable",
      message: "La campaña ya no está disponible.",
    });
  return { user, campaign };
}
export async function requireVersion(
  ctx: QueryCtx,
  pieceVersionId: Id<"qaVisualPieceVersions">,
) {
  const version = await ctx.db.get(pieceVersionId);
  if (!version || version.status === "staged")
    throw new ConvexError({
      code: "version_unavailable",
      message: "La versión ya no está disponible.",
    });
  const access = await requireCampaign(ctx, version.campaignId);
  return { ...access, version };
}
