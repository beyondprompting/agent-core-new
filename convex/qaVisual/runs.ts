import { importId } from "./model/importContracts";
import {
  publishedId,
  readImport,
  readPieces,
  type ImportedPiece,
} from "./importRead";
import {
  displayReviewStatus,
  isCurrentReview,
  reviewResult,
} from "./model/verdict";
import { findingDiscussions } from "./pieces";
import {
  ANALYSIS_POLICY_VERSION,
  structuredRequirements,
} from "./model/contracts";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { workflow } from "../workflows";
import { requireQaAdmin } from "./access";
import { dispatchReady } from "./runDispatch";
import { cancelPoolRun, fillSlots } from "./runner";
import {
  attempt,
  finding,
  snapshot,
  status,
  region,
  locationStatus,
} from "./validators";
import { hasValidCommentRegion } from "./commentLocations";

export const start = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    requestId: v.string(),
    snapshotId: importId,
    names: v.optional(v.array(v.string())),
    pieceIds: v.optional(v.array(v.id("qaVisualPieces"))),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
    // batch only: "pending" (default) skips pieces with a current completed analysis.
    scope: v.optional(v.union(v.literal("pending"), v.literal("all"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { runId: Id<"qaVisualRuns">; queued?: number } | { error: string }
  > => {
    const requestedBy = await requireQaAdmin(ctx);
    if (
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(args.requestId) ||
      Math.max(args.names?.length ?? 0, args.pieceIds?.length ?? 0) >
        MAX_RUN_PIECES
    )
      return { error: "Solicitud de análisis inválida." };

    const registered = await ctx.db.get(args.campaignId);
    if (registered?.status !== "active")
      return { error: "La campaña ya no está disponible." };
    const campaign = registered.reviewKey;
    const existing = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_request", (q) =>
        q.eq("requestedBy", requestedBy).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.campaign !== campaign)
        return { error: "La solicitud pertenece a otra campaña." };
      return { runId: existing._id };
    }
    if (publishedId(registered) !== args.snapshotId)
      return {
        error:
          "Los datos de la campaña cambiaron. Volvé a iniciar el análisis.",
      };
    const data = await readImport(ctx, args.snapshotId);
    if (!data || data.campaignId !== args.campaignId)
      return { error: "La campaña todavía no tiene datos importados." };

    const pieces = await readPieces(ctx, data._id);
    if (
      pieces.some(
        (piece) =>
          !piece.pieceVersionId ||
          piece.input.policyVersion !== ANALYSIS_POLICY_VERSION,
      )
    )
      return {
        error:
          "Actualizá desde Drive antes de analizar: hay nuevos criterios de revisión.",
      };
    const names = new Set(args.names);
    const pieceIds = args.pieceIds ? new Set(args.pieceIds) : null;
    const scope = args.kind === "batch" ? (args.scope ?? "pending") : "all";
    const requested = pieces.filter(
      (piece) =>
        args.kind === "batch" ||
        (pieceIds
          ? Boolean(piece.pieceId && pieceIds.has(piece.pieceId))
          : names.has(piece.input.name)),
    );
    if (
      !requested.length ||
      requested.length > MAX_RUN_PIECES ||
      (args.kind !== "batch" &&
        requested.length !== (pieceIds?.size ?? names.size)) ||
      (args.kind === "piece" && requested.length !== 1)
    )
      return {
        error: `La selección no coincide con las piezas importadas o supera el límite de ${MAX_RUN_PIECES} piezas.`,
      };
    const selected =
      scope === "all"
        ? requested
        : (
            await Promise.all(
              requested.map(async (piece) =>
                (await hasCurrentResult(ctx, piece)) ? null : piece,
              ),
            )
          ).filter((piece) => piece !== null);
    if (!selected.length)
      return {
        error:
          "Todas las piezas tienen un análisis vigente. Usá «Reanalizar todas» si querés repetirlo.",
      };

    for (const state of ["preparing", "running"] as const) {
      const active = await ctx.db
        .query("qaVisualRuns")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaign", campaign).eq("state", state),
        )
        .first();
      if (!active) continue;
      if (args.kind !== "piece" || !(active.rollingQueue || active.runner === "pool"))
        return {
          error:
            "Ya hay un análisis en curso. Podés detenerlo o esperar a que termine.",
        };
      // A single piece joins the running queue in front of the remaining pieces.
      const piece = selected[0];
      const busy = await ctx.db
        .query("qaVisualReviews")
        .withIndex("by_run", (q) => q.eq("runId", active._id))
        .collect();
      if (
        busy.some(
          (row) =>
            row.pieceVersionId === piece.pieceVersionId &&
            !["completed", "failed", "cancelled"].includes(row.status),
        )
      )
        return { error: "Esta pieza ya se está analizando." };
      const first = busy.reduce((min, row) => Math.min(min, row.order), 0);
      if (active.runner === "pool") {
        // §10.4: the piece goes to the front of the queue of the running analysis.
        await ctx.db.insert("qaVisualReviews", {
          runId: active._id,
          campaign,
          campaignId: args.campaignId,
          pieceId: piece.pieceId,
          pieceVersionId: piece.pieceVersionId,
          input: piece.input,
          order: first - 1,
          status: "queued",
          attempts: [],
        });
        await fillSlots(ctx, active._id);
        return { runId: active._id, queued: 1 };
      }
      const reviewId = await ctx.db.insert("qaVisualReviews", {
        runId: active._id,
        campaign,
        campaignId: args.campaignId,
        pieceId: piece.pieceId,
        pieceVersionId: piece.pieceVersionId,
        input: piece.input,
        order: first - 1,
        status: "preparing",
        attempts: [],
      });
      await ctx.scheduler.runAfter(0, internal.qaVisual.stageDriveRun.prepare, {
        runId: active._id,
        folderId: data.deploymentFolderId,
        items: [
          {
            reviewId,
            id: piece.file.driveId,
            version: piece.file.driveVersion,
          },
        ],
      });
      return { runId: active._id, queued: 1 };
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
      state: "running",
      runner: "pool",
      requestId: args.requestId,
      ...(args.kind === "batch" ? { scope } : {}),
    });
    // Stage 4 runner: every piece waits as "queued"; fillSlots starts up to 4 per run.
    for (const [order, { input, pieceId, pieceVersionId }] of selected.entries())
      await ctx.db.insert("qaVisualReviews", {
        runId,
        campaign,
        campaignId: args.campaignId,
        pieceId,
        pieceVersionId,
        input,
        order,
        status: "queued",
        attempts: [],
      });
    await fillSlots(ctx, runId);
    return { runId, queued: selected.length };
  },
});

const MAX_RUN_PIECES = 1000;

async function hasCurrentResult(ctx: QueryCtx, piece: ImportedPiece) {
  if (!piece.pieceVersionId) return false;
  const completed = await ctx.db
    .query("qaVisualReviews")
    .withIndex("by_version_input", (q) =>
      q
        .eq("pieceVersionId", piece.pieceVersionId)
        .eq("input.contextKey", piece.input.contextKey)
        .eq("status", "completed"),
    )
    .first();
  return Boolean(
    completed && isCurrentReview(completed.input, piece.input.contextKey),
  );
}

/** Stops dispatching new pieces. Pieces already being analyzed finish and keep their result. */
export const cancel = mutation({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireQaAdmin(ctx);
    const registered = await ctx.db.get(campaignId);
    if (registered?.status !== "active") return 0;
    let stopped = 0;
    for (const state of ["preparing", "running"] as const) {
      const runs = await ctx.db
        .query("qaVisualRuns")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaign", registered.reviewKey).eq("state", state),
        )
        .take(10);
      for (const run of runs) {
        if (run.runner === "pool") {
          await ctx.db.patch(run._id, { cancelledAt: Date.now(), cancelledBy: user });
          stopped += await cancelPoolRun(ctx, run);
          await fillSlots(ctx, run._id);
          continue;
        }
        for (const status of ["queued", "preparing"] as const) {
          const rows = await ctx.db
            .query("qaVisualReviews")
            .withIndex("by_run_status", (q) =>
              q.eq("runId", run._id).eq("status", status),
            )
            .collect();
          for (const row of rows) {
            await ctx.db.patch(row._id, {
              status: "cancelled",
              error: "Análisis detenido antes de empezar.",
            });
            stopped++;
          }
        }
        const busy = (run.activeBatch ?? []).length > 0;
        await ctx.db.patch(run._id, {
          cancelledAt: Date.now(),
          cancelledBy: user,
          ...(busy ? {} : { state: "finished" as const, activeBatch: [] }),
        });
      }
    }
    return stopped;
  },
});

export const preparationRun = internalQuery({
  args: { runId: v.id("qaVisualRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run && run.state !== "finished"
      ? { campaign: run.campaign, progressive: run.activeBatch !== undefined }
      : null;
  },
});

export const attach = internalMutation({
  args: {
    reviewId: v.id("qaVisualReviews"),
    asset: v.optional(v.object({ storageId: v.id("_storage"), snapshot })),
    copyId: v.optional(v.id("qaVisualImageCopies")),
  },
  handler: async (ctx, { reviewId, asset, copyId }): Promise<void> => {
    const review = await ctx.db.get(reviewId);
    if (!review || review.status !== "preparing") {
      if (asset) await ctx.storage.delete(asset.storageId);
      return;
    }
    if (copyId) {
      const copy = await ctx.db.get(copyId);
      if (!copy?.files || copy.campaign !== review.campaign)
        throw new Error("Copia de la pieza no disponible.");
      await ctx.db.patch(reviewId, { status: "queued", copyId });
      await dispatchReady(ctx, review.runId);
      return;
    }
    if (!asset) {
      await ctx.db.patch(reviewId, {
        status: "failed",
        error: "No se pudo leer o preparar la imagen original.",
      });
      await dispatchReady(ctx, review.runId);
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
    await dispatchReady(ctx, review.runId);
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
  handler: async (ctx, { runId }): Promise<void> => {
    const run = await ctx.db.get(runId);
    if (!run || run.state === "finished") return;
    if (run.activeBatch === undefined) {
      await dispatch(ctx, runId);
      return;
    }
    const pending = await ctx.db
      .query("qaVisualReviews")
      .withIndex("by_run_status", (q) =>
        q.eq("runId", runId).eq("status", "preparing"),
      )
      .collect();
    for (const row of pending) {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: "Se interrumpió la preparación de la imagen.",
      });
    }
    await dispatchReady(ctx, runId);
  },
});

export const getWork = internalQuery({
  args: { reviewId: v.id("qaVisualReviews") },
  handler: async (ctx, { reviewId }) => {
    const review = await ctx.db.get(reviewId);
    if (!review) return null;
    const run = await ctx.db.get(review.runId);
    const ruleSet = run && (await ctx.db.get(run.ruleSetId));
    if (!ruleSet) return null;
    const copy = review.copyId && (await ctx.db.get(review.copyId))?.files;
    const asset = copy
      ? { storageId: copy.analysisId, snapshot: copy.snapshot }
      : review.assetId && (await ctx.db.get(review.assetId));
    return asset
      ? {
          asset: {
            storageId: asset.storageId,
            snapshot: asset.snapshot,
            input: review.input,
          },
          rules: ruleSet.rules,
          status: review.status,
          findings: review.findings,
        }
      : null;
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
    if (
      !review ||
      review.status === "completed" ||
      review.status === "failed" ||
      review.status === "cancelled"
    )
      return;
    const result = args.findings
      ? reviewResult(
          structuredRequirements(review.input),
          args.findings,
          review.input.issues,
        )
      : undefined;
    await ctx.db.patch(review._id, {
      status: args.status,
      ...(args.attempt ? { attempts: [...review.attempts, args.attempt] } : {}),
      ...(args.findings
        ? { findings: args.findings, verdict: result!.verdict, result }
        : {}),
      ...(args.error ? { error: args.error } : {}),
    });
  },
});

export const saveCommentLocations = internalMutation({
  args: {
    reviewId: v.id("qaVisualReviews"),
    locations: v.array(
      v.object({
        ruleId: v.string(),
        observed: v.string(),
        locationStatus,
        visibleAnchor: v.optional(v.string()),
        region: v.optional(region),
      }),
    ),
  },
  handler: async (ctx, { reviewId, locations }) => {
    const review = await ctx.db.get(reviewId);
    if (review?.status !== "completed" || !review.findings)
      throw new Error("La revisión cambió antes de guardar las ubicaciones.");
    const byId = new Map(
      locations.map((location) => [location.ruleId, location]),
    );
    if (byId.size !== locations.length) throw new Error("invalid_locations");
    for (const location of locations) {
      const finding = review.findings.find(
        (item) => item.ruleId === location.ruleId,
      );
      if (
        !finding ||
        finding.observed !== location.observed ||
        (location.locationStatus === "located" &&
          !hasValidCommentRegion({
            region: location.region ?? null,
            visibleAnchor: location.visibleAnchor ?? null,
          }))
      )
        throw new Error("invalid_locations");
    }
    await ctx.db.patch(reviewId, {
      findings: review.findings.map((finding) => {
        const location = byId.get(finding.ruleId);
        return location
          ? {
              ...finding,
              ...location,
              region: location.region,
              visibleAnchor: location.visibleAnchor,
            }
          : finding;
      }),
    });
    return locations.length;
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
    const currentId = publishedId(registered);
    const snapshotPieces = currentId ? await readPieces(ctx, currentId) : [];
    const reviews = await Promise.all(
      snapshotPieces.map(async (piece) => {
        const { name, contextKey } = piece.input;
        if (piece.pieceVersionId) {
          const latest = await ctx.db
            .query("qaVisualReviews")
            .withIndex("by_version_input", (q) =>
              q
                .eq("pieceVersionId", piece.pieceVersionId)
                .eq("input.contextKey", contextKey),
            )
            .order("desc")
            .first();
          const version = await ctx.db.get(piece.pieceVersionId);
          const common = {
            name,
            pieceId: piece.pieceId,
            pieceVersionId: piece.pieceVersionId,
            version: version?.number ?? 1,
          };
          if (!latest) {
            const stale = await ctx.db
              .query("qaVisualReviews")
              .withIndex("by_version", (q) =>
                q.eq("pieceVersionId", piece.pieceVersionId),
              )
              .order("desc")
              .first();
            return {
              ...common,
              status: stale ? ("stale" as const) : ("pending" as const),
              issues: piece.input.issues,
            };
          }
          const result =
            latest.status === "completed"
              ? latest
              : await ctx.db
                  .query("qaVisualReviews")
                  .withIndex("by_version_input", (q) =>
                    q
                      .eq("pieceVersionId", piece.pieceVersionId)
                      .eq("input.contextKey", contextKey)
                      .eq("status", "completed"),
                  )
                  .order("desc")
                  .first();
          return {
            ...common,
            status: displayReviewStatus(latest, contextKey),
            error: latest.error,
            previous: Boolean(result && result._id !== latest._id),
            verdict: result?.verdict,
            findings: result?.findings,
            findingThreads: await findingDiscussions(ctx, result),
            result: result?.result,
            issues: piece.input.issues,
            resultAt: result?._creationTime,
            resultId: result?._id,
          };
        }
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
          status: displayReviewStatus(latest, contextKey),
          error: latest.error,
          previous: Boolean(result && result._id !== latest._id),
          verdict: result?.verdict,
          findings: result?.findings,
          notices: latest.input.notices,
          issues: latest.input.issues,
          result: result?.result,
          resultAt: result?._creationTime,
          resultId: result?._id,
        };
      }),
    );
    const currentInputs = new Map(
      snapshotPieces.map((p) => [p.pieceId ?? p.file.name, p.input.contextKey]),
    );
    const currentCompleted = batch.filter(
      (row) =>
        row.status === "completed" &&
        isCurrentReview(
          row.input,
          currentInputs.get(row.pieceId ?? row.input.name) ?? "",
        ),
    );
    return {
      active: Boolean(preparing || running),
      cancelling: Boolean((preparing ?? running)?.cancelledAt),
      runKind: run?.kind,
      total: batch.length,
      cancelled: batch.filter((row) => row.status === "cancelled").length,
      running: batch.filter((row) =>
        ["analyzing", "retrying"].includes(row.status),
      ).length,
      preparedImages: batch.filter((row) => row.copyId || row.assetId).length,
      preparingImages: batch.filter((row) => row.status === "preparing").length,
      validated: currentCompleted.filter((row) => row.verdict === "validated")
        .length,
      findings: currentCompleted.filter((row) => row.verdict === "findings")
        .length,
      partial: currentCompleted.filter((row) => row.verdict === "partial")
        .length,
      stale:
        batch.filter((row) => row.status === "completed").length -
        currentCompleted.length,
      completed: batch.filter((row) => row.status === "completed").length,
      failed: batch.filter((row) => row.status === "failed").length,
      failedPieceIds: batch
        .filter((row) => row.status === "failed")
        .flatMap((row) => (row.pieceId ? [row.pieceId] : [])),
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
