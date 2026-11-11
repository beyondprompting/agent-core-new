import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx,
} from "../_generated/server";
import { requireQaAdmin } from "./access";

const batchSize = 4;

async function currentSnapshot(ctx: QueryCtx, snapshotId: Id<"qaVisualCampaignSnapshots">) {
  const snapshot = await ctx.db.get(snapshotId);
  if (!snapshot) return null;
  const campaign = await ctx.db.get(snapshot.campaignId);
  if (campaign?.status !== "active" || campaign.currentSnapshotId !== snapshotId) return null;
  return { snapshot, campaign };
}

async function scheduleBatch(
  ctx: MutationCtx,
  snapshotId: Id<"qaVisualCampaignSnapshots">,
  offset: number,
  hadErrors: boolean,
): Promise<void> {
  const jobId = await ctx.scheduler.runAfter(0, internal.qaVisual.prepareImages.warmBatch, {
    snapshotId, offset, hadErrors,
  });
  await ctx.db.patch(snapshotId, { imageWarmupJobId: jobId });
}

export async function queueImageWarmup(
  ctx: MutationCtx,
  snapshotId: Id<"qaVisualCampaignSnapshots">,
): Promise<void> {
  const current = await currentSnapshot(ctx, snapshotId);
  if (!current || current.snapshot.imageWarmupComplete) return;
  const jobId = current.snapshot.imageWarmupJobId;
  const job = jobId && await ctx.db.system.get("_scheduled_functions", jobId);
  if (job?.state.kind === "pending" || job?.state.kind === "inProgress") return;
  await scheduleBatch(ctx, snapshotId, 0, false);
}

export const request = mutation({
  args: { snapshotId: v.id("qaVisualCampaignSnapshots") },
  handler: async (ctx, { snapshotId }): Promise<void> => {
    await requireQaAdmin(ctx);
    await queueImageWarmup(ctx, snapshotId);
  },
});

export const batch = internalQuery({
  args: { snapshotId: v.id("qaVisualCampaignSnapshots"), offset: v.number() },
  handler: async (ctx, { snapshotId, offset }) => {
    const current = await currentSnapshot(ctx, snapshotId);
    if (!current) return null;
    const rows = await ctx.db.query("qaVisualCampaignPieces")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshotId).gte("order", offset))
      .take(batchSize + 1);
    return {
      campaign: current.campaign.reviewKey,
      folderId: current.snapshot.deploymentFolderId,
      files: rows.slice(0, batchSize).map(({ file }) => file),
      next: rows[batchSize]?.order,
    };
  },
});

export const advance = internalMutation({
  args: {
    snapshotId: v.id("qaVisualCampaignSnapshots"),
    next: v.optional(v.number()),
    hadErrors: v.boolean(),
  },
  handler: async (ctx, { snapshotId, next, hadErrors }): Promise<void> => {
    if (!await currentSnapshot(ctx, snapshotId)) return;
    if (next !== undefined) {
      await scheduleBatch(ctx, snapshotId, next, hadErrors);
    } else {
      await ctx.db.patch(snapshotId, {
        imageWarmupJobId: undefined,
        imageWarmupComplete: !hadErrors,
      });
    }
  },
});
