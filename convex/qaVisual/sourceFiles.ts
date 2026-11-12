import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { sourceKind } from "./validators";

export const find = internalQuery({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    driveFileId: v.string(),
    driveVersion: v.string(),
  },
  handler: (ctx, args) =>
    ctx.db
      .query("qaVisualSourceFiles")
      .withIndex("by_campaign_drive", (q) =>
        q
          .eq("campaignId", args.campaignId)
          .eq("driveFileId", args.driveFileId)
          .eq("driveVersion", args.driveVersion),
      )
      .unique(),
});
export const save = internalMutation({
  args: {
    importId: v.id("qaVisualImports"),
    epoch: v.number(),
    kind: sourceKind,
    driveFileId: v.string(),
    driveVersion: v.string(),
    md5: v.optional(v.string()),
    sha256: v.string(),
    name: v.string(),
    mimeType: v.string(),
    bytes: v.number(),
    modifiedAt: v.number(),
    storageId: v.id("_storage"),
    parsedId: v.id("_storage"),
    parserVersion: v.string(),
  },
  handler: async (ctx, { importId, epoch, ...source }) => {
    const row = await ctx.db.get(importId),
      campaign = row && (await ctx.db.get(row.campaignId));
    if (
      !row ||
      row.epoch !== epoch ||
      campaign?.activeImportId !== importId ||
      !["running", "building"].includes(row.status)
    )
      return null;
    const existing = await ctx.db
      .query("qaVisualSourceFiles")
      .withIndex("by_campaign_drive", (q) =>
        q
          .eq("campaignId", row.campaignId)
          .eq("driveFileId", source.driveFileId)
          .eq("driveVersion", source.driveVersion),
      )
      .unique();
    if (existing) {
      if (existing.sha256 !== source.sha256)
        throw new Error("La fuente cambió sin cambiar su versión de Drive.");
      if (source.storageId !== existing.storageId)
        await ctx.storage.delete(source.storageId);
      if (
        existing.parsedId &&
        existing.parserVersion === source.parserVersion
      ) {
        if (source.parsedId !== existing.parsedId)
          await ctx.storage.delete(source.parsedId);
      } else {
        if (existing.parsedId) await ctx.storage.delete(existing.parsedId);
        await ctx.db.patch(existing._id, {
          parsedId: source.parsedId,
          parserVersion: source.parserVersion,
        });
      }
      return (await ctx.db.get(existing._id))!;
    }
    const same = await ctx.db
      .query("qaVisualSourceFiles")
      .withIndex("by_campaign_sha", (q) =>
        q
          .eq("campaignId", row.campaignId)
          .eq("kind", source.kind)
          .eq("sha256", source.sha256),
      )
      .first();
    if (same && same.storageId !== source.storageId) {
      await ctx.storage.delete(source.storageId);
      source.storageId = same.storageId;
    }
    const id = await ctx.db.insert("qaVisualSourceFiles", {
      campaignId: row.campaignId,
      ...source,
    });
    return (await ctx.db.get(id))!;
  },
});

/** Delete only unadopted action uploads, including after an ambiguous retry. */
export const discard = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    for (const id of storageIds) {
      const raw = await ctx.db
        .query("qaVisualSourceFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", id))
        .first();
      const parsed = await ctx.db
        .query("qaVisualSourceFiles")
        .withIndex("by_parsed", (q) => q.eq("parsedId", id))
        .first();
      const plan = await ctx.db
        .query("qaVisualImports")
        .withIndex("by_plan", (q) => q.eq("planStorageId", id))
        .first();
      if (!raw && !parsed && !plan) await ctx.storage.delete(id);
    }
  },
});
