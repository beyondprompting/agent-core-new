import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { requireQaAdmin } from "./access";
import { queueSync, syncIsRunning } from "./campaignSnapshots";

export const csvEdit = v.object({
  csvLine: v.number(),
  column: v.union(
    v.literal("ID_PIEZA"),
    v.literal("CAMPAÑA"),
    v.literal("FASE"),
    v.literal("CANAL"),
    v.literal("MEDIO_PLATAFORMA"),
    v.literal("FORMATO_TIPO"),
  ),
  from: v.string(),
  to: v.string(),
  piece: v.string(),
  reason: v.string(),
  origin: v.union(v.literal("manual"), v.literal("ai")),
  order: v.optional(v.string()),
});

/**
 * Audit of an authorized CSV correction (§5.5). For a registered campaign it also reads Drive
 * again, so the mapping check and the pieces use the corrected file.
 */
export const record = internalMutation({
  args: {
    campaignId: v.optional(v.id("qaVisualCampaigns")),
    driveFolderId: v.string(),
    csvFileId: v.string(),
    csvName: v.string(),
    previousVersion: v.string(),
    newVersion: v.optional(v.string()),
    edits: v.array(csvEdit),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { edits, campaignId, ...args }) => {
    const user = await requireQaAdmin(ctx);
    await ctx.db.insert("qaVisualCsvEdits", {
      ...args,
      ...(campaignId ? { campaignId } : {}),
      edits: edits.map(({ piece: _, ...edit }) => edit),
      authorizedBy: user,
    });
    const campaign = campaignId && (await ctx.db.get(campaignId));
    if (
      campaign &&
      campaign.status === "active" &&
      !campaign.activeImportId &&
      !(await syncIsRunning(ctx, campaign.sync))
    )
      await queueSync(ctx, campaign._id, false, user);
  },
});
