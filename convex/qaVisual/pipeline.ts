import type { WorkflowCtx } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { workflow } from "../workflows";
import { dispatchReady } from "./runDispatch";

export async function processPiece(
  step: Pick<WorkflowCtx, "runMutation" | "runAction">,
  reviewId: Id<"qaVisualReviews">,
) {
  const update = internal.qaVisual.runs.update;
  const analyze = internal.qaVisual.worker.analyze;
  for (const provider of ["gemini", "openai"] as const) {
    const limit = provider === "gemini" ? 3 : 2;
    for (let index = 0; index < limit; index++) {
      await step.runMutation(update, {
        reviewId,
        status: index ? "retrying" : "analyzing",
      });
      const result = await step.runAction(
        analyze,
        { reviewId, provider },
        {
          retry: false,
          ...(index ? { runAfter: 2_000 * 2 ** (index - 1) } : {}),
        },
      );
      if (result.kind === "success") {
        await step.runMutation(update, {
          reviewId,
          status: "completed",
          findings: result.findings,
          attempt: result.attempt,
        });
        return;
      }
      if (result.kind === "input") {
        await step.runMutation(update, {
          reviewId,
          status: "failed",
          error: result.message,
        });
        return;
      }
      await step.runMutation(update, {
        reviewId,
        status: "retrying",
        attempt: result.attempt,
      });
      if (!result.retryable) break;
    }
  }
  await step.runMutation(update, {
    reviewId,
    status: "failed",
    error: "Gemini y OpenAI no pudieron completar la revisión.",
  });
}

export const processRun = workflow.define({
  args: { ids: v.array(v.id("qaVisualReviews")) },
  handler: async (step, { ids }): Promise<void> => {
    for (let offset = 0; offset < ids.length; offset += 2) {
      const group = ids.slice(offset, offset + 2);
      const outcomes = await Promise.allSettled(
        group.map((reviewId) => processPiece(step, reviewId)),
      );
      for (const [index, result] of outcomes.entries()) {
        if (result.status === "rejected") {
          await step.runMutation(internal.qaVisual.runs.update, {
            reviewId: group[index],
            status: "failed",
            error: "Se interrumpió el procesamiento de esta pieza.",
          });
        }
      }
    }
  },
});

export const finishPiece = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ runId: v.id("qaVisualRuns"), reviewId: v.id("qaVisualReviews") }),
  },
  handler: async (ctx, { context: { runId, reviewId } }): Promise<void> => {
    const run = await ctx.db.get(runId);
    if (run?.state !== "running" || !run.rollingQueue || !run.activeBatch?.includes(reviewId)) return;

    const review = await ctx.db.get(reviewId);
    if (review && review.status !== "completed" && review.status !== "failed" && review.status !== "cancelled") {
      await ctx.db.patch(reviewId, {
        status: "failed", error: "Se interrumpió la ejecución del análisis.",
      });
    }
    await ctx.db.patch(runId, { activeBatch: run.activeBatch.filter((id) => id !== reviewId) });
    await dispatchReady(ctx, runId);
  },
});

// Retained for runs queued before the rolling queue was introduced.
export const finishRun = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.union(
      v.id("qaVisualRuns"),
      v.object({
        runId: v.id("qaVisualRuns"),
        ids: v.array(v.id("qaVisualReviews")),
      }),
    ),
  },
  handler: async (ctx, { context }): Promise<void> => {
    const runId = typeof context === "string" ? context : context.runId;
    const run = await ctx.db.get(runId);
    if (run?.state !== "running") return;
    if (run.activeBatch !== undefined) {
      const active = run.activeBatch;
      if (typeof context === "string" || context.ids.length !== active.length ||
          context.ids.some((id, index) => id !== active[index])) return;
      for (const id of active) {
        const review = await ctx.db.get(id);
        if (review && review.status !== "completed" && review.status !== "failed" && review.status !== "cancelled") {
          await ctx.db.patch(id, {
            status: "failed", error: "Se interrumpió la ejecución del análisis.",
          });
        }
      }
      await ctx.db.patch(runId, { activeBatch: [] });
      await dispatchReady(ctx, runId);
      return;
    }
    const ids = typeof context === "string" ? null : new Set(context.ids);
    const rows = await ctx.db
      .query("qaVisualReviews")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    for (const row of rows) {
      if (
        (!ids || ids.has(row._id)) &&
        row.status !== "completed" &&
        row.status !== "failed"
      ) {
        await ctx.db.patch(row._id, {
          status: "failed",
          error: "Se interrumpió la ejecución del análisis.",
        });
      }
    }
    const next = rows
      .filter((row) => ids && !ids.has(row._id) && row.status === "queued")
      .slice(0, 10)
      .map((row) => row._id);
    if (next.length) {
      await workflow.start(
        ctx,
        internal.qaVisual.pipeline.processRun,
        { ids: next },
        {
          onComplete: internal.qaVisual.pipeline.finishRun,
          context: { runId, ids: next },
        },
      );
    } else {
      await ctx.db.patch(runId, { state: "finished" });
    }
  },
});
