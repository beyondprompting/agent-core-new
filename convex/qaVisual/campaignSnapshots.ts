import { publishPiece, humanState } from "./pieces";
import {
  ANALYSIS_POLICY_VERSION,
  structuredRequirements,
} from "./model/contracts";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireQaAdmin } from "./access";
import { findImageCopy } from "./imageCopies";
import { queueImageWarmup } from "./imageWarmup";
import { campaignPiece, rule } from "./validators";
import { importStage } from "./model/importProgress";

export async function syncIsRunning(
  ctx: QueryCtx,
  sync: Doc<"qaVisualCampaigns">["sync"],
) {
  if (!sync) return false;
  const job = await ctx.db.system.get("_scheduled_functions", sync.jobId);
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

export async function queueSync(
  ctx: MutationCtx,
  campaignId: Id<"qaVisualCampaigns">,
  reprocess = false,
) {
  const campaign = await ctx.db.get(campaignId);
  if (campaign?.status !== "active") throw new Error("Campaña no disponible.");
  if (await syncIsRunning(ctx, campaign.sync)) return;

  const startedAt = Math.max(Date.now(), (campaign.sync?.startedAt ?? 0) + 1);
  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.qaVisual.campaignSync.run,
    {
      campaignId,
      startedAt,
      ...(reprocess ? { reprocess: true } : {}),
    },
  );
  await ctx.db.patch(campaignId, {
    sync: { startedAt, jobId, stage: "listing" },
    syncError: undefined,
    syncNeedsSources: undefined,
  });
}

export const refresh = mutation({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    await requireQaAdmin(ctx);
    await queueSync(ctx, campaignId);
  },
});

const syncRequest = {
  campaignId: v.id("qaVisualCampaigns"),
  startedAt: v.number(),
};

export const progress = internalMutation({
  args: { ...syncRequest, stage: importStage, images: v.optional(v.number()) },
  handler: async (ctx, { campaignId, startedAt, stage, images }) => {
    const campaign = await ctx.db.get(campaignId);
    if (campaign?.status !== "active" || campaign.sync?.startedAt !== startedAt)
      return false;
    await ctx.db.patch(campaignId, {
      sync: {
        ...campaign.sync,
        stage,
        ...(images === undefined ? {} : { images }),
      },
    });
    return true;
  },
});

export const requestedCampaign = internalQuery({
  args: syncRequest,
  handler: async (ctx, { campaignId, startedAt }) => {
    const campaign = await ctx.db.get(campaignId);
    return campaign?.status === "active" &&
      campaign.sync?.startedAt === startedAt
      ? {
          driveFolderId: campaign.driveFolderId,
          reviewKey: campaign.reviewKey,
          sourceSelection: campaign.sourceSelection ?? {},
        }
      : null;
  },
});

function findSnapshot(
  ctx: QueryCtx,
  campaignId: Id<"qaVisualCampaigns">,
  fingerprint: string,
) {
  return ctx.db
    .query("qaVisualCampaignSnapshots")
    .withIndex("by_campaign_fingerprint", (q) =>
      q.eq("campaignId", campaignId).eq("fingerprint", fingerprint),
    )
    .unique();
}

export const reuse = internalMutation({
  args: { ...syncRequest, fingerprint: v.string() },
  handler: async (ctx, { campaignId, startedAt, fingerprint }) => {
    const campaign = await ctx.db.get(campaignId);
    if (campaign?.status !== "active" || campaign.sync?.startedAt !== startedAt)
      return true;
    const snapshot = await findSnapshot(ctx, campaignId, fingerprint);
    if (!snapshot) return false;
    const pieces = await ctx.db
      .query("qaVisualCampaignPieces")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
      .collect();
    const activeIds = new Set<string>();
    const present = new Set(pieces.map((piece) => piece.file.driveId));
    for (const piece of pieces)
      if (piece.input.policyVersion === ANALYSIS_POLICY_VERSION)
        activeIds.add(await publishPiece(ctx, campaign, piece._id, present));
    const previous = await ctx.db
      .query("qaVisualPieces")
      .withIndex("by_campaign", (q) =>
        q.eq("campaignId", campaignId).eq("status", "active"),
      )
      .collect();
    for (const piece of previous)
      if (!activeIds.has(piece._id))
        await ctx.db.patch(piece._id, { status: "removed" });
    await ctx.db.patch(campaignId, {
      currentSnapshotId: snapshot._id,
      lastSyncedAt: Date.now(),
      sync: undefined,
    });
    await queueImageWarmup(ctx, snapshot._id);
    return true;
  },
});

export const publish = internalMutation({
  args: {
    ...syncRequest,
    fingerprint: v.string(),
    excelDocumentId: v.id("qaVisualSourceDocuments"),
    csvDocumentId: v.id("qaVisualSourceDocuments"),
    deploymentFolderId: v.string(),
    ruleVersion: v.string(),
    rules: v.array(rule),
    notices: v.array(v.string()),
    pieces: v.array(campaignPiece),
  },
  handler: async (ctx, { startedAt, pieces, ...data }) => {
    const campaign = await ctx.db.get(data.campaignId);
    if (campaign?.status !== "active" || campaign.sync?.startedAt !== startedAt)
      return;
    const existing = await findSnapshot(ctx, data.campaignId, data.fingerprint);
    const snapshotId =
      existing?._id ?? (await ctx.db.insert("qaVisualCampaignSnapshots", data));
    if (!existing) {
      const activeIds = new Set<string>();
      const present = new Set(pieces.map((piece) => piece.file.driveId));
      for (const [order, piece] of pieces.entries()) {
        const itemId = await ctx.db.insert("qaVisualCampaignPieces", {
          snapshotId,
          order,
          ...piece,
        });
        activeIds.add(await publishPiece(ctx, campaign, itemId, present));
      }
      const previousPieces = await ctx.db
        .query("qaVisualPieces")
        .withIndex("by_campaign", (q) =>
          q.eq("campaignId", campaign._id).eq("status", "active"),
        )
        .collect();
      for (const piece of previousPieces)
        if (!activeIds.has(piece._id))
          await ctx.db.patch(piece._id, { status: "removed" });
    }
    await ctx.db.patch(campaign._id, {
      currentSnapshotId: snapshotId,
      lastSyncedAt: Date.now(),
      sync: undefined,
    });
    await queueImageWarmup(ctx, snapshotId);
  },
});

export const fail = internalMutation({
  args: {
    ...syncRequest,
    error: v.string(),
    needsSources: v.optional(v.boolean()),
  },
  handler: async (ctx, { campaignId, startedAt, error, needsSources }) => {
    const campaign = await ctx.db.get(campaignId);
    if (campaign?.sync?.startedAt !== startedAt) return;
    await ctx.db.patch(campaignId, {
      sync: undefined,
      syncError: error,
      syncNeedsSources: needsSources,
    });
  },
});

function fileDetails(source: Doc<"qaVisualSourceDocuments"> | null) {
  return (
    source && {
      name: source.name,
      bytes: source.bytes ?? 0,
      updatedAt: source.updatedAt ?? 0,
    }
  );
}

export const viewer = query({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    await requireQaAdmin(ctx);
    const id = ctx.db.normalizeId("qaVisualCampaigns", campaignId);
    const campaign = id && (await ctx.db.get(id));
    if (!campaign || campaign.status !== "active") return null;

    const syncing = await syncIsRunning(ctx, campaign.sync);
    const syncError =
      campaign.syncError ??
      (campaign.sync && !syncing
        ? "Se interrumpió la importación de Drive. Intentá actualizar de nuevo."
        : undefined);
    const snapshot =
      campaign.currentSnapshotId &&
      (await ctx.db.get(campaign.currentSnapshotId));
    const data =
      snapshot && snapshot.campaignId === campaign._id ? snapshot : null;
    const [excel, csv, pieces] = data
      ? await Promise.all([
          ctx.db.get(data.excelDocumentId),
          ctx.db.get(data.csvDocumentId),
          ctx.db
            .query("qaVisualCampaignPieces")
            .withIndex("by_snapshot", (q) => q.eq("snapshotId", data._id))
            .collect(),
        ])
      : ([null, null, []] as const);

    return {
      campaignId: campaign._id,
      campaignName: campaign.name,
      syncing,
      syncError,
      lastSyncedAt: campaign.lastSyncedAt,
      snapshotId: data?._id,
      matrix: fileDetails(excel),
      csv: fileDetails(csv),
      notices: data?.notices ?? [],
      parserOutdated: pieces.some(
        (p) => p.input.policyVersion !== ANALYSIS_POLICY_VERSION || !p.pieceId,
      ),
      pieces: await Promise.all(
        pieces.map(async ({ file, input, pieceId, pieceVersionId }) => {
          const identity = pieceId ? await ctx.db.get(pieceId) : null;
          const version = pieceVersionId
            ? await ctx.db.get(pieceVersionId)
            : null;
          const decision = version?.currentDecisionId
            ? await ctx.db.get(version.currentDecisionId)
            : null;
          const copy = version?.copyId
            ? await ctx.db.get(version.copyId)
            : await findImageCopy(ctx, {
                campaign: campaign.reviewKey,
                id: file.driveId,
                version: file.driveVersion,
              });
          return {
            file,
            production: input.production,
            requirements: structuredRequirements(input),
            pieceId,
            pieceVersionId,
            version: version?.number ?? 1,
            versions: identity?.versionCount ?? 1,
            openThreads: version?.openThreads ?? 0,
            threadCount: version?.threadCount ?? 0,
            humanStatus: version
              ? humanState(version, decision)
              : ("Pendiente" as const),
            issues: input.issues ?? [],
            contextKey: input.contextKey,
            thumbnailReady: Boolean(copy?.files),
          };
        }),
      ),
    };
  },
});

export const storedSources = internalQuery({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get(campaignId);
    const snapshot =
      campaign?.currentSnapshotId &&
      (await ctx.db.get(campaign.currentSnapshotId));
    if (!campaign || !snapshot) return null;
    const excel = await ctx.db.get(snapshot.excelDocumentId),
      csv = await ctx.db.get(snapshot.csvDocumentId);
    if (!excel || !csv) return null;
    const pieces = await ctx.db
      .query("qaVisualCampaignPieces")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
      .collect();
    return {
      campaignName: campaign.name,
      snapshot,
      excel,
      csv,
      files: pieces.map((p) => p.file),
    };
  },
});
