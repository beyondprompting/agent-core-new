import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireCampaign } from "./access";

/**
 * §5.5: the rows and orders chosen in the mapping panel are saved as they are chosen, so
 * closing the dialog (or losing the connection) does not lose them. They are only proposals:
 * nothing is written in Drive until the user verifies and authorizes the changes.
 */
const MAX = 1000;
const choice = v.object({
  piece: v.string(),
  csvLine: v.optional(v.number()),
  order: v.optional(v.string()),
  mode: v.optional(v.union(v.literal("csv"), v.literal("same"))),
  scope: v.optional(v.union(v.literal("campaign"), v.literal("client"))),
});

/** The saved choices, only when they were made on the CSV version the panel shows. */
export const get = query({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    csvFileId: v.string(),
    csvVersion: v.string(),
  },
  handler: async (ctx, { campaignId, csvFileId, csvVersion }) => {
    await requireCampaign(ctx, campaignId, { draft: true });
    const row = await ctx.db
      .query("qaVisualMappingChoices")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    return row && row.csvFileId === csvFileId && row.csvVersion === csvVersion
      ? row.choices
      : [];
  },
});

export const save = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    csvFileId: v.string(),
    csvVersion: v.string(),
    choices: v.array(choice),
  },
  handler: async (ctx, { campaignId, csvFileId, csvVersion, choices }) => {
    const { user } = await requireCampaign(ctx, campaignId, { draft: true });
    if (
      choices.length > MAX ||
      choices.some((c) => c.piece.length > 500 || (c.order?.length ?? 0) > 200)
    )
      throw new ConvexError("Demasiadas elecciones para guardar.");
    const row = await ctx.db
      .query("qaVisualMappingChoices")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (!choices.length) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    const value = { csvFileId, csvVersion, choices, updatedBy: user };
    if (row) await ctx.db.patch(row._id, value);
    else
      await ctx.db.insert("qaVisualMappingChoices", { campaignId, ...value });
  },
});
