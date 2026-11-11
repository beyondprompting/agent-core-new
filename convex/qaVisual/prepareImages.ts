"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ensureImageCopies } from "./imagePreparation.node";

export const warmBatch = internalAction({
  args: {
    snapshotId: v.id("qaVisualCampaignSnapshots"),
    offset: v.number(),
    hadErrors: v.boolean(),
  },
  handler: async (ctx, { snapshotId, offset, hadErrors }): Promise<void> => {
    const batch = await ctx.runQuery(internal.qaVisual.imageWarmup.batch, { snapshotId, offset });
    if (!batch) return;
    const results = await Promise.allSettled(batch.files.map((file) =>
      ensureImageCopies(ctx, batch.campaign, batch.folderId, file.driveId, file.driveVersion),
    ));
    for (const result of results) {
      if (result.status === "rejected")
        console.warn("QA Visual: no se pudo preparar una copia de la imagen", result.reason);
    }
    await ctx.runMutation(internal.qaVisual.imageWarmup.advance, {
      snapshotId, next: batch.next, hadErrors: hadErrors || results.some((result) => result.status === "rejected"),
    });
  },
});
