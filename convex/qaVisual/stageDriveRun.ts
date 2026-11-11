"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { ensureImageCopies } from "./imagePreparation.node";

export const prepare = internalAction({
  args: {
    runId: v.id("qaVisualRuns"),
    folderId: v.string(),
    items: v.array(v.object({ reviewId: v.id("qaVisualReviews"), id: v.string(), version: v.string() })),
  },
  handler: async (ctx, { runId, folderId, items }): Promise<void> => {
    for (let index = 0; index < items.length; index += 4) {
      const run = await ctx.runQuery(internal.qaVisual.runs.preparationRun, { runId });
      if (!run) return;
      await Promise.allSettled(items.slice(index, index + 4).map(async ({ reviewId, id, version }) => {
        try {
          const copyId = await ensureImageCopies(ctx, run.campaign, folderId, id, version);
          await ctx.runMutation(internal.qaVisual.runs.attach, { reviewId, copyId });
        } catch (error) {
          console.warn("QA Visual: no se pudo preparar una pieza de Google Drive", reviewId, error);
          await ctx.runMutation(internal.qaVisual.runs.attach, { reviewId });
        }
      }));
    }
    const run = await ctx.runQuery(internal.qaVisual.runs.preparationRun, { runId });
    if (run && !run.progressive)
      await ctx.runMutation(internal.qaVisual.runs.expirePreparation, { runId });
  },
});
