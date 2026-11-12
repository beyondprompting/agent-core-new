import { v } from "convex/values";
import { vResultValidator, type WorkId } from "@convex-dev/workpool";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { analysisPool, PER_RUN_SLOTS } from "./analysisPool";
import { readImport } from "./importRead";
import { nextAttempt, terminalMessage, type Provider } from "./model/retryPolicy";
import { reviewResult } from "./model/verdict";
import { structuredRequirements } from "./model/contracts";
import { provider as providerValidator } from "./validators";

/**
 * Stage 4 analysis runner (§10.2). A review is a small state machine stored in qaVisualReviews:
 * queued → preparing/analyzing → (retrying)* → completed | failed | cancelled.
 * Each run uses at most PER_RUN_SLOTS pool slots; the pool itself has a global limit
 * configured per environment. Results are saved as soon as each piece finishes.
 */
const ACTIVE = ["preparing", "analyzing", "retrying"] as const;
const IMAGE_RETRIES = 3;

async function activeReviews(ctx: MutationCtx, runId: Id<"qaVisualRuns">) {
  const rows: Doc<"qaVisualReviews">[] = [];
  for (const status of ACTIVE)
    rows.push(
      ...(await ctx.db
        .query("qaVisualReviews")
        .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", status))
        .take(PER_RUN_SLOTS + 1)),
    );
  return rows;
}

async function enqueueAttempt(
  ctx: MutationCtx,
  review: Doc<"qaVisualReviews">,
  provider: Provider,
  delayMs: number,
) {
  const workId = await analysisPool.enqueueAction(
    ctx,
    internal.qaVisual.analyzeJob.attempt,
    { reviewId: review._id, provider },
    {
      onComplete: internal.qaVisual.runner.onAttemptComplete,
      context: { reviewId: review._id, provider },
      ...(delayMs ? { runAfter: delayMs } : {}),
    },
  );
  await ctx.db.patch(review._id, {
    status: !review.copyId && !review.assetId ? "preparing" : review.attempts.length ? "retrying" : "analyzing",
    workId,
    startedAt: review.startedAt ?? Date.now(),
  });
}

/** Starts queued reviews while the run has free slots and closes the run when nothing is left. */
export async function fillSlots(ctx: MutationCtx, runId: Id<"qaVisualRuns">) {
  const run = await ctx.db.get(runId);
  if (!run || run.state === "finished" || run.runner !== "pool") return;
  const active = await activeReviews(ctx, runId);
  const free = PER_RUN_SLOTS - active.length;
  const next =
    free > 0 && !run.cancelledAt
      ? await ctx.db
          .query("qaVisualReviews")
          .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", "queued"))
          .take(free)
      : [];
  for (const review of next) await enqueueAttempt(ctx, review, "gemini", 0);
  if (!active.length && !next.length) {
    const waiting = await ctx.db
      .query("qaVisualReviews")
      .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", "queued"))
      .first();
    if (!waiting || run.cancelledAt)
      await ctx.db.patch(runId, { state: "finished", finishedAt: Date.now() });
  } else if (run.state !== "running") await ctx.db.patch(runId, { state: "running" });
}

export const jobContext = internalQuery({
  args: { reviewId: v.id("qaVisualReviews") },
  handler: async (ctx, { reviewId }) => {
    const review = await ctx.db.get(reviewId);
    if (!review || !ACTIVE.includes(review.status as (typeof ACTIVE)[number])) return null;
    const run = await ctx.db.get(review.runId);
    const version = review.pieceVersionId && (await ctx.db.get(review.pieceVersionId));
    const data = run?.snapshotId ? await readImport(ctx, run.snapshotId) : null;
    if (!run || !version || !data) return null;
    const copy = review.copyId ? await ctx.db.get(review.copyId) : null;
    return {
      campaign: run.campaign,
      folderId: data.deploymentFolderId,
      driveFileId: version.driveFileId,
      driveVersion: version.driveVersion,
      imageReady: Boolean(copy?.files || review.assetId),
    };
  },
});

export const attachCopy = internalMutation({
  args: { reviewId: v.id("qaVisualReviews"), copyId: v.id("qaVisualImageCopies") },
  handler: async (ctx, { reviewId, copyId }) => {
    const review = await ctx.db.get(reviewId);
    if (!review || review.status !== "preparing") return;
    await ctx.db.patch(reviewId, { copyId, status: "analyzing" });
    if (review.pieceVersionId) await ctx.db.patch(review.pieceVersionId, { copyId });
  },
});

async function finishReview(
  ctx: MutationCtx,
  review: Doc<"qaVisualReviews">,
  patch: Partial<Doc<"qaVisualReviews">>,
) {
  await ctx.db.patch(review._id, { ...patch, workId: undefined });
  await fillSlots(ctx, review.runId);
}

export const onAttemptComplete = internalMutation({
  args: {
    workId: v.string(),
    context: v.object({ reviewId: v.id("qaVisualReviews"), provider: providerValidator }),
    result: vResultValidator,
  },
  handler: async (ctx, { workId, context, result }) => {
    const review = await ctx.db.get(context.reviewId);
    // Late or repeated callbacks are ignored: only the job currently owning the review counts.
    if (!review || review.workId !== workId || !ACTIVE.includes(review.status as (typeof ACTIVE)[number]))
      return;
    if (result.kind === "canceled")
      return finishReview(ctx, review, { status: "cancelled", error: "Análisis detenido." });
    const value =
      result.kind === "success"
        ? (result.returnValue as
            | { kind: "success"; findings: Doc<"qaVisualReviews">["findings"]; attempt: Doc<"qaVisualReviews">["attempts"][number] }
            | { kind: "input"; message: string }
            | { kind: "provider"; retryable: boolean; attempt: Doc<"qaVisualReviews">["attempts"][number]; retryAfterMs?: number }
            | { kind: "image"; retryable: boolean; message: string }
            | { kind: "skipped" })
        : null;
    if (value?.kind === "skipped") return;
    if (value?.kind === "success" && value.findings) {
      const verdict = reviewResult(
        structuredRequirements(review.input),
        value.findings,
        review.input.issues,
      );
      return finishReview(ctx, review, {
        status: "completed",
        findings: value.findings,
        result: verdict,
        verdict: verdict.verdict,
        attempts: [...review.attempts, value.attempt],
        error: undefined,
      });
    }
    if (value?.kind === "input")
      return finishReview(ctx, review, { status: "failed", error: value.message });
    if (value?.kind === "image") {
      const imageTries = review.attempts.filter((a) => a.code === "image_busy").length;
      if (value.retryable && imageTries < IMAGE_RETRIES) {
        await ctx.db.patch(review._id, {
          attempts: [...review.attempts, { provider: context.provider, model: "image", elapsedMs: 0, code: "image_busy" }],
        });
        return enqueueAttempt(ctx, (await ctx.db.get(review._id))!, context.provider, 4_000 * (imageTries + 1));
      }
      return finishReview(ctx, review, { status: "failed", error: value.message });
    }
    // Provider error, or an unexpected exception treated as a network failure.
    const attempt =
      value?.kind === "provider"
        ? value.attempt
        : { provider: context.provider, model: "unknown", elapsedMs: 0, code: "network" };
    const attempts = [...review.attempts, attempt];
    const history = attempts
      .filter((a) => a.code !== "image_busy")
      .map((a) => ({ provider: a.provider, code: a.code }));
    let next = nextAttempt(history, value?.kind === "provider" ? value.retryAfterMs : undefined);
    // A non-retryable provider error never repeats the same provider: it goes to the fallback.
    if (value?.kind === "provider" && !value.retryable && next?.provider === attempt.provider)
      next =
        attempt.provider === "gemini" && !history.some((a) => a.provider === "openai")
          ? { provider: "openai", delayMs: 0 }
          : null;
    if (!next)
      return finishReview(ctx, review, { status: "failed", attempts, error: terminalMessage(history) });
    await ctx.db.patch(review._id, { attempts });
    await enqueueAttempt(ctx, (await ctx.db.get(review._id))!, next.provider, next.delayMs);
  },
});

/** Stops a pool run: queued pieces are cancelled and running jobs are cancelled in the pool. */
export async function cancelPoolRun(ctx: MutationCtx, run: Doc<"qaVisualRuns">) {
  let stopped = 0;
  const queued = await ctx.db
    .query("qaVisualReviews")
    .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", "queued"))
    .collect();
  for (const row of queued) {
    await ctx.db.patch(row._id, { status: "cancelled", error: "Análisis detenido antes de empezar." });
    stopped++;
  }
  for (const row of await activeReviews(ctx, run._id)) {
    if (row.workId) await analysisPool.cancel(ctx, row.workId as WorkId);
    stopped++;
  }
  return stopped;
}

/** Watchdog (§10.6): recovers reviews whose job no longer exists and closes empty runs. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("qaVisualRuns")
      .withIndex("by_state", (q) => q.eq("state", "running"))
      .take(50);
    for (const run of runs) {
      if (run.runner !== "pool") continue;
      for (const review of await activeReviews(ctx, run._id)) {
        if (!review.workId || (review.startedAt ?? 0) > Date.now() - 15 * 60_000) continue;
        const status = await analysisPool.status(ctx, review.workId as WorkId);
        if (status.state === "finished")
          await ctx.db.patch(review._id, {
            status: "failed",
            workId: undefined,
            error: "Se interrumpió el análisis de esta pieza. Reintentá las piezas fallidas.",
          });
      }
      await fillSlots(ctx, run._id);
    }
  },
});
