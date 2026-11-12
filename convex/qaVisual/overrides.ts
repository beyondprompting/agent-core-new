import { ConvexError, v } from "convex/values";
import {
  mutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { requireCampaign } from "./access";
import { queueSync } from "./campaignSnapshots";
import type { Id } from "../_generated/dataModel";
import { normalize, pieceKey } from "./model/normalize";

async function editableCampaign(
  ctx: MutationCtx,
  campaignId: Id<"qaVisualCampaigns">,
) {
  const access = await requireCampaign(ctx, campaignId);
  const jobId = access.campaign.sync?.jobId;
  const job = jobId && (await ctx.db.system.get(jobId));
  if (job && (job.state.kind === "pending" || job.state.kind === "inProgress"))
    throw new ConvexError(
      "Esperá a que termine la actualización antes de confirmar un vínculo.",
    );
  return access;
}
export const list = internalQuery({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db
      .query("qaVisualLinkOverrides")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .take(1000);
    return rows
      .filter((r) => !r.revokedAt)
      .map((r) => ({
        kind: r.kind,
        ...(r.pieceKey ? { pieceKey: r.pieceKey } : {}),
        ...(r.from ? { from: r.from } : {}),
        ...(r.to ? { to: r.to } : {}),
        ...(r.row ? { row: r.row } : {}),
        ...(r.ordinal ? { ordinal: r.ordinal } : {}),
        author: String(r.createdBy),
        at: r._creationTime,
      }));
  },
});
export const linkOffer = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    pieceId: v.id("qaVisualPieces"),
    row: v.string(),
    ordinal: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, campaign } = await editableCampaign(ctx, args.campaignId);
    const piece = await ctx.db.get(args.pieceId);
    const current =
      piece?.currentImportPieceId &&
      (await ctx.db.get(piece.currentImportPieceId));
    if (
      !piece ||
      piece.campaignId !== campaign._id ||
      !current ||
      !current.input.issues?.some((issue) =>
        issue.candidates?.some(
          (c) => c.row === args.row && c.ordinal === args.ordinal,
        ),
      )
    )
      throw new ConvexError(
        "La oferta ya no es candidata para esta pieza. Actualizá los datos.",
      );
    if (!args.note.trim() || args.note.length > 4000)
      throw new ConvexError("Indicá el motivo de la vinculación.");
    const previous = await ctx.db
      .query("qaVisualLinkOverrides")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    for (const row of previous)
      if (
        !row.revokedAt &&
        row.kind === "offerLink" &&
        row.pieceKey === pieceKey(current.file.name)
      )
        await ctx.db.patch(row._id, { revokedAt: Date.now() });
    await ctx.db.insert("qaVisualLinkOverrides", {
      campaignId: campaign._id,
      kind: "offerLink",
      pieceKey: pieceKey(current.file.name),
      row: args.row,
      ordinal: args.ordinal,
      note: args.note.trim(),
      createdBy: user,
    });
    await queueSync(ctx, campaign._id, true);
  },
});
export const confirmAlias = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    from: v.string(),
    to: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await editableCampaign(ctx, args.campaignId);
    if (
      !args.note.trim() ||
      !normalize(args.from) ||
      !normalize(args.to) ||
      Math.max(args.note.length, args.from.length, args.to.length) > 4000
    )
      throw new ConvexError("Completá la equivalencia y su motivo.");
    await ctx.db.insert("qaVisualLinkOverrides", {
      campaignId: args.campaignId,
      kind: "productAlias",
      from: normalize(args.from),
      to: normalize(args.to),
      note: args.note.trim(),
      createdBy: user,
    });
    await queueSync(ctx, args.campaignId, true);
  },
});
export const revoke = mutation({
  args: { overrideId: v.id("qaVisualLinkOverrides") },
  handler: async (ctx, { overrideId }) => {
    const row = await ctx.db.get(overrideId);
    if (!row) throw new ConvexError("Confirmación no disponible.");
    await editableCampaign(ctx, row.campaignId);
    if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    await queueSync(ctx, row.campaignId, true);
  },
});
