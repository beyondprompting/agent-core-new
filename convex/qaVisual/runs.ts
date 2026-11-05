import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { workflow } from "../workflows";
import { requireQaAdmin } from "./access";
import { attempt, finding, input, rule, snapshot, status } from "./validators";

export const start = mutation({
  args: {
    campaign: v.string(),
    requestId: v.string(),
    inputs: v.array(input),
    ruleVersion: v.string(),
    sourceDocumentId: v.id("qaVisualSourceDocuments"),
    rules: v.array(rule),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"qaVisualRuns">; ids: Id<"qaVisualReviews">[] }> => {
    const requestedBy = await requireQaAdmin(ctx);
    const document = await ctx.db.get(args.sourceDocumentId);
    if (document?.campaign !== args.campaign)
      throw new Error("Matriz de campaña inválida.");
    const existing = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_request", (q) =>
        q.eq("requestedBy", requestedBy).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) return { runId: existing._id, ids: [] };
    if (
      !args.inputs.length ||
      args.inputs.length > 200 ||
      new Set(args.inputs.map((item) => item.name)).size !==
        args.inputs.length ||
      args.rules.length > 20 ||
      new Set(args.rules.map((item) => item.id)).size !== args.rules.length
    ) {
      throw new Error("El lote o sus reglas no son válidos.");
    }
    for (const state of ["preparing", "running"] as const) {
      const active = await ctx.db
        .query("qaVisualRuns")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaign", args.campaign).eq("state", state),
        )
        .first();
      if (active) return { runId: active._id, ids: [] };
    }
    const previous = await ctx.db
      .query("qaVisualRuleSets")
      .withIndex("by_campaign_version", (q) =>
        q.eq("campaign", args.campaign).eq("version", args.ruleVersion),
      )
      .unique();
    const ruleSetId =
      previous?._id ??
      (await ctx.db.insert("qaVisualRuleSets", {
        campaign: args.campaign,
        version: args.ruleVersion,
        rules: args.rules,
        sourceDocumentId: args.sourceDocumentId,
      }));
    const runId = await ctx.db.insert("qaVisualRuns", {
      campaign: args.campaign,
      requestedBy,
      ruleSetId,
      kind: args.kind,
      state: "preparing",
      requestId: args.requestId,
    });
    const ids = await Promise.all(
      args.inputs.map((item, order) =>
        ctx.db.insert("qaVisualReviews", {
          runId,
          campaign: args.campaign,
          input: item,
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
    return { runId, ids };
  },
});

export const canStage = internalQuery({
  args: { reviewId: v.id("qaVisualReviews") },
  handler: async (ctx, { reviewId }) => {
    const user = await requireQaAdmin(ctx);
    const review = await ctx.db.get(reviewId);
    const run = review && (await ctx.db.get(review.runId));
    return (
      review?.status === "preparing" &&
      run?.state === "preparing" &&
      run.requestedBy === user
    );
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

export const finishPreparation = mutation({
  args: { runId: v.id("qaVisualRuns") },
  handler: async (ctx, { runId }): Promise<void> => {
    const user = await requireQaAdmin(ctx);
    if ((await ctx.db.get(runId))?.requestedBy !== user)
      throw new Error("Acceso denegado");
    await dispatch(ctx, runId);
  },
});

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
    campaign: v.string(),
    inputs: v.array(v.object({ name: v.string(), contextKey: v.string() })),
  },
  handler: async (ctx, { campaign, inputs }) => {
    await requireQaAdmin(ctx);
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
