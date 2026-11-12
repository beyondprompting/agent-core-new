import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireCampaign } from "./access";
import { structuredRequirements } from "./model/contracts";
import { humanState, versionReview } from "./pieces";
import { findImageCopy } from "./imageCopies";
import { displayReviewStatus } from "./model/verdict";

export async function authorName(ctx: QueryCtx, id: Id<"users">) {
  const user = await ctx.db.get(id);
  return user?.name || user?.email || "Revisor";
}

export const piece = query({
  args: { pieceId: v.id("qaVisualPieces"), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const piece = await ctx.db.get(args.pieceId);
    if (!piece) return null;
    const { campaign, user } = await requireCampaign(ctx, piece.campaignId);
    const versions = await ctx.db
      .query("qaVisualPieceVersions")
      .withIndex("by_piece", (q) => q.eq("pieceId", piece._id))
      .order("desc")
      .take(201);
    const version = args.version
      ? await ctx.db
          .query("qaVisualPieceVersions")
          .withIndex("by_piece", (q) =>
            q.eq("pieceId", piece._id).eq("number", args.version!),
          )
          .unique()
      : piece.currentVersionId
        ? await ctx.db.get(piece.currentVersionId)
        : null;
    if (!version) return null;
    const item = await ctx.db.get(version.currentImportPieceId);
    const { latest, completed } = await versionReview(ctx, version);
    const reviewHistory = await ctx.db
      .query("qaVisualReviews")
      .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
      .order("desc")
      .take(101);
    const decision = version.currentDecisionId
      ? await ctx.db.get(version.currentDecisionId)
      : null;
    const threads = await ctx.db
      .query("qaVisualThreads")
      .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
      .take(201);
    const decisions = await ctx.db
      .query("qaVisualDecisions")
      .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
      .order("desc")
      .take(101);
    const copy = version.copyId
      ? await ctx.db.get(version.copyId)
      : await findImageCopy(ctx, {
          campaign: campaign.reviewKey,
          id: version.driveFileId,
          version: version.driveVersion,
        });
    return {
      pieceId: piece._id,
      versionId: version._id,
      number: version.number,
      currentVersionId: piece.currentVersionId,
      currentDecisionId: version.currentDecisionId ?? null,
      inputHash: version.currentInputHash,
      file: item?.file,
      production: item?.input.production,
      requirements: item ? structuredRequirements(item.input) : [],
      issues: item?.input.issues ?? [],
      imageReady: Boolean(copy?.files),
      imageSnapshot: copy?.files?.snapshot,
      humanStatus: humanState(version, decision),
      decision: decision
        ? {
            ...decision,
            author: await authorName(ctx, decision.decidedBy),
            outdated: decision.aiSeen.inputHash !== version.currentInputHash,
          }
        : null,
      latestStatus: latest
        ? displayReviewStatus(latest, version.currentInputHash)
        : reviewHistory.length
          ? ("stale" as const)
          : null,
      previousVerdict: reviewHistory.find((r) => r.status === "completed")
        ?.verdict,
      review: completed ?? latest,
      running:
        latest && !["completed", "failed"].includes(latest.status)
          ? latest.status
          : null,
      moreReviews: reviewHistory.length > 100,
      moreDecisions: decisions.length > 100,
      moreVersions: versions.length > 200,
      reviewHistory: reviewHistory.slice(0, 100).map((r) => ({
        id: r._id,
        at: r._creationTime,
        status: r.status,
        verdict: r.verdict,
        error: r.error,
      })),
      versions: await Promise.all(
        versions.slice(0, 200).map(async (v) => ({
          id: v._id,
          number: v.number,
          fileName: v.fileName,
          at: v._creationTime,
          humanStatus: humanState(
            v,
            v.currentDecisionId ? await ctx.db.get(v.currentDecisionId) : null,
          ),
        })),
      ),
      threads: await Promise.all(
        threads.slice(0, 200).map(async (thread) => {
          const comments = await ctx.db
            .query("qaVisualComments")
            .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
            .take(201);
          const review =
            thread.origin.kind === "finding"
              ? await ctx.db.get(thread.origin.reviewId)
              : null;
          const ruleId =
            thread.origin.kind === "finding" ? thread.origin.ruleId : null;
          return {
            ...thread,
            author: await authorName(ctx, thread.createdBy),
            finding: review?.findings?.find((f) => f.ruleId === ruleId) ?? null,
            comments: await Promise.all(
              comments.slice(0, 200).map(async (c) => ({
                ...c,
                body: c.deletedAt ? "Comentario eliminado" : c.body,
                author: await authorName(ctx, c.authorId),
                canEdit: c.authorId === user && !c.deletedAt && !c.event,
              })),
            ),
            moreComments: comments.length > 200,
          };
        }),
      ),
      moreThreads: threads.length > 200,
      decisions: await Promise.all(
        decisions.slice(0, 100).map(async (d) => ({
          ...d,
          author: await authorName(ctx, d.decidedBy),
        })),
      ),
    };
  },
});
