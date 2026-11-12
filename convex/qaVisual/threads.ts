import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireVersion } from "./access";
import { anchor, commentBody, validateAnchor } from "./model/collaboration";

const findingRef = v.object({
  reviewId: v.id("qaVisualReviews"),
  ruleId: v.string(),
});
const targetArgs = {
  pieceVersionId: v.id("qaVisualPieceVersions"),
  threadId: v.optional(v.id("qaVisualThreads")),
  finding: v.optional(findingRef),
};

async function target(
  ctx: MutationCtx,
  args: {
    pieceVersionId: Id<"qaVisualPieceVersions">;
    threadId?: Id<"qaVisualThreads">;
    finding?: { reviewId: Id<"qaVisualReviews">; ruleId: string };
  },
  user: Id<"users">,
) {
  if (Boolean(args.threadId) === Boolean(args.finding))
    throw new ConvexError("Elegí un hilo o un hallazgo.");
  if (args.threadId) {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.pieceVersionId !== args.pieceVersionId)
      throw new ConvexError("El hilo no pertenece a esta versión.");
    return thread;
  }
  const ref = args.finding!;
  const review = await ctx.db.get(ref.reviewId);
  const finding = review?.findings?.find((f) => f.ruleId === ref.ruleId);
  if (
    !review ||
    review.pieceVersionId !== args.pieceVersionId ||
    review.status !== "completed" ||
    !finding ||
    finding.outcome === "pass" ||
    finding.outcome === "notApplicable"
  )
    throw new ConvexError("El hallazgo no está disponible en esta versión.");
  const existing = await ctx.db
    .query("qaVisualThreads")
    .withIndex("by_finding", (q) =>
      q.eq("origin.reviewId", ref.reviewId).eq("origin.ruleId", ref.ruleId),
    )
    .unique();
  if (existing) return existing;
  const version = (await ctx.db.get(args.pieceVersionId))!;
  const id = await ctx.db.insert("qaVisualThreads", {
    campaignId: version.campaignId,
    pieceId: version.pieceId,
    pieceVersionId: version._id,
    origin: { kind: "finding", ...ref },
    anchor: finding.region
      ? { kind: "rect", ...finding.region }
      : { kind: "general" },
    status: "open",
    createdBy: user,
    lastActivityAt: Date.now(),
    commentCount: 0,
  });
  await ctx.db.patch(version._id, {
    openThreads: (version.openThreads ?? 0) + 1,
    threadCount: (version.threadCount ?? 0) + 1,
    humanActivity: true,
  });
  return (await ctx.db.get(id))!;
}

export const create = mutation({
  args: {
    pieceVersionId: v.id("qaVisualPieceVersions"),
    anchor,
    body: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, version } = await requireVersion(ctx, args.pieceVersionId);
    const body = commentBody(args.body);
    validateAnchor(args.anchor);
    if (args.requestId.length > 100)
      throw new ConvexError("Solicitud inválida.");
    const previous = await ctx.db
      .query("qaVisualThreads")
      .withIndex("by_request", (q) =>
        q.eq("createdBy", user).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.pieceVersionId !== version._id)
        throw new ConvexError("La solicitud pertenece a otra versión.");
      return previous._id;
    }
    const threadId = await ctx.db.insert("qaVisualThreads", {
      campaignId: version.campaignId,
      pieceId: version.pieceId,
      pieceVersionId: version._id,
      origin: { kind: "human" },
      anchor: args.anchor,
      status: "open",
      createdBy: user,
      lastActivityAt: Date.now(),
      commentCount: 1,
      requestId: args.requestId,
    });
    await ctx.db.insert("qaVisualComments", {
      threadId,
      pieceVersionId: version._id,
      authorId: user,
      body,
    });
    await ctx.db.patch(version._id, {
      humanActivity: true,
      openThreads: (version.openThreads ?? 0) + 1,
      threadCount: (version.threadCount ?? 0) + 1,
    });
    return threadId;
  },
});

export const reply = mutation({
  args: { ...targetArgs, body: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const { user, version } = await requireVersion(ctx, args.pieceVersionId);
    const body = commentBody(args.body);
    if (args.requestId.length > 100)
      throw new ConvexError("Solicitud inválida.");
    const thread = await target(ctx, args, user);
    const previous = await ctx.db
      .query("qaVisualComments")
      .withIndex("by_request", (q) =>
        q.eq("authorId", user).eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.threadId !== thread._id)
        throw new ConvexError("La solicitud pertenece a otro hilo.");
      return thread._id;
    }
    await ctx.db.insert("qaVisualComments", {
      threadId: thread._id,
      pieceVersionId: version._id,
      authorId: user,
      body,
      requestId: args.requestId,
    });
    await ctx.db.patch(thread._id, {
      commentCount: thread.commentCount + 1,
      lastActivityAt: Date.now(),
    });
    await ctx.db.patch(version._id, { humanActivity: true });
    return thread._id;
  },
});

export const setResolved = mutation({
  args: { ...targetArgs, resolved: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireVersion(ctx, args.pieceVersionId);
    const thread = await target(ctx, args, user);
    if ((thread.status === "resolved") === args.resolved) return thread._id;
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      status: args.resolved ? "resolved" : "open",
      resolvedBy: args.resolved ? user : undefined,
      resolvedAt: args.resolved ? now : undefined,
      lastActivityAt: now,
    });
    await ctx.db.insert("qaVisualComments", {
      threadId: thread._id,
      pieceVersionId: args.pieceVersionId,
      authorId: user,
      body: args.resolved ? "Resolvió el hilo" : "Reabrió el hilo",
      event: args.resolved ? "resolved" : "reopened",
    });
    const version = (await ctx.db.get(args.pieceVersionId))!;
    await ctx.db.patch(version._id, {
      humanActivity: true,
      openThreads: Math.max(
        0,
        (version.openThreads ?? 0) + (args.resolved ? -1 : 1),
      ),
    });
    return thread._id;
  },
});

async function ownComment(ctx: MutationCtx, id: Id<"qaVisualComments">) {
  const comment = await ctx.db.get(id);
  if (!comment || comment.event)
    throw new ConvexError("Comentario no disponible.");
  const { user } = await requireVersion(ctx, comment.pieceVersionId);
  if (comment.authorId !== user)
    throw new ConvexError({
      code: "not_author",
      message: "Solo el autor puede editar o borrar este comentario.",
    });
  return comment;
}
export const edit = mutation({
  args: { commentId: v.id("qaVisualComments"), body: v.string() },
  handler: async (ctx, args) => {
    const comment = await ownComment(ctx, args.commentId);
    if (comment.deletedAt)
      throw new ConvexError("El comentario fue eliminado.");
    await ctx.db.patch(comment._id, {
      body: commentBody(args.body),
      editedAt: Date.now(),
    });
  },
});
export const remove = mutation({
  args: { commentId: v.id("qaVisualComments") },
  handler: async (ctx, args) => {
    const comment = await ownComment(ctx, args.commentId);
    if (!comment.deletedAt)
      await ctx.db.patch(comment._id, { body: "", deletedAt: Date.now() });
  },
});
