"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { prepareDriveImage } from "./preview.node";

async function attachPreview(
  ctx: ActionCtx,
  reviewId: Id<"qaVisualReviews">,
  preview: Awaited<ReturnType<typeof prepareDriveImage>>,
) {
  const storageId = await ctx.storage.store(new Blob([preview.bytes], { type: "image/jpeg" }));
  try {
    await ctx.runMutation(internal.qaVisual.runs.attach, {
      reviewId, asset: { storageId, snapshot: preview.snapshot },
    });
  } catch (error) {
    const attached = await ctx.runQuery(internal.qaVisual.runs.hasStorage, { storageId }).catch(() => true);
    if (!attached) await ctx.storage.delete(storageId);
    throw error;
  }
}

export const prepare = internalAction({
  args: {
    runId: v.id("qaVisualRuns"),
    folderId: v.string(),
    items: v.array(v.object({ reviewId: v.id("qaVisualReviews"), id: v.string(), version: v.string() })),
  },
  handler: async (ctx, { runId, folderId, items }): Promise<void> => {
    for (let index = 0; index < items.length; index += 4) {
      await Promise.allSettled(items.slice(index, index + 4).map(async ({ reviewId, id, version }) => {
        try {
          await attachPreview(ctx, reviewId, await prepareDriveImage(folderId, id, version));
        } catch (error) {
          console.warn("QA Visual: no se pudo preparar una pieza de Google Drive", reviewId, error);
          await ctx.runMutation(internal.qaVisual.runs.attach, { reviewId });
        }
      }));
    }
    await ctx.runMutation(internal.qaVisual.runs.expirePreparation, { runId });
  },
});
