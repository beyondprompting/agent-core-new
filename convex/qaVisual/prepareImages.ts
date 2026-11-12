"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ensureImageCopies } from "./imagePreparation.node";

/** One image job of qaVisualImagePool. Errors are retried by the pool (busy leases included). */
export const prepareOne = internalAction({
  args: {
    campaign: v.string(),
    folderId: v.string(),
    id: v.string(),
    version: v.string(),
  },
  handler: async (ctx, file): Promise<void> => {
    await ensureImageCopies(ctx, file.campaign, file.folderId, file.id, file.version);
  },
});
