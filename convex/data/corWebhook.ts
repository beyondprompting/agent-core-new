import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { workflow } from "../workflows";

const target = v.union(
  v.object({ taskId: v.id("tasks") }),
  v.object({ projectId: v.id("projects") }),
);

export const syncRecord = workflow.define({
  args: { target, corId: v.number(), verifyDeletion: v.optional(v.literal(true)) },
  handler: async (step, { target, corId, verifyDeletion }): Promise<void> => {
    const options = { retry: { maxAttempts: 8, initialBackoffMs: 5000, base: 2 } };
    const sync = internal.data.corInboundSync;
    if ("taskId" in target) {
      await step.runAction(sync.pullTaskFromCORWorker, { ...target, webhookCorId: corId }, options);
    } else {
      await step.runAction(sync.pullProjectFromCORWorker, {
        ...target, webhookCorId: corId, ...(verifyDeletion && { verifyDeletion }),
      }, options);
    }
  },
});

export const enqueue = internalMutation({
  args: { event: v.union(v.literal("task.updated"), v.literal("project.updated"), v.literal("project.deleted")), corId: v.number() },
  handler: async (ctx, { event, corId }): Promise<number> => {
    const targets = event === "task.updated"
      ? (await ctx.db.query("tasks").withIndex("by_corTaskId", q => q.eq("corTaskId", String(corId))).collect())
          .filter(task => !task.convexStatus || task.convexStatus === "active")
          .map(task => ({ taskId: task._id }))
      : (await ctx.db.query("projects").withIndex("by_corProjectId", q => q.eq("corProjectId", corId)).collect())
          .filter(project => !project.convexStatus || project.convexStatus === "active")
          .map(project => ({ projectId: project._id }));

    for (const target of targets) {
      await workflow.start(ctx, internal.data.corWebhook.syncRecord, {
        target, corId, ...(event === "project.deleted" && { verifyDeletion: true as const }),
      }, { startAsync: true });
    }
    return targets.length;
  },
});
