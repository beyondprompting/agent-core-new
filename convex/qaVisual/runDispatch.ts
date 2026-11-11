import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { workflow } from "../workflows";

const MAX_PARALLEL_REVIEWS = 4;

export async function dispatchReady(ctx: MutationCtx, runId: Id<"qaVisualRuns">): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || run.state === "finished" || !run.activeBatch) return;
  const active = run.activeBatch;
  const capacity = run.rollingQueue ? MAX_PARALLEL_REVIEWS - active.length : active.length ? 0 : 10;
  if (capacity <= 0) return;

  // A reserved review can still be queued until its first workflow step runs.
  const queued = await ctx.db.query("qaVisualReviews")
    .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", "queued"))
    .take(capacity + active.length);
  const ids = queued.map((row) => row._id).filter((id) => !active.includes(id)).slice(0, capacity);
  if (!ids.length) {
    if (active.length) return;
    const pending = await ctx.db.query("qaVisualReviews")
      .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", "preparing"))
      .first();
    if (!pending) await ctx.db.patch(runId, { state: "finished" });
    return;
  }

  await ctx.db.patch(runId, { activeBatch: [...active, ...ids], state: "running" });
  if (!run.rollingQueue) {
    await workflow.start(ctx, internal.qaVisual.pipeline.processRun, { ids }, {
      onComplete: internal.qaVisual.pipeline.finishRun, context: { runId, ids },
    });
    return;
  }

  for (const reviewId of ids) {
    await workflow.start(ctx, internal.qaVisual.pipeline.processRun, { ids: [reviewId] }, {
      startAsync: true,
      onComplete: internal.qaVisual.pipeline.finishPiece,
      context: { runId, reviewId },
    });
  }
}
