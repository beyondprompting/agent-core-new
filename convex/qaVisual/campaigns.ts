import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { requireQaAdmin } from "./access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireQaAdmin(ctx);
    const campaigns = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .collect();
    return campaigns.map(({ _id, name }) => ({ _id, name }));
  },
});

export const getActive = internalQuery({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    await requireQaAdmin(ctx);
    const id = ctx.db.normalizeId("qaVisualCampaigns", campaignId);
    if (!id) return null;
    const campaign = await ctx.db.get(id);
    return campaign?.status === "active" ? campaign : null;
  },
});

export const register = internalMutation({
  args: { name: v.string(), driveFolderId: v.string(), reviewKey: v.string() },
  handler: async (ctx, args) => {
    const createdBy = await requireQaAdmin(ctx);
    const existing = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_drive_folder", (q) => q.eq("driveFolderId", args.driveFolderId))
      .unique();
    if (existing) return existing.status === "active" ? "existing" : "archived";

    await ctx.db.insert("qaVisualCampaigns", { ...args, status: "active", createdBy });
    return "created";
  },
});
