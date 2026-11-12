import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
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
  if (access.campaign.activeImportId)
    throw new ConvexError(
      "Esperá a que termine la importación antes de confirmar un vínculo.",
    );
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
      .filter(
        (r) =>
          !r.revokedAt && (r.kind === "productAlias" || r.kind === "offerLink"),
      )
      .map((r) => ({
        kind: r.kind as "productAlias" | "offerLink",
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
    const { user } = await editableCampaign(ctx, row.campaignId);
    if (!row.revokedAt)
      await ctx.db.patch(row._id, { revokedAt: Date.now(), revokedBy: user });
    await queueSync(ctx, row.campaignId, true);
  },
});

/** Only the published inventory is eligible for human duplicate resolution. */
export const duplicateOptions = query({
  args: { pieceId: v.id("qaVisualPieces") },
  handler: async (ctx, { pieceId }) => {
    const piece = await ctx.db.get(pieceId);
    if (!piece || piece.status !== "active") return null;
    const { campaign } = await requireCampaign(ctx, piece.campaignId);
    if (!campaign.currentImportId) return null;
    const imported = await ctx.db.get(campaign.currentImportId);
    if (!imported || imported.status !== "ready") return null;
    const base = piece.baseKey ?? piece.fileKey;
    const groupIds = new Set(
      (
        await ctx.db
          .query("qaVisualPieces")
          .withIndex("by_campaign_file_key", (q) =>
            q.eq("campaignId", campaign._id).eq("fileKey", base),
          )
          .collect()
      ).map((p) => p._id),
    );
    const members = imported.manifest.filter((m) => groupIds.has(m.pieceId));
    if (members.length < 2) return null;
    const resolutions = (
      await ctx.db
        .query("qaVisualLinkOverrides")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .collect()
    ).filter((o) => !o.revokedAt && o.baseKey === base);
    return {
      campaignId: campaign._id,
      baseKey: base,
      importId: imported._id,
      busy: Boolean(campaign.activeImportId),
      currentDriveFileId: piece.driveFileId,
      members: members.map((m) => ({
        driveFileId: m.driveFileId,
        name: m.display.fileName,
        createdAt: m.driveCreatedAt,
        disposition: m.disposition,
      })),
      resolutions: resolutions.map((o) => ({
        id: o._id,
        kind: o.kind,
        note: o.note,
      })),
    };
  },
});
export const resolveDuplicate = mutation({
  args: {
    pieceId: v.id("qaVisualPieces"),
    expectedImportId: v.id("qaVisualImports"),
    kind: v.union(v.literal("keepDuplicate"), v.literal("mergeAsVersion")),
    otherDriveFileId: v.optional(v.string()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const piece = await ctx.db.get(args.pieceId);
    if (!piece || piece.status !== "active")
      throw new ConvexError("La pieza ya no está disponible.");
    const { campaign, user } = await editableCampaign(ctx, piece.campaignId);
    if (campaign.currentImportId !== args.expectedImportId)
      throw new ConvexError(
        "La importación cambió. Volvé a revisar los duplicados.",
      );
    const imported = await ctx.db.get(args.expectedImportId);
    if (!imported || imported.status !== "ready")
      throw new ConvexError("Importación no disponible.");
    const baseKey = piece.baseKey ?? piece.fileKey;
    const groupIds = new Set(
      (
        await ctx.db
          .query("qaVisualPieces")
          .withIndex("by_campaign_file_key", (q) =>
            q.eq("campaignId", campaign._id).eq("fileKey", baseKey),
          )
          .collect()
      ).map((p) => p._id),
    );
    const group = imported.manifest
      .filter((m) => groupIds.has(m.pieceId))
      .sort(
        (a, b) =>
          a.driveCreatedAt - b.driveCreatedAt ||
          a.driveFileId.localeCompare(b.driveFileId),
      );
    if (
      group.length < 2 ||
      !group.some((m) => m.driveFileId === piece.driveFileId)
    )
      throw new ConvexError("Esta pieza no tiene duplicados para resolver.");
    if (!args.note.trim() || args.note.length > 4000)
      throw new ConvexError("Indicá el motivo de la confirmación.");
    const pair = group.filter(
      (m) =>
        m.driveFileId === piece.driveFileId ||
        m.driveFileId === args.otherDriveFileId,
    );
    if (
      args.kind === "mergeAsVersion" &&
      (pair.length !== 2 || pair[1].driveFileId !== piece.driveFileId)
    )
      throw new ConvexError(
        "Elegí una entrega anterior según su fecha de creación en Drive.",
      );
    const previous = await ctx.db
      .query("qaVisualLinkOverrides")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    for (const row of previous)
      if (
        !row.revokedAt &&
        row.baseKey === baseKey &&
        (args.kind === "keepDuplicate" ||
          row.kind === "keepDuplicate" ||
          row.newerDriveFileId === piece.driveFileId)
      )
        await ctx.db.patch(row._id, { revokedAt: Date.now(), revokedBy: user });
    const id = await ctx.db.insert("qaVisualLinkOverrides", {
      campaignId: campaign._id,
      kind: args.kind,
      baseKey,
      ...(args.kind === "keepDuplicate"
        ? { keepDriveFileId: piece.driveFileId }
        : {
            olderDriveFileId: pair[0].driveFileId,
            newerDriveFileId: pair[1].driveFileId,
          }),
      note: args.note.trim(),
      createdBy: user,
    });
    await queueSync(ctx, campaign._id, true);
    return id;
  },
});
