import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pieceKey } from "./model/normalize";
import { chooseByName, newPieceKey } from "./model/identity";
import { findImageCopy } from "./imageCopies";

/** Called inside snapshot publication. Identity and the published pointer change together. */
export async function publishPiece(
  ctx: MutationCtx,
  campaign: Doc<"qaVisualCampaigns">,
  importPieceId: Id<"qaVisualCampaignPieces">,
  presentDriveIds: ReadonlySet<string>,
) {
  const item = (await ctx.db.get(importPieceId))!;
  const key = pieceKey(item.file.name);
  let piece = await ctx.db
    .query("qaVisualPieces")
    .withIndex("by_campaign_drive", (q) =>
      q.eq("campaignId", campaign._id).eq("driveFileId", item.file.driveId),
    )
    .first();
  let duplicate = false;
  if (!piece) {
    const matches = await ctx.db
      .query("qaVisualPieces")
      .withIndex("by_campaign_file_key", (q) =>
        q.eq("campaignId", campaign._id).eq("fileKey", key),
      )
      .take(100);
    const choice = chooseByName(matches, presentDriveIds);
    if (choice.kind === "version") piece = await ctx.db.get(choice.pieceId);
    else duplicate = choice.duplicate;
  }
  const pieceId =
    piece?._id ??
    (await ctx.db.insert("qaVisualPieces", {
      campaignId: campaign._id,
      key: newPieceKey(item.file.name, item.file.driveId, duplicate),
      fileKey: key,
      driveFileId: item.file.driveId,
      status: "active",
      versionCount: 0,
    }));
  const contentHash =
    item.input.contentHash ??
    item.file.contentHash ??
    `${item.file.driveId}:${item.file.driveVersion}`;
  const known = await ctx.db
    .query("qaVisualPieceVersions")
    .withIndex("by_piece_content", (q) =>
      q.eq("pieceId", pieceId).eq("contentHash", contentHash),
    )
    .unique();
  const number = known?.number ?? (piece?.versionCount ?? 0) + 1;
  const copy = await findImageCopy(ctx, {
    campaign: campaign.reviewKey,
    id: item.file.driveId,
    version: item.file.driveVersion,
  });
  const data = {
    driveFileId: item.file.driveId,
    driveVersion: item.file.driveVersion,
    fileName: item.file.name,
    currentInputHash: item.input.contextKey,
    currentImportPieceId: importPieceId,
    ...(copy?.files ? { copyId: copy._id } : {}),
  };
  const pieceVersionId =
    known?._id ??
    (await ctx.db.insert("qaVisualPieceVersions", {
      ...data,
      pieceId,
      campaignId: campaign._id,
      number,
      contentHash,
    }));
  if (known) await ctx.db.patch(known._id, data);
  await ctx.db.patch(pieceId, {
    fileKey: key,
    driveFileId: item.file.driveId,
    status: "active",
    currentVersionId: pieceVersionId,
    currentImportPieceId: importPieceId,
    versionCount: Math.max(number, piece?.versionCount ?? 0),
  });
  await ctx.db.patch(importPieceId, { pieceId, pieceVersionId });
  return pieceId;
}

export async function versionReview(
  ctx: QueryCtx,
  version: Doc<"qaVisualPieceVersions">,
) {
  const latest = await ctx.db
    .query("qaVisualReviews")
    .withIndex("by_version_input", (q) =>
      q
        .eq("pieceVersionId", version._id)
        .eq("input.contextKey", version.currentInputHash),
    )
    .order("desc")
    .first();
  const completed =
    latest?.status === "completed"
      ? latest
      : await ctx.db
          .query("qaVisualReviews")
          .withIndex("by_version_input", (q) =>
            q
              .eq("pieceVersionId", version._id)
              .eq("input.contextKey", version.currentInputHash)
              .eq("status", "completed"),
          )
          .order("desc")
          .first();
  return { latest, completed };
}

export function humanState(
  version: Doc<"qaVisualPieceVersions">,
  decision: Doc<"qaVisualDecisions"> | null,
) {
  return decision?.decision === "approved"
    ? ("Aprobada" as const)
    : decision?.decision === "changesRequested"
      ? ("Cambios solicitados" as const)
      : version.humanActivity
        ? ("En revisión" as const)
        : ("Pendiente" as const);
}

export async function findingDiscussions(
  ctx: QueryCtx,
  review: Doc<"qaVisualReviews"> | null,
) {
  return Promise.all(
    (review?.findings ?? [])
      .filter((f) => f.outcome === "fail" || f.outcome === "unverifiable")
      .map(async (finding) => {
        const thread = await ctx.db
          .query("qaVisualThreads")
          .withIndex("by_finding", (q) =>
            q
              .eq("origin.reviewId", review!._id)
              .eq("origin.ruleId", finding.ruleId),
          )
          .unique();
        return {
          ruleId: finding.ruleId,
          ...(thread
            ? { threadId: thread._id, resolved: thread.status === "resolved" }
            : {}),
        };
      }),
  );
}
