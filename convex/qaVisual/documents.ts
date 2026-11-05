import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { clientRequirement, sourceCell } from "./validators";

export const findVersion = internalQuery({
  args: { campaign: v.string(), hash: v.string(), mappingVersion: v.string() },
  handler: (ctx, { campaign, hash, mappingVersion }) =>
    ctx.db
      .query("qaVisualSourceDocuments")
      .withIndex("by_version", (q) =>
        q
          .eq("campaign", campaign)
          .eq("hash", hash)
          .eq("mappingVersion", mappingVersion),
      )
      .unique(),
});

export const save = internalMutation({
  args: {
    campaign: v.string(),
    name: v.string(),
    hash: v.string(),
    mappingVersion: v.string(),
    storageId: v.id("_storage"),
    cells: v.array(sourceCell),
    pieces: v.array(
      v.object({ name: v.string(), requirements: v.array(clientRequirement) }),
    ),
  },
  handler: async (
    ctx,
    { campaign, hash, mappingVersion, name, storageId, cells, pieces },
  ) => {
    const existing = await ctx.db
      .query("qaVisualSourceDocuments")
      .withIndex("by_version", (q) =>
        q
          .eq("campaign", campaign)
          .eq("hash", hash)
          .eq("mappingVersion", mappingVersion),
      )
      .unique();
    if (existing) {
      if (existing.storageId !== storageId) await ctx.storage.delete(storageId);
      return existing._id;
    }
    const documentId = await ctx.db.insert("qaVisualSourceDocuments", {
      campaign,
      hash,
      mappingVersion,
      name,
      storageId,
    });
    for (const cell of cells)
      await ctx.db.insert("qaVisualClientRequirements", { documentId, cell });
    for (const piece of pieces) {
      for (const requirement of piece.requirements) {
        await ctx.db.insert("qaVisualClientRequirements", {
          documentId,
          piece: piece.name,
          requirement,
        });
      }
    }
    return documentId;
  },
});

// Operator-only cleanup, scoped to this campaign and finished runs from before Excel imports.
export const clearLegacyPilot = internalMutation({
  args: { campaign: v.string(), dryRun: v.boolean() },
  handler: async (ctx, { campaign, dryRun }) => {
    const runs = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_campaign", (q) => q.eq("campaign", campaign))
      .collect();
    const count = { runs: 0, reviews: 0 };
    for (const run of runs) {
      const rules = await ctx.db.get(run.ruleSetId);
      if (run.state !== "finished" || !rules || rules.sourceDocumentId)
        continue;
      const reviews = await ctx.db
        .query("qaVisualReviews")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      count.runs++;
      count.reviews += reviews.length;
      if (!dryRun) {
        for (const review of reviews) await ctx.db.delete(review._id);
        await ctx.db.delete(run._id);
      }
    }
    return count;
  },
});

// Operator-only reset. A finished full campaign test (or an already cleared
// campaign) is required before removing any associated previews.
export const clearFullCampaignTest = internalMutation({
  args: { campaign: v.string(), dryRun: v.boolean() },
  handler: async (ctx, { campaign, dryRun }) => {
    const runs = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_campaign", (q) => q.eq("campaign", campaign))
      .take(2);
    if (
      runs.length > 1 ||
      runs.some((run) => run.state !== "finished" || run.kind !== "batch")
    ) {
      throw new Error(
        "La campaña contiene otras ejecuciones o un análisis activo.",
      );
    }
    const reviews = runs[0]
      ? await ctx.db
          .query("qaVisualReviews")
          .withIndex("by_run", (q) => q.eq("runId", runs[0]._id))
          .collect()
      : [];
    if (runs.length && reviews.length !== 61)
      throw new Error("La ejecución no coincide con el prueba de 61 piezas.");
    const assets = await ctx.db
      .query("qaVisualAssetVersions")
      .withIndex("by_input", (q) => q.eq("campaign", campaign))
      .take(201);
    const rules = await ctx.db
      .query("qaVisualRuleSets")
      .withIndex("by_campaign_version", (q) => q.eq("campaign", campaign))
      .take(201);
    if (assets.length > 200 || rules.length > 200)
      throw new Error("El alcance excede el límite del piloto.");
    if (!dryRun) {
      for (const review of reviews) await ctx.db.delete(review._id);
      for (const run of runs) await ctx.db.delete(run._id);
      for (const asset of assets) {
        await ctx.storage.delete(asset.storageId);
        await ctx.db.delete(asset._id);
      }
      for (const rule of rules) await ctx.db.delete(rule._id);
    }
    return {
      runs: runs.length,
      reviews: reviews.length,
      assets: assets.length,
      ruleSets: rules.length,
    };
  },
});
