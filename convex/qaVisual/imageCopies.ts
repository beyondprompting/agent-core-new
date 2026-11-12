import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireQaAdmin } from "./access";
import { snapshot } from "./validators";

const key = { campaign: v.string(), id: v.string(), version: v.string() };
const leaseMs = 90_000;

export function findImageCopy(
  ctx: QueryCtx,
  { campaign, id, version }: { campaign: string; id: string; version: string },
) {
  return ctx.db.query("qaVisualImageCopies")
    .withIndex("by_version", (q) => q.eq("campaign", campaign).eq("driveId", id).eq("driveVersion", version))
    .unique();
}

type Claim =
  | { state: "ready" | "claimed"; copyId: Id<"qaVisualImageCopies"> }
  | { state: "busy" };

export const claim = internalMutation({
  args: { ...key, token: v.string() },
  handler: async (ctx, { token, ...file }): Promise<Claim> => {
    const copy = await findImageCopy(ctx, file);
    if (copy?.files) return { state: "ready", copyId: copy._id };
    if (copy?.lease && copy.lease.expiresAt > Date.now() && copy.lease.token !== token)
      return { state: "busy" };

    const lease = { token, expiresAt: Date.now() + leaseMs };
    if (copy) {
      await ctx.db.patch(copy._id, { lease });
      return { state: "claimed", copyId: copy._id };
    }
    const copyId = await ctx.db.insert("qaVisualImageCopies", {
      campaign: file.campaign, driveId: file.id, driveVersion: file.version, lease,
    });
    return { state: "claimed", copyId };
  },
});

export const finish = internalMutation({
  args: {
    copyId: v.id("qaVisualImageCopies"),
    token: v.string(),
    files: v.object({ thumbnailId: v.id("_storage"), analysisId: v.id("_storage"), snapshot }),
  },
  handler: async (ctx, { copyId, token, files }): Promise<boolean> => {
    const copy = await ctx.db.get(copyId);
    if (copy?.files?.analysisId === files.analysisId) return true;
    if (copy?.lease?.token !== token) return false;
    await ctx.db.patch(copyId, { files, lease: undefined });
    return true;
  },
});

export const release = internalMutation({
  args: { copyId: v.id("qaVisualImageCopies"), token: v.string() },
  handler: async (ctx, { copyId, token }) => {
    const copy = await ctx.db.get(copyId);
    if (copy?.lease?.token === token) await ctx.db.patch(copyId, { lease: undefined });
  },
});

export const storedFiles = internalQuery({
  args: { copyId: v.id("qaVisualImageCopies") },
  handler: async (ctx, { copyId }) => (await ctx.db.get(copyId))?.files ?? null,
});

export const mediaStorage = internalQuery({
  args: {
    campaignId: v.string(), id: v.string(), version: v.string(),
    variant: v.union(v.literal("thumbnail"), v.literal("analysis")),
  },
  handler: async (ctx, { campaignId, id, version, variant }) => {
    await requireQaAdmin(ctx);
    const normalized = ctx.db.normalizeId("qaVisualCampaigns", campaignId);
    const campaign = normalized && await ctx.db.get(normalized);
    if (!campaign || campaign.status !== "active" || !campaign.currentSnapshotId) return null;
    const snapshotId = campaign.currentSnapshotId;
    const piece = await ctx.db.query("qaVisualCampaignPieces")
      .withIndex("by_drive_version", (q) => q.eq("snapshotId", snapshotId)
        .eq("file.driveId", id).eq("file.driveVersion", version))
      .first();
    if (!piece) return null;
    const copy = await findImageCopy(ctx, { campaign: campaign.reviewKey, id, version });
    return (variant === "analysis" ? copy?.files?.analysisId : copy?.files?.thumbnailId) ?? null;
  },
});
