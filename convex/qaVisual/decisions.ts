import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireVersion } from "./access";
import { exception, commentBody } from "./model/collaboration";
import { versionReview } from "./pieces";
import {
  displayReviewStatus,
  isCurrentReview,
  reviewResult,
} from "./model/verdict";
import { structuredRequirements } from "./model/contracts";

export const decide = mutation({
  args: {
    pieceVersionId: v.id("qaVisualPieceVersions"),
    expectedCurrentDecisionId: v.union(v.id("qaVisualDecisions"), v.null()),
    expectedInputHash: v.string(),
    expectedReviewId: v.union(v.id("qaVisualReviews"), v.null()),
    decision: v.union(
      v.literal("approved"),
      v.literal("changesRequested"),
      v.literal("revoked"),
    ),
    exception: v.optional(exception),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, version } = await requireVersion(ctx, args.pieceVersionId);
    if ((version.currentDecisionId ?? null) !== args.expectedCurrentDecisionId)
      throw new ConvexError({
        code: "decision_conflict",
        message:
          "Otra persona cambió la decisión. Revisá el estado actualizado antes de decidir nuevamente.",
      });
    const { latest, completed } = await versionReview(ctx, version);
    const viewed = completed ?? latest;
    if (
      version.currentInputHash !== args.expectedInputHash ||
      (viewed?._id ?? null) !== args.expectedReviewId
    )
      throw new ConvexError({
        code: "review_changed",
        message:
          "El pedido o el análisis cambió. Revisá la información actualizada antes de decidir.",
      });
    const validated =
      latest?.status === "completed" &&
      completed &&
      isCurrentReview(completed.input, version.currentInputHash) &&
      reviewResult(
        structuredRequirements(completed.input),
        completed.findings ?? [],
        completed.input.issues,
      ).verdict === "validated";
    if (args.decision === "approved" && !validated && !args.exception)
      throw new ConvexError({
        code: "exception_required",
        message:
          "Esta versión requiere una justificación para aprobar con excepción.",
      });
    if (args.exception) commentBody(args.exception.note);
    const note = args.note?.trim();
    if (note) commentBody(note);
    if (
      args.decision === "changesRequested" &&
      !note &&
      !(version.openThreads ?? 0)
    )
      throw new ConvexError({
        code: "reason_required",
        message:
          "Agregá un comentario abierto o una nota que explique los cambios solicitados.",
      });
    if (args.decision === "revoked" && !version.currentDecisionId)
      throw new ConvexError("No hay una decisión para revocar.");
    const id = await ctx.db.insert("qaVisualDecisions", {
      campaignId: version.campaignId,
      pieceId: version.pieceId,
      pieceVersionId: version._id,
      decision: args.decision,
      decidedBy: user,
      ...(note ? { note } : {}),
      ...(args.exception && args.decision === "approved"
        ? { exception: { ...args.exception, note: args.exception.note.trim() } }
        : {}),
      ...(version.currentDecisionId
        ? { supersedesId: version.currentDecisionId }
        : {}),
      aiSeen: {
        inputHash: version.currentInputHash,
        ...(latest
          ? { status: displayReviewStatus(latest, version.currentInputHash) }
          : {}),
        ...(viewed
          ? {
              reviewId: viewed._id,
              ...(viewed.verdict ? { verdict: viewed.verdict } : {}),
            }
          : {}),
        stale:
          !completed ||
          !isCurrentReview(completed.input, version.currentInputHash),
      },
    });
    await ctx.db.patch(version._id, {
      currentDecisionId: id,
      humanActivity: true,
    });
    return id;
  },
});
