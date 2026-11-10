import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx,
} from "../_generated/server";
import { requireQaAdmin } from "./access";
import { campaignPiece, rule } from "./validators";

async function syncIsRunning(ctx: QueryCtx, sync: Doc<"qaVisualCampaigns">["sync"]) {
  if (!sync) return false;
  const job = await ctx.db.system.get("_scheduled_functions", sync.jobId);
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

export async function queueSync(ctx: MutationCtx, campaignId: Id<"qaVisualCampaigns">) {
  const campaign = await ctx.db.get(campaignId);
  if (campaign?.status !== "active") throw new Error("Campaña no disponible.");
  if (await syncIsRunning(ctx, campaign.sync)) return;

  const startedAt = Math.max(Date.now(), (campaign.sync?.startedAt ?? 0) + 1);
  const jobId = await ctx.scheduler.runAfter(0, internal.qaVisual.campaignSync.run, {
    campaignId, startedAt,
  });
  await ctx.db.patch(campaignId, { sync: { startedAt, jobId }, syncError: undefined });
}

export const refresh = mutation({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    await requireQaAdmin(ctx);
    await queueSync(ctx, campaignId);
  },
});

const syncRequest = { campaignId: v.id("qaVisualCampaigns"), startedAt: v.number() };

export const requestedCampaign = internalQuery({
  args: syncRequest,
  handler: async (ctx, { campaignId, startedAt }) => {
    const campaign = await ctx.db.get(campaignId);
    return campaign?.status === "active" && campaign.sync?.startedAt === startedAt
      ? { driveFolderId: campaign.driveFolderId, reviewKey: campaign.reviewKey }
      : null;
  },
});

function findSnapshot(ctx: QueryCtx, campaignId: Id<"qaVisualCampaigns">, fingerprint: string) {
  return ctx.db.query("qaVisualCampaignSnapshots")
    .withIndex("by_campaign_fingerprint", (q) => q.eq("campaignId", campaignId).eq("fingerprint", fingerprint))
    .unique();
}

export const reuse = internalMutation({
  args: { ...syncRequest, fingerprint: v.string() },
  handler: async (ctx, { campaignId, startedAt, fingerprint }) => {
    const campaign = await ctx.db.get(campaignId);
    if (campaign?.status !== "active" || campaign.sync?.startedAt !== startedAt) return true;
    const snapshot = await findSnapshot(ctx, campaignId, fingerprint);
    if (!snapshot) return false;
    await ctx.db.patch(campaignId, {
      currentSnapshotId: snapshot._id, lastSyncedAt: Date.now(), sync: undefined,
    });
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
    if (campaign?.status !== "active" || campaign.sync?.startedAt !== startedAt) return;
    const existing = await findSnapshot(ctx, data.campaignId, data.fingerprint);
    const snapshotId = existing?._id ?? await ctx.db.insert("qaVisualCampaignSnapshots", data);
    if (!existing) {
      await Promise.all(pieces.map((piece, order) =>
        ctx.db.insert("qaVisualCampaignPieces", { snapshotId, order, ...piece }),
      ));
    }
    await ctx.db.patch(campaign._id, {
      currentSnapshotId: snapshotId, lastSyncedAt: Date.now(), sync: undefined,
    });
  },
});

export const fail = internalMutation({
  args: { ...syncRequest, error: v.string() },
  handler: async (ctx, { campaignId, startedAt, error }) => {
    const campaign = await ctx.db.get(campaignId);
    if (campaign?.sync?.startedAt !== startedAt) return;
    await ctx.db.patch(campaignId, { sync: undefined, syncError: error });
  },
});

function fileDetails(source: Doc<"qaVisualSourceDocuments"> | null) {
  return source && { name: source.name, bytes: source.bytes ?? 0, updatedAt: source.updatedAt ?? 0 };
}

export const viewer = query({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    await requireQaAdmin(ctx);
    const id = ctx.db.normalizeId("qaVisualCampaigns", campaignId);
    const campaign = id && await ctx.db.get(id);
    if (!campaign || campaign.status !== "active") return null;

    const syncing = await syncIsRunning(ctx, campaign.sync);
    const syncError = campaign.syncError ?? (campaign.sync && !syncing
      ? "Se interrumpió la importación de Drive. Intentá actualizar de nuevo."
      : undefined);
    const snapshot = campaign.currentSnapshotId && await ctx.db.get(campaign.currentSnapshotId);
    const data = snapshot && snapshot.campaignId === campaign._id ? snapshot : null;
    const [excel, csv, pieces] = data ? await Promise.all([
      ctx.db.get(data.excelDocumentId),
      ctx.db.get(data.csvDocumentId),
      ctx.db.query("qaVisualCampaignPieces")
        .withIndex("by_snapshot", (q) => q.eq("snapshotId", data._id)).collect(),
    ]) : [null, null, []] as const;

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
      pieces: pieces.map(({ file, input }) => ({
        file, production: input.production, requirements: input.requirements ?? [],
        contextKey: input.contextKey,
      })),
    };
  },
});
