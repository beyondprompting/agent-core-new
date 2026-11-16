import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Infer } from "convex/values";
import { changesRequestedOn } from "./clientChanges";
import { requireCampaign, requireVersion } from "./access";
import { exception, commentBody } from "./model/collaboration";
import { versionAiValidated, versionReview } from "./pieces";
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
    if (args.decision === "approved" && version.currentDecisionId) {
      const current = await ctx.db.get(version.currentDecisionId);
      if (
        current?.decision === "approved" &&
        current.aiSeen.inputHash === version.currentInputHash
      )
        throw new ConvexError({
          code: "already_approved",
          message: "Esta versión ya tiene una aprobación vigente.",
        });
    }
    if (args.decision === "approved") {
      const delivered = await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
        .take(10);
      if (changesRequestedOn(delivered))
        throw new ConvexError({
          code: "client_changes",
          message:
            "El cliente pidió cambios en esta versión. Subí una versión nueva en Drive: tendrá su propio análisis y aprobación.",
        });
    }
    const validated = await versionAiValidated(ctx, version);
    if (args.decision === "approved" && !validated && !args.exception)
      throw new ConvexError({
        code: "exception_required",
        message:
          "Esta versión requiere una justificación para aprobar con excepción.",
      });
    if (args.exception) commentBody(args.exception.note);
    const note = args.note?.trim();
    if (note) commentBody(note);
    if (args.decision === "changesRequested" && !note)
      throw new ConvexError({
        code: "reason_required",
        message:
          "Escribí un comentario que explique qué cambios solicitás para esta versión.",
      });
    if (args.decision === "revoked" && !version.currentDecisionId)
      throw new ConvexError("No hay una decisión para revocar.");
    return recordDecision(ctx, user, version, {
      decision: args.decision,
      note,
      exception: args.exception,
    });
  },
});

/** Stores a decision for a version with what the AI showed at that moment. */
async function recordDecision(
  ctx: MutationCtx,
  user: Id<"users">,
  version: Doc<"qaVisualPieceVersions">,
  args: {
    decision: "approved" | "changesRequested" | "revoked";
    note?: string;
    exception?: Infer<typeof exception>;
  },
) {
  const note = args.note;
  const { latest, completed } = await versionReview(ctx, version);
  const viewed = completed ?? latest;
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
    // Persist the request and its discussion together: neither can exist alone.
    if (args.decision === "changesRequested" && note) {
      const threadId = await ctx.db.insert("qaVisualThreads", {
        campaignId: version.campaignId,
        pieceId: version.pieceId,
        pieceVersionId: version._id,
        origin: { kind: "human" },
        anchor: { kind: "general" },
        audience: "internal",
        status: "open",
        createdBy: user,
        lastActivityAt: Date.now(),
        commentCount: 1,
      });
      await ctx.db.insert("qaVisualComments", {
        threadId,
        pieceVersionId: version._id,
        authorId: user,
        authorKind: "internal",
        visibility: "internal",
        body: note,
      });
    }
    await ctx.db.patch(version._id, {
      currentDecisionId: id,
      humanActivity: true,
      ...(args.decision === "changesRequested"
        ? {
            openThreads: (version.openThreads ?? 0) + 1,
            threadCount: (version.threadCount ?? 0) + 1,
          }
        : {}),
    });
    return id;
}

/**
 * Approves several current versions from the gallery. Versions the AI validated are approved
 * directly; the rest only with a shared justification. Nothing is overwritten: versions
 * already approved, rejected by the client or no longer current are skipped with a reason.
 */
export const approveMany = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    pieceVersionIds: v.array(v.id("qaVisualPieceVersions")),
    exception: v.optional(exception),
  },
  handler: async (ctx, args) => {
    const { user, campaign } = await requireCampaign(ctx, args.campaignId);
    const ids = [...new Set(args.pieceVersionIds)];
    if (!ids.length || ids.length > 200)
      throw new ConvexError("Elegí entre 1 y 200 piezas para aprobar.");
    if (args.exception) commentBody(args.exception.note);
    let approved = 0;
    const skipped: { pieceVersionId: Id<"qaVisualPieceVersions">; reason: string }[] = [];
    for (const id of ids) {
      const skip = (reason: string) => skipped.push({ pieceVersionId: id, reason });
      const version = await ctx.db.get(id);
      const piece = version && (await ctx.db.get(version.pieceId));
      if (!version || !piece || version.campaignId !== campaign._id || version.status === "staged") {
        skip("La versión ya no está disponible");
        continue;
      }
      if (piece.currentVersionId !== version._id) {
        skip("Hay una versión más nueva de esta pieza");
        continue;
      }
      const current = version.currentDecisionId ? await ctx.db.get(version.currentDecisionId) : null;
      if (current?.decision === "approved" && current.aiSeen.inputHash === version.currentInputHash) {
        skip("Ya estaba aprobada");
        continue;
      }
      const delivered = await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
        .take(10);
      if (changesRequestedOn(delivered)) {
        skip("El cliente pidió cambios: necesita una versión nueva");
        continue;
      }
      const validated = await versionAiValidated(ctx, version);
      if (!validated && !args.exception) {
        skip("La IA no la validó: necesita una justificación");
        continue;
      }
      await recordDecision(ctx, user, version, {
        decision: "approved",
        ...(validated ? {} : { exception: args.exception }),
      });
      approved++;
    }
    return { approved, skipped };
  },
});
