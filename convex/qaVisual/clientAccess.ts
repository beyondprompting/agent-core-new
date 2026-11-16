import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isExternalRoleTarget } from "../lib/userRoles";
import { externalPieceRole } from "../lib/externalPieceRoles";
import { qaVisualDisabled } from "./access";

/**
 * Client portal access (§23.6). External users with a piece role (workRole pieceReview or
 * pieceApproval) see every campaign with client review enabled of the client they are
 * assigned to (and brand, when the campaign has one). Only pieceApproval can approve.
 * Internal QA admins can open the portal in read-only preview mode.
 */
const notFound = () =>
  new ConvexError({
    code: "not_found",
    message: "No encontramos esta revisión o ya no tenés acceso.",
  });

export type PortalMode = "client" | "preview";

async function isQaAdmin(ctx: QueryCtx, userId: Id<"users">) {
  const role = await ctx.db
    .query("userAccessProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return (
    role?.platformRole === "super_admin" &&
    !(await isExternalRoleTarget(ctx, userId))
  );
}

export async function isExternalUser(ctx: QueryCtx, userId: Id<"users">) {
  return Boolean(await externalUser(ctx, userId));
}

function externalUser(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("approvedExternalUsers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/** Piece role of an external user: only these users see the portal (not every external). */
export async function externalPieceRoleOf(ctx: QueryCtx, userId: Id<"users">) {
  return externalPieceRole((await externalUser(ctx, userId))?.workRole);
}

export async function assignedToCampaignClient(
  ctx: QueryCtx,
  userId: Id<"users">,
  campaign: Doc<"qaVisualCampaigns">,
) {
  if (!campaign.client) return false;
  const assignments = await ctx.db
    .query("clientUserAssignments")
    .withIndex("by_client_and_user", (q) =>
      q.eq("clientId", campaign.client!.clientId).eq("userId", userId),
    )
    .take(50);
  // Full-client assignments always apply; brand assignments only for that brand.
  return assignments.some(
    (a) => !a.brandId || a.brandId === campaign.client!.brandId,
  );
}

export async function portalViewer(ctx: QueryCtx) {
  if (qaVisualDisabled()) return null;
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  if (await isQaAdmin(ctx, userId))
    return { userId, mode: "preview" as PortalMode, role: null };
  // Externals without a piece role keep only chat and briefs.
  const role = await externalPieceRoleOf(ctx, userId);
  if (role) return { userId, mode: "client" as PortalMode, role };
  return null;
}

export async function requireClientCampaign(
  ctx: QueryCtx,
  campaignId: Id<"qaVisualCampaigns">,
) {
  const viewer = await portalViewer(ctx);
  const campaign = await ctx.db.get(campaignId);
  if (
    !viewer ||
    !campaign ||
    campaign.status !== "active" ||
    !campaign.client ||
    !campaign.clientReview?.enabled
  )
    throw notFound();
  if (
    viewer.mode === "client" &&
    !(await assignedToCampaignClient(ctx, viewer.userId, campaign))
  )
    throw notFound();
  return {
    user: viewer.userId,
    mode: viewer.mode,
    campaign,
    canComment: viewer.mode === "client",
    // Approval is a per-person role; there is no per-campaign approver list for now.
    canApprove: viewer.mode === "client" && viewer.role === "pieceApproval",
  };
}

export async function requireClientItem(
  ctx: QueryCtx,
  itemId: Id<"qaVisualDeliveryItems">,
) {
  const item = await ctx.db.get(itemId);
  if (!item || item.status === "withdrawn") throw notFound();
  const access = await requireClientCampaign(ctx, item.campaignId);
  return { ...access, item };
}

export function requireClientWriter(access: { canComment: boolean }) {
  if (!access.canComment)
    throw new ConvexError({
      code: "preview_only",
      message: "Estás viendo la vista previa del cliente. Solo el cliente puede comentar o decidir.",
    });
}

/** Name shown to the client: agency label for internal people, first name for client people. */
export async function portalAuthor(
  ctx: QueryCtx,
  campaign: Doc<"qaVisualCampaigns">,
  authorId: Id<"users">,
  authorKind: "internal" | "client" | undefined,
  viewerId: Id<"users">,
) {
  if (authorId === viewerId) return { name: "Vos", kind: "client" as const };
  const user = await ctx.db.get(authorId);
  const first = (user?.name || user?.email || "").split(/[\s@]/)[0];
  if (authorKind === "client")
    return { name: first || "Cliente", kind: "client" as const };
  const label = campaign.clientReview?.agencyLabel || "Agencia";
  return {
    name: first ? `${label} · ${first}` : label,
    kind: "agency" as const,
  };
}
