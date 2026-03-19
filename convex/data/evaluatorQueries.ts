// convex/evaluatorQueries.ts
// Queries internas para el evaluador
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Query interna para obtener task por ID
export const getTaskByIdInternal = internalQuery({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const task = await ctx.db.get(args.taskId as Id<"tasks">);
      return task;
    } catch {
      return null;
    }
  },
});
