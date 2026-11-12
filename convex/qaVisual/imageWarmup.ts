import { importId } from "./model/importContracts";
import { readImport, publishedId, type PublishedImportId } from "./importRead";
import { v } from "convex/values";
import { vResultValidator } from "@convex-dev/workpool";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireQaAdmin } from "./access";
import { findImageCopy } from "./imageCopies";
import { imagePool } from "./imagePool";

/**
 * Stage 3 (§13.1): after a publication every visible image gets one job in qaVisualImagePool.
 * Pages of 100 pieces are enqueued by a self-scheduling mutation so a large campaign never
 * enqueues everything in a single transaction. Jobs in flight are not enqueued twice.
 */
const PAGE = 100;
const JOB_TTL_MS = 15 * 60 * 1000;

async function currentSnapshot(ctx: QueryCtx, snapshotId: PublishedImportId) {
  const snapshot = await readImport(ctx, snapshotId);
  if (!snapshot) return null;
  const campaign = await ctx.db.get(snapshot.campaignId);
  if (campaign?.status !== "active" || publishedId(campaign) !== snapshotId)
    return null;
  return { snapshot, campaign };
}

export async function queueImageWarmup(
  ctx: MutationCtx,
  snapshotId: PublishedImportId,
): Promise<void> {
  const current = await currentSnapshot(ctx, snapshotId);
  if (!current || current.snapshot.imageWarmupComplete) return;
  const jobId = current.snapshot.imageWarmupJobId;
  const job = jobId && (await ctx.db.system.get("_scheduled_functions", jobId));
  if (job?.state.kind === "pending" || job?.state.kind === "inProgress") return;
  const next = await ctx.scheduler.runAfter(0, internal.qaVisual.imageWarmup.enqueuePage, {
    snapshotId,
    offset: 0,
  });
  await ctx.db.patch(snapshotId, { imageWarmupJobId: next });
}

export const request = mutation({
  args: { snapshotId: importId },
  handler: async (ctx, { snapshotId }): Promise<void> => {
    await requireQaAdmin(ctx);
    await queueImageWarmup(ctx, snapshotId);
  },
});

/** Enqueues one image job unless the copy is ready or a recent job is still running. */
export async function enqueueImage(
  ctx: MutationCtx,
  file: { campaign: string; folderId: string; id: string; version: string },
  force = false,
) {
  const copy = await findImageCopy(ctx, file);
  if (copy?.files) return copy._id;
  if (copy?.job && copy.job.at > Date.now() - JOB_TTL_MS) return copy._id;
  if (copy?.error && !force) return copy._id;
  const workId = await imagePool.enqueueAction(
    ctx,
    internal.qaVisual.prepareImages.prepareOne,
    file,
    {
      onComplete: internal.qaVisual.imageWarmup.onPrepared,
      context: { campaign: file.campaign, id: file.id, version: file.version },
    },
  );
  const job = { workId: String(workId), at: Date.now() };
  if (copy) {
    await ctx.db.patch(copy._id, { job, error: undefined });
    return copy._id;
  }
  return ctx.db.insert("qaVisualImageCopies", {
    campaign: file.campaign,
    driveId: file.id,
    driveVersion: file.version,
    job,
  });
}

export const enqueuePage = internalMutation({
  args: { snapshotId: importId, offset: v.number() },
  handler: async (ctx, { snapshotId, offset }): Promise<void> => {
    const current = await currentSnapshot(ctx, snapshotId);
    if (!current) return;
    const nextId = ctx.db.normalizeId("qaVisualImports", snapshotId);
    const rows = nextId
      ? await ctx.db
          .query("qaVisualImportPieces")
          .withIndex("by_import_visible", (q) =>
            q.eq("importId", nextId).eq("disposition", "active").gte("order", offset),
          )
          .take(PAGE + 1)
      : await ctx.db
          .query("qaVisualCampaignPieces")
          .withIndex("by_snapshot", (q) =>
            q
              .eq("snapshotId", snapshotId as Id<"qaVisualCampaignSnapshots">)
              .gte("order", offset),
          )
          .take(PAGE + 1);
    for (const { file } of rows.slice(0, PAGE))
      await enqueueImage(ctx, {
        campaign: current.campaign.reviewKey,
        folderId: current.snapshot.deploymentFolderId,
        id: file.driveId,
        version: file.driveVersion,
      });
    const following = rows[PAGE]?.order;
    if (following !== undefined) {
      const jobId = await ctx.scheduler.runAfter(0, internal.qaVisual.imageWarmup.enqueuePage, {
        snapshotId,
        offset: following,
      });
      await ctx.db.patch(snapshotId, { imageWarmupJobId: jobId });
    } else {
      await ctx.db.patch(snapshotId, {
        imageWarmupJobId: undefined,
        imageWarmupComplete: true,
      });
    }
  },
});

/** Pool callback: clears the job marker and keeps a readable error for the piece card. */
export const onPrepared = internalMutation({
  args: {
    workId: v.string(),
    result: vResultValidator,
    context: v.object({ campaign: v.string(), id: v.string(), version: v.string() }),
  },
  handler: async (ctx, { workId, result, context }) => {
    const copy = await findImageCopy(ctx, context);
    if (!copy || (copy.job && copy.job.workId !== workId)) return;
    const error =
      result.kind === "failed" && !copy.files
        ? imageErrorMessage(result.error)
        : undefined;
    await ctx.db.patch(copy._id, {
      job: undefined,
      ...(error ? { error } : {}),
      ...(result.kind === "success" ? { error: undefined } : {}),
    });
  },
});

function imageErrorMessage(error: string) {
  if (/supera el tamaño|tamaño admitido|limitInputPixels|pixel/i.test(error))
    return "La imagen supera el tamaño admitido (20 MB o 32 megapíxeles).";
  if (/cambió o ya no está/i.test(error))
    return "La imagen cambió o ya no está en DESPLIEGUE. Actualizá desde Drive.";
  if (/compatible/i.test(error)) return "El archivo no es una imagen PNG o JPEG válida.";
  return "No se pudo preparar la imagen. Volvé a intentarlo desde la pieza.";
}

/** Manual retry for a piece whose image failed (button in the viewer). */
export const retryImage = mutation({
  args: { pieceVersionId: v.id("qaVisualPieceVersions") },
  handler: async (ctx, { pieceVersionId }) => {
    await requireQaAdmin(ctx);
    const version = await ctx.db.get(pieceVersionId);
    const campaign = version && (await ctx.db.get(version.campaignId));
    const snapshotId = campaign && publishedId(campaign);
    const snapshot = snapshotId ? await readImport(ctx, snapshotId) : null;
    if (!version || !campaign || !snapshot) return;
    await enqueueImage(
      ctx,
      {
        campaign: campaign.reviewKey,
        folderId: snapshot.deploymentFolderId,
        id: version.driveFileId,
        version: version.driveVersion,
      },
      true,
    );
  },
});
