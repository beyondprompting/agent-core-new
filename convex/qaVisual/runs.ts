import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { workflow } from "../workflows";
import { requireQaAdmin } from "./access";
import { attempt, finding, snapshot, status } from "./validators";

export const start = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    requestId: v.string(),
    snapshotId: v.id("qaVisualCampaignSnapshots"),
    names: v.optional(v.array(v.string())),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"qaVisualRuns"> } | { error: string }> => {
    const requestedBy = await requireQaAdmin(ctx);
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(args.requestId) || (args.names?.length ?? 0) > 200)
      return { error: "Solicitud de análisis inválida." };

    const registered = await ctx.db.get(args.campaignId);
    if (registered?.status !== "active") return { error: "La campaña ya no está disponible." };
    const campaign = registered.reviewKey;
    const existing = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_request", (q) =>
        q.eq("requestedBy", requestedBy).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.campaign !== campaign) return { error: "La solicitud pertenece a otra campaña." };
      return { runId: existing._id };
    }
    if (registered.currentSnapshotId !== args.snapshotId)
      return { error: "Los datos de la campaña cambiaron. Volvé a iniciar el análisis." };
    const data = await ctx.db.get(args.snapshotId);
    if (!data || data.campaignId !== args.campaignId)
      return { error: "La campaña todavía no tiene datos importados." };

    const pieces = await ctx.db.query("qaVisualCampaignPieces")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", data._id))
      .collect();
    const names = new Set(args.names);
    const selected = pieces.filter((piece) => args.kind === "batch" || names.has(piece.input.name));
    if (!selected.length || selected.length > 200 ||
        (args.kind !== "batch" && selected.length !== names.size) ||
        (args.kind === "piece" && selected.length !== 1))
      return { error: "La selección no coincide con las piezas importadas o supera el límite de 200 piezas." };

    for (const state of ["preparing", "running"] as const) {
      const active = await ctx.db
        .query("qaVisualRuns")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaign", campaign).eq("state", state),
        )
        .first();
      if (active) return { runId: active._id };
    }
    const previous = await ctx.db
      .query("qaVisualRuleSets")
      .withIndex("by_campaign_version", (q) =>
        q.eq("campaign", campaign).eq("version", data.ruleVersion),
      )
      .unique();
    const ruleSetId =
      previous?._id ??
      (await ctx.db.insert("qaVisualRuleSets", {
        campaign,
        version: data.ruleVersion,
        rules: data.rules,
        sourceDocumentId: data.excelDocumentId,
      }));
    const runId = await ctx.db.insert("qaVisualRuns", {
      campaign,
      requestedBy,
      snapshotId: data._id,
      ruleSetId,
      kind: args.kind,
      state: "preparing",
      requestId: args.requestId,
    });
    const ids = await Promise.all(
      selected.map(({ input }, order) =>
        ctx.db.insert("qaVisualReviews", {
          runId,
          campaign,
          input,
          order,
          status: "preparing",
          attempts: [],
        }),
      ),
    );
    await ctx.scheduler.runAfter(
      600_000,
      internal.qaVisual.runs.expirePreparation,
      { runId },
    );
    await ctx.scheduler.runAfter(0, internal.qaVisual.stageDriveRun.prepare, {
      runId,
      folderId: data.deploymentFolderId,
      items: selected.map(({ file }, index) => ({
        reviewId: ids[index], id: file.driveId, version: file.driveVersion,
      })),
    });
    return { runId };
  },
});

export const attach = internalMutation({
  args: {
    reviewId: v.id("qaVisualReviews"),
    asset: v.optional(v.object({ storageId: v.id("_storage"), snapshot })),
  },
  handler: async (ctx, { reviewId, asset }) => {
    const review = await ctx.db.get(reviewId);
    if (!review || review.status !== "preparing") {
      if (asset) await ctx.storage.delete(asset.storageId);
      return;
    }
    if (!asset) {
      await ctx.db.patch(reviewId, {
        status: "failed",
        error: "No se pudo leer o preparar la imagen original.",
      });
      return;
    }
    const previous = await ctx.db
      .query("qaVisualAssetVersions")
      .withIndex("by_input", (q) =>
        q
          .eq("campaign", review.campaign)
          .eq("input.name", review.input.name)
          .eq("input.contextKey", review.input.contextKey)
          .eq("snapshot.hash", asset.snapshot.hash),
      )
      .unique();
    const assetId =
      previous?._id ??
      (await ctx.db.insert("qaVisualAssetVersions", {
        campaign: review.campaign,
        input: review.input,
        ...asset,
      }));
    if (previous) await ctx.storage.delete(asset.storageId);
    await ctx.db.patch(reviewId, { status: "queued", assetId });
  },
});

async function dispatch(ctx: MutationCtx, runId: Id<"qaVisualRuns">) {
  const run = await ctx.db.get(runId);
  if (run?.state !== "preparing") return;
  const rows = await ctx.db
    .query("qaVisualReviews")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  for (const row of rows) {
    if (row.status === "preparing") {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: "Se interrumpió la preparación de la imagen.",
      });
    }
  }
  const ids = rows
    .filter((row) => row.status === "queued")
    .map((row) => row._id);
  await ctx.db.patch(runId, { state: ids.length ? "running" : "finished" });
  if (ids.length) {
    const chunk = ids.slice(0, 10);
    await workflow.start(
      ctx,
      internal.qaVisual.pipeline.processRun,
      { ids: chunk },
      {
        onComplete: internal.qaVisual.pipeline.finishRun,
        context: { runId, ids: chunk },
      },
    );
  }
}

export const expirePreparation = internalMutation({
  args: { runId: v.id("qaVisualRuns") },
  handler: async (ctx, { runId }): Promise<void> => dispatch(ctx, runId),
});

export const getWork = internalQuery({
  args: { reviewId: v.id("qaVisualReviews") },
  handler: async (ctx, { reviewId }) => {
    const review = await ctx.db.get(reviewId);
    if (!review?.assetId) return null;
    const run = await ctx.db.get(review.runId);
    const asset = await ctx.db.get(review.assetId);
    const ruleSet = run && (await ctx.db.get(run.ruleSetId));
    return asset && ruleSet ? { asset, rules: ruleSet.rules } : null;
  },
});

export const update = internalMutation({
  args: {
    reviewId: v.id("qaVisualReviews"),
    status,
    attempt: v.optional(attempt),
    findings: v.optional(v.array(finding)),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.status === "completed" || review.status === "failed")
      return;
    const verdict = args.findings?.some((item) => item.outcome === "fail")
      ? "findings"
      : args.findings?.some((item) => item.outcome === "unverifiable")
        ? "partial"
        : args.findings
          ? "validated"
          : undefined;
    await ctx.db.patch(review._id, {
      status: args.status,
      ...(args.attempt ? { attempts: [...review.attempts, args.attempt] } : {}),
      ...(args.findings ? { findings: args.findings, verdict } : {}),
      ...(args.error ? { error: args.error } : {}),
    });
  },
});

export const dashboard = query({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    inputs: v.array(v.object({ name: v.string(), contextKey: v.string() })),
  },
  handler: async (ctx, { campaignId, inputs }) => {
    await requireQaAdmin(ctx);
    const registered = await ctx.db.get(campaignId);
    if (registered?.status !== "active") return null;
    const campaign = registered.reviewKey;
    if (inputs.length > 1000)
      throw new Error("El inventario supera el límite admitido.");
    const preparing = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_campaign_state", (q) =>
        q.eq("campaign", campaign).eq("state", "preparing"),
      )
      .first();
    const running = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_campaign_state", (q) =>
        q.eq("campaign", campaign).eq("state", "running"),
      )
      .first();
    const run =
      preparing ??
      running ??
      (await ctx.db
        .query("qaVisualRuns")
        .withIndex("by_campaign", (q) => q.eq("campaign", campaign))
        .order("desc")
        .first());
    const batch = run
      ? await ctx.db
          .query("qaVisualReviews")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect()
      : [];
    const reviews = await Promise.all(
      inputs.map(async ({ name, contextKey }) => {
        const rows = ctx.db
          .query("qaVisualReviews")
          .withIndex("by_piece", (q) =>
            q
              .eq("campaign", campaign)
              .eq("input.name", name)
              .eq("input.contextKey", contextKey),
          )
          .order("desc");
        const latest = await rows.first();
        if (!latest) {
          const stale = await ctx.db
            .query("qaVisualReviews")
            .withIndex("by_piece", (q) =>
              q.eq("campaign", campaign).eq("input.name", name),
            )
            .order("desc")
            .first();
          return stale ? { name, status: "stale" as const } : null;
        }
        const result = latest.verdict
          ? latest
          : await ctx.db
              .query("qaVisualReviews")
              .withIndex("by_piece_status", (q) =>
                q
                  .eq("campaign", campaign)
                  .eq("input.name", name)
                  .eq("input.contextKey", contextKey)
                  .eq("status", "completed"),
              )
              .order("desc")
              .first();
        return {
          name,
          status: latest.status,
          error: latest.error,
          previous: Boolean(result && result._id !== latest._id),
          verdict: result?.verdict,
          findings: result?.findings,
          resultAt: result?._creationTime,
          resultId: result?._id,
        };
      }),
    );
    return {
      active: Boolean(preparing || running),
      total: batch.length,
      completed: batch.filter((row) => row.status === "completed").length,
      failed: batch.filter((row) => row.status === "failed").length,
      failedNames: batch
        .filter((row) => row.status === "failed")
        .map((row) => row.input.name),
      reviews,
    };
  },
});

export const hasStorage = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) =>
    Boolean(
      await ctx.db
        .query("qaVisualAssetVersions")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first(),
    ),
});
