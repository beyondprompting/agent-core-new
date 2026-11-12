import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { vOnCompleteArgs, type WorkId } from "@convex-dev/workpool";
import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireCampaign } from "./access";
import { importPool } from "./importPool";
import {
  EMPTY_COUNTS,
  TEMPLATE_VERSION,
  importTrigger,
  importBuildStage,
  importError,
  importMetadata,
  preparedPiece,
  MAX_CHUNK_BYTES,
} from "./model/importContracts";
import { PARSER_VERSION } from "./model/contracts";
import { publishedId, readImport } from "./importRead";
import { queueImageWarmup } from "./imageWarmup";

const live = (row: Doc<"qaVisualImports">) =>
  ["queued", "running", "building"].includes(row.status);
const requestArgs = { importId: v.id("qaVisualImports"), epoch: v.number() };
async function owned(ctx: QueryCtx, id: Id<"qaVisualImports">, epoch?: number) {
  const row = await ctx.db.get(id);
  if (!row || !live(row) || (epoch !== undefined && row.epoch !== epoch))
    return null;
  const campaign = await ctx.db.get(row.campaignId);
  return campaign?.status === "active" && campaign.activeImportId === id
    ? { row, campaign }
    : null;
}
export async function requestImport(
  ctx: MutationCtx,
  campaignId: Id<"qaVisualCampaigns">,
  trigger: Doc<"qaVisualImports">["trigger"],
  requestedBy?: Id<"users">,
): Promise<Id<"qaVisualImports">> {
  const campaign = await ctx.db.get(campaignId);
  if (campaign?.status !== "active")
    throw new ConvexError("La campaña ya no está disponible.");
  if (campaign.activeImportId)
    throw new ConvexError("Ya hay una importación en curso.");
  const now = Date.now();
  const id = await ctx.db.insert("qaVisualImports", {
    campaignId,
    trigger,
    ...(requestedBy ? { requestedBy } : {}),
    status: "queued",
    stage: "listing",
    parserVersion: String(PARSER_VERSION),
    templateVersion: TEMPLATE_VERSION,
    epoch: 0,
    startedAt: now,
    updatedAt: now,
    rules: [],
    notices: [],
    counts: EMPTY_COUNTS,
    manifest: [],
    receipts: [],
    ignoredFiles: [],
    missingImages: [],
    excludedPieceIds: [],
  });
  const workId = await importPool.enqueueAction(
    ctx,
    internal.qaVisual.importJob.run,
    { importId: id },
    {
      onComplete: internal.qaVisual.imports.onComplete,
      context: { importId: id },
    },
  );
  await ctx.db.patch(id, { workId });
  await ctx.db.patch(campaignId, {
    activeImportId: id,
    sync: undefined,
    syncError: undefined,
    syncNeedsSources: undefined,
  });
  return id;
}
export const request = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    trigger: v.optional(importTrigger),
  },
  handler: async (ctx, args): Promise<Id<"qaVisualImports">> => {
    const { user } = await requireCampaign(ctx, args.campaignId);
    return requestImport(ctx, args.campaignId, args.trigger ?? "manual", user);
  },
});
export const start = internalMutation({
  args: { importId: v.id("qaVisualImports") },
  handler: async (
    ctx,
    { importId },
  ): Promise<{
    row: Doc<"qaVisualImports">;
    campaign: Doc<"qaVisualCampaigns">;
    epoch: number;
  } | null> => {
    const current = await owned(ctx, importId);
    if (!current) return null;
    const epoch = current.row.epoch + 1;
    await ctx.db.patch(importId, {
      epoch,
      status: current.row.planStorageId ? "building" : "running",
      updatedAt: Date.now(),
    });
    return { ...current, epoch };
  },
});
export const progress = internalMutation({
  args: { ...requestArgs, stage: importBuildStage },
  handler: async (ctx, args): Promise<boolean> => {
    if (!(await owned(ctx, args.importId, args.epoch))) return false;
    await ctx.db.patch(args.importId, {
      stage: args.stage,
      updatedAt: Date.now(),
    });
    return true;
  },
});
// Page each history separately: a campaign may accumulate many versions while
// each import still contains at most 1000 current files.
export const context = internalQuery({
  args: {
    ...requestArgs,
    kind: v.union(
      v.literal("pieces"),
      v.literal("versions"),
      v.literal("overrides"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (!current) return null;
    const campaignId = current.campaign._id;
    if (args.kind === "pieces") {
      const page = await ctx.db
        .query("qaVisualPieces")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .paginate(args.paginationOpts);
      return {
        ...page,
        kind: "pieces" as const,
        page: page.page
          .filter((p) => p.status !== "staged")
          .map((p) => ({
            id: p._id,
            key: p.key,
            baseKey: p.baseKey ?? p.fileKey,
            driveFileId: p.driveFileId,
            status: p.status,
            createdAt: p._creationTime,
            ...(p.duplicateOf ? { duplicateOf: p.duplicateOf } : {}),
          })),
      };
    }
    if (args.kind === "versions") {
      const page = await ctx.db
        .query("qaVisualPieceVersions")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .paginate(args.paginationOpts);
      return {
        ...page,
        kind: "versions" as const,
        page: page.page
          .filter((v) => v.status !== "staged")
          .map((v) => ({
            id: v._id,
            pieceId: v.pieceId,
            ...(v.originalPieceId
              ? { originalPieceId: v.originalPieceId }
              : {}),
            driveFileId: v.driveFileId,
            contentHash: v.contentHash,
          })),
      };
    }
    const page = await ctx.db
      .query("qaVisualLinkOverrides")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .paginate(args.paginationOpts);
    return {
      ...page,
      kind: "overrides" as const,
      page: page.page.filter((o) => !o.revokedAt),
    };
  },
});
export const stored = internalQuery({
  args: { ...requestArgs },
  handler: async (ctx, args) => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (!current) return null;
    const id = publishedId(current.campaign);
    const row = id ? await readImport(ctx, id) : null;
    if (!row) return null;
    const excel = await ctx.db.get(row.excelDocumentId),
      csv = await ctx.db.get(row.csvDocumentId);
    if (!excel || !csv) return null;
    return {
      excel,
      csv,
      deploymentFolderId: row.deploymentFolderId,
    };
  },
});
export const setPlan = internalMutation({
  args: { ...requestArgs, ...importMetadata, planStorageId: v.id("_storage") },
  handler: async (ctx, { importId, epoch, ...data }): Promise<boolean> => {
    const current = await owned(ctx, importId, epoch);
    if (!current) return false;
    if (current.row.planStorageId)
      return current.row.planStorageId === data.planStorageId;
    if (
      data.counts.images > 1000 ||
      data.rules.length > 20 ||
      data.notices.length > 50 ||
      data.ignoredFiles.length > 200
    )
      throw new Error("Importación fuera de los límites admitidos.");
    await ctx.db.patch(importId, {
      ...data,
      status: "building",
      stage: "writing",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const writeChunk = internalMutation({
  args: {
    ...requestArgs,
    offset: v.number(),
    hash: v.string(),
    pieces: v.array(preparedPiece),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (!current) return false;
    const { row, campaign } = current;
    if (
      row.status !== "building" ||
      !row.planStorageId ||
      !Number.isInteger(args.offset) ||
      args.offset < 0 ||
      args.pieces.length < 1 ||
      args.pieces.length > 50 ||
      new TextEncoder().encode(JSON.stringify(args.pieces)).length >
        MAX_CHUNK_BYTES
    )
      throw new Error("Lote de importación inválido.");
    const receipt = row.receipts.find((r) => r.offset === args.offset);
    if (receipt) {
      if (receipt.hash !== args.hash || receipt.count !== args.pieces.length)
        throw new Error("El reintento cambió el contenido del lote.");
      return true;
    }
    if (
      args.offset !== row.manifest.length ||
      args.offset + args.pieces.length > row.counts.images
    )
      throw new Error("Lote fuera de orden.");
    const manifest = [...row.manifest];
    for (const [i, item] of args.pieces.entries()) {
      const order = args.offset + i;
      let piece = item.identity.pieceId
        ? await ctx.db.get(item.identity.pieceId)
        : await ctx.db
            .query("qaVisualPieces")
            .withIndex("by_campaign_key", (q) =>
              q.eq("campaignId", campaign._id).eq("key", item.identity.key),
            )
            .filter((q) =>
              q.or(
                q.neq(q.field("status"), "staged"),
                q.eq(q.field("stagedImportId"), row._id),
              ),
            )
            .unique();
      if (
        piece &&
        (piece.campaignId !== campaign._id ||
          piece.key !== item.identity.key ||
          (piece.status === "staged" && piece.stagedImportId !== row._id))
      )
        throw new Error("Identidad de pieza inválida.");
      if (!piece) {
        const id = await ctx.db.insert("qaVisualPieces", {
          campaignId: campaign._id,
          key: item.identity.key,
          baseKey: item.identity.baseKey,
          fileKey: item.identity.baseKey,
          driveFileId: item.file.driveId,
          status: "staged",
          stagedImportId: row._id,
          versionCount: 0,
        });
        piece = (await ctx.db.get(id))!;
      }
      const importPieceId = await ctx.db.insert("qaVisualImportPieces", {
        importId: row._id,
        order,
        file: item.file,
        input: item.input,
        display: item.display,
        disposition: item.identity.disposition,
        pieceId: piece._id,
        requirementsHash: item.input.requirementsHash ?? "",
        inputHash: item.input.contextKey,
      });
      const contentHash = item.input.contentHash ?? item.file.contentHash;
      if (!contentHash)
        throw new Error("Falta el hash de contenido de la imagen.");
      let version = await ctx.db
        .query("qaVisualPieceVersions")
        .withIndex("by_piece_content", (q) =>
          q.eq("pieceId", piece!._id).eq("contentHash", contentHash),
        )
        .filter((q) =>
          q.or(
            q.neq(q.field("status"), "staged"),
            q.eq(q.field("stagedImportId"), row._id),
          ),
        )
        .unique();
      if (version?.status === "staged" && version.stagedImportId !== row._id)
        throw new Error("Versión de otra importación.");
      let number = version?.number;
      if (!version && item.identity.sourceVersionId) {
        version = await ctx.db.get(item.identity.sourceVersionId);
        if (
          !version ||
          version.campaignId !== campaign._id ||
          version.status === "staged" ||
          version.contentHash !== contentHash
        )
          throw new Error("Versión de origen inválida para la fusión.");
        number = undefined;
      }
      if (number === undefined) {
        const last = await ctx.db
          .query("qaVisualPieceVersions")
          .withIndex("by_piece", (q) => q.eq("pieceId", piece!._id))
          .filter((q) =>
            q.or(
              q.neq(q.field("status"), "staged"),
              q.eq(q.field("stagedImportId"), row._id),
            ),
          )
          .order("desc")
          .first();
        number =
          Math.max(
            last?.number ?? 0,
            ...manifest
              .filter((m) => m.pieceId === piece!._id)
              .map((m) => m.number),
          ) + 1;
      }
      if (!version) {
        const id = await ctx.db.insert("qaVisualPieceVersions", {
          pieceId: piece._id,
          campaignId: campaign._id,
          number,
          contentHash,
          driveFileId: item.file.driveId,
          driveVersion: item.file.driveVersion,
          fileName: item.file.name,
          driveCreatedAt: item.file.createdAt ?? 0,
          status: "staged",
          stagedImportId: row._id,
          currentInputHash: item.input.contextKey,
          currentImportPieceId: importPieceId,
        });
        version = (await ctx.db.get(id))!;
      }
      await ctx.db.patch(importPieceId, { pieceVersionId: version._id });
      const { title: _title, ...compactDisplay } = item.display;
      manifest.push({
        pieceId: piece._id,
        versionId: version._id,
        importPieceId,
        ...(item.identity.duplicateOfKey
          ? { duplicateOfKey: item.identity.duplicateOfKey }
          : {}),
        disposition: item.identity.disposition,
        display: compactDisplay,
        driveFileId: item.file.driveId,
        driveVersion: item.file.driveVersion,
        driveCreatedAt: item.file.createdAt ?? 0,
        number,
      });
    }
    if (
      new TextEncoder().encode(JSON.stringify({ ...row, manifest })).length >
      900_000
    )
      throw new Error("El manifiesto supera el tamaño admitido.");
    await ctx.db.patch(row._id, {
      manifest,
      receipts: [
        ...row.receipts,
        { offset: args.offset, count: args.pieces.length, hash: args.hash },
      ],
      updatedAt: Date.now(),
    });
    return true;
  },
});

async function publishManifest(
  ctx: MutationCtx,
  campaign: Doc<"qaVisualCampaigns">,
  row: Doc<"qaVisualImports">,
) {
  if (row.manifest.length !== row.counts.images)
    throw new Error("La importación todavía no está completa.");
  const pieceRows = new Map<Id<"qaVisualPieces">, Doc<"qaVisualPieces">>();
  for (const m of row.manifest)
    if (!pieceRows.has(m.pieceId)) {
      const piece = await ctx.db.get(m.pieceId);
      if (!piece) throw new Error("Pieza incompleta.");
      pieceRows.set(m.pieceId, piece);
    }
  // A duplicate can arrive later even though it was created earlier in Drive.
  // Reorder only the version numbers involved in a confirmed merge; IDs and
  // their reviews/decisions stay attached to the same creative content.
  const mergedNumbers = new Map<Id<"qaVisualPieceVersions">, number>();
  for (const pieceId of pieceRows.keys()) {
    const entries = row.manifest.filter((m) => m.pieceId === pieceId);
    if (!entries.some((m) => m.disposition === "historical")) continue;
    const unique = [...new Map(entries.map((m) => [m.versionId, m])).values()];
    const numbers = unique.map((m) => m.number).sort((a, b) => a - b);
    unique.sort(
      (a, b) =>
        a.driveCreatedAt - b.driveCreatedAt ||
        a.driveFileId.localeCompare(b.driveFileId),
    );
    unique.forEach((m, i) => mergedNumbers.set(m.versionId, numbers[i]));
  }
  const identities = new Map(
    [...pieceRows.values()].map((p) => [p.key, p._id]),
  );
  const active = new Set(
    row.manifest
      .filter((m) => m.disposition === "active")
      .map((m) => m.pieceId),
  );
  const excluded = new Set([
    ...row.excludedPieceIds,
    ...row.manifest
      .filter((m) => m.disposition === "excluded")
      .map((m) => m.pieceId),
  ]);
  for (const [order, m] of row.manifest.entries()) {
    const version = await ctx.db.get(m.versionId);
    if (
      !version ||
      (version.status === "staged" && version.stagedImportId !== row._id)
    )
      throw new Error("Versión incompleta o ajena.");
    const next = {
      ...(version.pieceId !== m.pieceId
        ? { originalPieceId: version.originalPieceId ?? version.pieceId }
        : {}),
      pieceId: m.pieceId,
      number: mergedNumbers.get(m.versionId) ?? m.number,
      status: "active" as const,
      stagedImportId: undefined,
      driveFileId: m.driveFileId,
      driveVersion: m.driveVersion,
      fileName: m.display.fileName,
      driveCreatedAt: m.driveCreatedAt,
      currentImportPieceId: m.importPieceId,
      currentInputHash: m.display.inputHash,
    };
    // Historical entries in a confirmed merge remain accessible as versions.
    await ctx.db.patch(version._id, next);
    if (
      m.disposition === "historical" &&
      row.manifest.some(
        (n) => n.pieceId === m.pieceId && n.disposition === "active",
      )
    )
      continue;
    const piece = pieceRows.get(m.pieceId)!;
    await ctx.db.patch(piece._id, {
      status: m.disposition === "excluded" ? "excluded" : "active",
      stagedImportId: undefined,
      baseKey: piece.baseKey ?? piece.fileKey,
      driveFileId: m.driveFileId,
      duplicateOf: m.duplicateOfKey
        ? identities.get(m.duplicateOfKey)
        : undefined,
      currentVersionId: m.versionId,
      currentImportPieceId: m.importPieceId,
      order,
      display: {
        ...m.display,
        title: m.display.fileName.replace(/\.[^.]+$/, ""),
      },
      versionCount: Math.max(
        piece.versionCount,
        ...row.manifest
          .filter((n) => n.pieceId === piece._id)
          .map((n) => n.number),
      ),
    });
  }
  const previous = await ctx.db
    .query("qaVisualPieces")
    .withIndex("by_campaign", (q) =>
      q.eq("campaignId", campaign._id).eq("status", "active"),
    )
    .collect();
  for (const piece of previous)
    if (!active.has(piece._id))
      await ctx.db.patch(piece._id, {
        status: excluded.has(piece._id) ? "excluded" : "removed",
      });
  for (const id of row.excludedPieceIds)
    if (!active.has(id))
      await ctx.db.patch(id, {
        status: "excluded",
        currentVersionId: undefined,
        currentImportPieceId: undefined,
      });
  if (campaign.currentImportId && campaign.currentImportId !== row._id)
    await ctx.db.patch(campaign.currentImportId, { status: "superseded" });
  await ctx.db.patch(row._id, {
    status: "ready",
    error: undefined,
    finishedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await ctx.db.patch(campaign._id, {
    currentImportId: row._id,
    activeImportId: undefined,
    driveFolderName: row.driveFolderName,
    lastSyncedAt: Date.now(),
    sync: undefined,
    syncError: undefined,
    syncNeedsSources: undefined,
  });
  // Keep the existing image runner; moving images to their own pool is stage 3.
  await queueImageWarmup(ctx, row._id);
}
export const publish = internalMutation({
  args: requestArgs,
  handler: async (ctx, args): Promise<boolean> => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (!current) return false;
    if (current.row.status !== "building")
      throw new Error("Importación sin preparar.");
    await publishManifest(ctx, current.campaign, current.row);
    return true;
  },
});
export const reuse = internalMutation({
  args: { ...requestArgs, fingerprint: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (!current) return true;
    const matching = (status: "ready" | "superseded") =>
      ctx.db
        .query("qaVisualImports")
        .withIndex("by_campaign_fingerprint", (q) =>
          q
            .eq("campaignId", current.campaign._id)
            .eq("fingerprint", args.fingerprint)
            .eq("status", status),
        )
        .first();
    const match = (await matching("ready")) ?? (await matching("superseded"));
    if (!match) return false;
    if (current.campaign.currentImportId === match._id)
      await ctx.db.patch(current.campaign._id, {
        activeImportId: undefined,
        lastSyncedAt: Date.now(),
        syncError: undefined,
        syncNeedsSources: undefined,
      });
    else await publishManifest(ctx, current.campaign, match);
    if (current.row.planStorageId)
      await ctx.storage.delete(current.row.planStorageId);
    await ctx.db.delete(current.row._id);
    return true;
  },
});
async function failImport(
  ctx: MutationCtx,
  row: Doc<"qaVisualImports">,
  error: Doc<"qaVisualImports">["error"],
) {
  if (!live(row)) return;
  // Fence first, then delete asynchronously. Late workers cannot write or publish.
  await ctx.db.patch(row._id, {
    status: "failed",
    error,
    finishedAt: Date.now(),
    updatedAt: Date.now(),
  });
  const campaign = await ctx.db.get(row.campaignId);
  if (campaign?.activeImportId === row._id)
    await ctx.db.patch(campaign._id, {
      activeImportId: undefined,
      syncError: error?.message,
      syncNeedsSources: error?.code === "needs_source",
    });
  await ctx.scheduler.runAfter(0, internal.qaVisual.imports.cleanup, {
    importId: row._id,
  });
}
export const fail = internalMutation({
  args: { ...requestArgs, error: importError },
  handler: async (ctx, args): Promise<void> => {
    const current = await owned(ctx, args.importId, args.epoch);
    if (current) await failImport(ctx, current.row, args.error);
  },
});
export const retryError = internalMutation({
  args: { ...requestArgs, error: importError },
  handler: async (ctx, args): Promise<void> => {
    if (await owned(ctx, args.importId, args.epoch))
      await ctx.db.patch(args.importId, {
        error: args.error,
        updatedAt: Date.now(),
      });
  },
});
export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ importId: v.id("qaVisualImports") })),
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.context.importId);
    if (!row || row.workId !== args.workId || !live(row)) return;
    await failImport(
      ctx,
      row,
      args.result.kind === "failed" && row.error
        ? row.error
        : {
            code:
              args.result.kind === "canceled" ? "cancelled" : "import_failed",
            message:
              args.result.kind === "failed"
                ? "No se pudo completar la importación después de los reintentos. Volvé a actualizar desde Drive."
                : "Se interrumpió la importación. Volvé a actualizar desde Drive.",
            retryable: true,
          },
    );
  },
});
export const cleanup = internalMutation({
  args: { importId: v.id("qaVisualImports") },
  handler: async (ctx, { importId }): Promise<void> => {
    const row = await ctx.db.get(importId);
    if (!row || row.status !== "failed" || row.cleanedAt) return;
    const campaign = await ctx.db.get(row.campaignId);
    if (
      campaign?.activeImportId === importId ||
      campaign?.currentImportId === importId
    )
      throw new Error("No se puede limpiar una importación visible o activa.");
    const items = await ctx.db
      .query("qaVisualImportPieces")
      .withIndex("by_import_order", (q) => q.eq("importId", importId))
      .take(50);
    for (const item of items) await ctx.db.delete(item._id);
    const versions = await ctx.db
      .query("qaVisualPieceVersions")
      .withIndex("by_staged_import", (q) => q.eq("stagedImportId", importId))
      .take(50);
    for (const version of versions)
      if (version.status === "staged") await ctx.db.delete(version._id);
    const pieces = await ctx.db
      .query("qaVisualPieces")
      .withIndex("by_staged_import", (q) => q.eq("stagedImportId", importId))
      .take(50);
    for (const piece of pieces)
      if (piece.status === "staged") await ctx.db.delete(piece._id);
    if (items.length === 50 || versions.length === 50 || pieces.length === 50) {
      await ctx.scheduler.runAfter(0, internal.qaVisual.imports.cleanup, {
        importId,
      });
      return;
    }
    if (row.planStorageId) await ctx.storage.delete(row.planStorageId);
    await ctx.db.patch(importId, {
      planStorageId: undefined,
      manifest: [],
      receipts: [],
      cleanedAt: Date.now(),
    });
  },
});
export const sweep = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    for (const status of ["queued", "running", "building"] as const) {
      const rows = await ctx.db
        .query("qaVisualImports")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", status).lt("updatedAt", Date.now() - 30 * 60_000),
        )
        .take(20);
      for (const row of rows) {
        await failImport(ctx, row, {
          code: "stalled",
          message:
            "La importación dejó de avanzar. Volvé a actualizar desde Drive.",
          retryable: true,
        });
        if (row.workId) await importPool.cancel(ctx, row.workId as WorkId);
      }
    }
    const failed = await ctx.db
      .query("qaVisualImports")
      .withIndex("by_cleanup", (q) =>
        q.eq("status", "failed").eq("cleanedAt", undefined),
      )
      .take(20);
    for (const row of failed)
      if (!row.cleanedAt)
        await ctx.scheduler.runAfter(0, internal.qaVisual.imports.cleanup, {
          importId: row._id,
        });
  },
});

/** Run explicitly after a parser/template release. This queues QA only. */
export const reprocessActive = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (
    ctx,
    { cursor },
  ): Promise<{ queued: number; busy: number; isDone: boolean }> => {
    const page = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    let queued = 0,
      busy = 0;
    for (const campaign of page.page) {
      if (campaign.activeImportId) {
        busy++;
        continue;
      }
      const current = campaign.currentImportId
        ? await ctx.db.get(campaign.currentImportId)
        : null;
      if (
        current?.parserVersion === String(PARSER_VERSION) &&
        current.templateVersion === TEMPLATE_VERSION
      )
        continue;
      if (!publishedId(campaign)) continue;
      await requestImport(ctx, campaign._id, "parserUpgrade");
      queued++;
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.qaVisual.imports.reprocessActive,
        { cursor: page.continueCursor },
      );
    return { queued, busy, isDone: page.isDone };
  },
});
