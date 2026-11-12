"use node";
import { createHash } from "node:crypto";
import { v, type Infer } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  downloadDriveFile,
  listDriveFolder,
  DriveRequestError,
  csvLimit,
  matrixLimit,
  type DriveFile,
} from "./driveClient";
import {
  listDriveCampaign,
  deploymentPieces,
  imageMime,
  parseDriveCsv,
  DriveFolderError,
} from "./driveSource.node";
import { parseClientMatrix } from "./clientMatrix.node";
import {
  prepareAnalysisInputs,
  confirmedRulesConfig,
} from "./analysisInput.node";
import {
  PARSER_VERSION,
  ANALYSIS_POLICY_VERSION,
  structuredRequirements,
  type LinkOverride,
} from "./model/contracts";
import {
  duplicateNameIssue,
  resolveIdentities,
  type DuplicateOverride,
  type IdentityPiece,
  type IdentityVersion,
} from "./model/identity";
import {
  TEMPLATE_VERSION,
  MAX_CHUNK_BYTES,
  preparedPiece,
  importMetadata,
} from "./model/importContracts";
import { pieceKey } from "./model/normalize";
import type { QaInventory } from "../../app/lib/qa-visual/source";

type Request = { importId: Id<"qaVisualImports">; epoch: number };
type Matrix = Awaited<ReturnType<typeof parseClientMatrix>>;
type Csv = ReturnType<typeof parseDriveCsv>;
const metadataValidator = v.object(importMetadata);
type Plan = {
  metadata: Infer<typeof metadataValidator>;
  pieces: Infer<typeof preparedPiece>[];
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function source(
  ctx: ActionCtx,
  request: Request,
  campaignId: Id<"qaVisualCampaigns">,
  kind: "excel" | "csv",
  file: DriveFile,
  stored?: Doc<"qaVisualSourceFiles"> | Doc<"qaVisualSourceDocuments">,
) {
  if (!file.version) throw new Error("La fuente no tiene versión de Drive.");
  const known = await ctx.runQuery(internal.qaVisual.sourceFiles.find, {
    campaignId,
    driveFileId: file.id,
    driveVersion: file.version,
  });
  if (known?.parsedId && known.parserVersion === String(PARSER_VERSION)) {
    const blob = await ctx.storage.get(known.parsedId);
    if (blob)
      return {
        record: known,
        parsed: JSON.parse(await blob.text()) as
          | Omit<Matrix, "bytes">
          | Omit<Csv, "bytes">,
      };
  }
  const previous = known ?? stored;
  const blob = previous ? await ctx.storage.get(previous.storageId) : null;
  const bytes = blob
    ? Buffer.from(await blob.arrayBuffer())
    : await downloadDriveFile(file, kind === "excel" ? matrixLimit : csvLimit);
  if (
    !(await ctx.runMutation(internal.qaVisual.imports.progress, {
      ...request,
      stage: "parsing",
    }))
  )
    throw new Error("Importación vencida.");
  let parsed: Omit<Matrix, "bytes"> | Omit<Csv, "bytes">;
  if (kind === "excel") {
    const { bytes: _, ...data } = await parseClientMatrix(file.name, bytes);
    parsed = data;
  } else {
    const { bytes: _, ...data } = parseDriveCsv(bytes);
    parsed = data;
  }
  const storageId = blob
    ? previous!.storageId
    : await ctx.storage.store(
        new Blob([Uint8Array.from(bytes)], { type: file.mimeType }),
      );
  let parsedId: Id<"_storage"> | undefined;
  let saved = false;
  try {
    parsedId = await ctx.storage.store(
      new Blob([JSON.stringify(parsed)], { type: "application/json" }),
    );
    const record = await ctx.runMutation(internal.qaVisual.sourceFiles.save, {
      ...request,
      kind,
      driveFileId: file.id,
      driveVersion: file.version,
      ...(file.md5Checksum ? { md5: file.md5Checksum } : {}),
      sha256: sha(bytes),
      name: file.name,
      mimeType: file.mimeType,
      bytes: bytes.length,
      modifiedAt: Date.parse(file.modifiedTime ?? "") || 0,
      storageId,
      parsedId,
      parserVersion: String(PARSER_VERSION),
    });
    if (!record) throw new Error("Importación vencida.");
    saved = true;
    return { record, parsed };
  } finally {
    if (!saved)
      await ctx.runMutation(internal.qaVisual.sourceFiles.discard, {
        storageIds: [
          ...(!blob ? [storageId] : []),
          ...(parsedId ? [parsedId] : []),
        ],
      });
  }
}
function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DriveRequestError)
    return {
      code:
        error.status === 403 || error.status === 404
          ? "access_lost"
          : "drive_unavailable",
      message:
        error.status === 403 || error.status === 404
          ? "Se perdió el acceso a Google Drive. Compartí la carpeta como Lector con la cuenta de servicio."
          : "Google Drive no respondió. Volvé a intentar.",
      retryable: error.status === 429 || error.status >= 500,
    };
  if (/cambió durante la lectura/.test(message))
    return { code: "source_changed", message, retryable: true };
  if (error instanceof DriveFolderError)
    return {
      code:
        error.code === "sources"
          ? "needs_source"
          : error.code === "csv_missing"
            ? "csv_missing"
            : /1000/.test(message)
              ? "too_many_pieces"
              : "folder_invalid",
      message,
      retryable: false,
    };
  if (/ID_PIEZA|CSV inválido/.test(message))
    return { code: "csv_missing_columns", message, retryable: false };
  if (/Plantilla|PRODUCCION/.test(message))
    return { code: "template_unrecognized", message, retryable: false };
  if (/tamaño admitido|supera|demasiadas/.test(message))
    return { code: "file_too_large", message, retryable: false };
  if (
    /ZIP|zip|XML|matriz|Excel|encrypted|corrupt|central directory/i.test(
      message,
    )
  )
    return {
      code: "workbook_unreadable",
      message:
        "No se pudo abrir el Excel: está dañado, protegido o no es una matriz válida.",
      retryable: false,
    };
  return {
    code: "import_unavailable",
    message: "No se pudo completar la importación. Volvé a intentar.",
    retryable: true,
  };
}
export const run = internalAction({
  args: { importId: v.id("qaVisualImports") },
  handler: async (ctx, { importId }): Promise<void> => {
    const begun = await ctx.runMutation(internal.qaVisual.imports.start, {
      importId,
    });
    if (!begun) return;
    const request = { importId, epoch: begun.epoch };
    try {
      let plan: Plan;
      if (begun.row.planStorageId) {
        const blob = await ctx.storage.get(begun.row.planStorageId);
        if (!blob) throw new Error("No se encontró el plan guardado.");
        plan = JSON.parse(await blob.text()) as Plan;
      } else {
        const context: {
          pieces: IdentityPiece[];
          versions: IdentityVersion[];
          overrides: Doc<"qaVisualLinkOverrides">[];
        } = { pieces: [], versions: [], overrides: [] };
        for (const kind of ["pieces", "versions", "overrides"] as const) {
          let cursor: string | null = null;
          do {
            const page: FunctionReturnType<
              typeof internal.qaVisual.imports.context
            > = await ctx.runQuery(internal.qaVisual.imports.context, {
              ...request,
              kind,
              paginationOpts: { cursor, numItems: 200 },
            });
            if (!page) return;
            if (page.kind === "pieces") context.pieces.push(...page.page);
            else if (page.kind === "versions")
              context.versions.push(...page.page);
            else context.overrides.push(...page.page);
            cursor = page.isDone ? null : page.continueCursor;
          } while (cursor);
        }
        let inventory: QaInventory,
          matrixFile: DriveFile,
          csvFile: DriveFile,
          deploymentFolderId: string;
        let ignoredFiles: { name: string; reason: string }[] = [];
        let stored:
          | {
              excel:
                | Doc<"qaVisualSourceFiles">
                | Doc<"qaVisualSourceDocuments">;
              csv: Doc<"qaVisualSourceFiles"> | Doc<"qaVisualSourceDocuments">;
            }
          | undefined;
        if (
          begun.row.trigger === "reprocess" ||
          begun.row.trigger === "parserUpgrade"
        ) {
          const originals = await ctx.runQuery(
            internal.qaVisual.imports.stored,
            request,
          );
          if (!originals)
            throw new DriveFolderError(
              "No hay originales guardados para reprocesar. Actualizá desde Drive.",
            );
          stored = originals;
          const asDrive = (s: typeof originals.excel): DriveFile => ({
            id: s.driveFileId!,
            version: s.driveVersion!,
            name: s.name,
            mimeType: "mimeType" in s ? s.mimeType : "application/octet-stream",
            size: String(s.bytes ?? 0),
          });
          matrixFile = asDrive(originals.excel);
          csvFile = asDrive(originals.csv);
          deploymentFolderId = originals.deploymentFolderId;
          const deployment = await listDriveFolder(deploymentFolderId);
          ignoredFiles = deployment
            .filter((f) => !imageMime(f))
            .map((f) => ({
              name: f.name,
              reason:
                "Solo se analizan PNG y JPEG; no se recorren subcarpetas.",
            }));
          inventory = {
            campaignName: begun.campaign.driveFolderName ?? begun.campaign.name,
            matrix: null,
            csv: null,
            pieces: await deploymentPieces(deployment),
            notices: [],
          };
        } else {
          const listed = await listDriveCampaign(
            begun.campaign.driveFolderId,
            begun.campaign.sourceSelection,
            true,
          );
          if (listed.inventory.notices.length)
            throw new DriveFolderError(
              listed.inventory.notices.join(" "),
              listed.needsSources ? "sources" : undefined,
            );
          if (!listed.matrix || !listed.csv || !listed.deployment)
            throw new DriveFolderError("Faltan las fuentes de la campaña.");
          inventory = listed.inventory;
          matrixFile = listed.matrix;
          csvFile = listed.csv;
          deploymentFolderId = listed.deployment.folderId;
          ignoredFiles = listed.ignoredFiles;
        }
        if (
          !(await ctx.runMutation(internal.qaVisual.imports.progress, {
            ...request,
            stage: "downloading",
          }))
        )
          return;
        const [excelResult, csvResult] = await Promise.allSettled([
          source(
            ctx,
            request,
            begun.campaign._id,
            "excel",
            matrixFile,
            stored?.excel,
          ),
          source(ctx, request, begun.campaign._id, "csv", csvFile, stored?.csv),
        ]);
        if (excelResult.status === "rejected") throw excelResult.reason;
        if (csvResult.status === "rejected") throw csvResult.reason;
        const excel = excelResult.value,
          csv = csvResult.value;
        if (
          !(await ctx.runMutation(internal.qaVisual.imports.progress, {
            ...request,
            stage: "parsing",
          }))
        )
          return;
        const fingerprint = hash({
          parser: PARSER_VERSION,
          template: TEMPLATE_VERSION,
          policy: ANALYSIS_POLICY_VERSION,
          excel: excel.record.sha256,
          csv: csv.record.sha256,
          files: inventory.pieces
            .map((f) => [f.driveId, f.contentHash, f.name])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          overrides: context.overrides.map((o) => [o._id, o._creationTime]),
          selection: begun.campaign.sourceSelection ?? {},
          rules: confirmedRulesConfig(begun.campaign.driveFolderId) ?? null,
        });
        if (
          await ctx.runMutation(internal.qaVisual.imports.reuse, {
            ...request,
            fingerprint,
          })
        )
          return;
        if (
          !(await ctx.runMutation(internal.qaVisual.imports.progress, {
            ...request,
            stage: "linking",
          }))
        )
          return;
        const production = (csv.parsed as Omit<Csv, "bytes">).production;
        const links: LinkOverride[] = context.overrides
          .filter((o) => o.kind === "productAlias" || o.kind === "offerLink")
          .map((o) => ({
            kind: o.kind as LinkOverride["kind"],
            ...(o.pieceKey ? { pieceKey: o.pieceKey } : {}),
            ...(o.from ? { from: o.from } : {}),
            ...(o.to ? { to: o.to } : {}),
            ...(o.row ? { row: o.row } : {}),
            ...(o.ordinal ? { ordinal: o.ordinal } : {}),
            author: String(o.createdBy),
            at: o._creationTime,
          }));
        const prepared = prepareAnalysisInputs(
          begun.campaign.driveFolderId,
          { ...inventory, production },
          { ...excel.parsed, bytes: Buffer.alloc(0) } as Matrix,
          links,
        );
        const duplicateOverrides = context.overrides
          .filter(
            (o) => o.kind === "keepDuplicate" || o.kind === "mergeAsVersion",
          )
          .map((o) => ({
            kind: o.kind,
            baseKey: o.baseKey!,
            keepDriveFileId: o.keepDriveFileId,
            olderDriveFileId: o.olderDriveFileId,
            newerDriveFileId: o.newerDriveFileId,
          })) as DuplicateOverride[];
        const resolved = resolveIdentities(
          inventory.pieces,
          context.pieces,
          context.versions,
          duplicateOverrides,
        );
        const byDrive = new Map(
          inventory.pieces.map((f, i) => [
            f.driveId,
            { file: f, input: prepared.inputs[i] },
          ]),
        );
        const pieces: Plan["pieces"] = resolved.entries.map(
          ({ file: f, identity }) => {
            const { file, input: original } = byDrive.get(f.driveId)!;
            const issues = identity.duplicate
              ? [...original.issues, duplicateNameIssue(file.name)]
              : original.issues;
            const requirementsHash = hash({
              requirements: original.requirements,
              issues,
              rules: prepared.rules.filter((r) =>
                original.requirements.some((q) => q.ruleId === r.id),
              ),
            });
            const input = {
              ...original,
              issues,
              requirementsHash,
              contextKey: hash({
                contentHash: original.contentHash,
                requirementsHash,
                policyVersion: ANALYSIS_POLICY_VERSION,
              }),
            };
            const p = input.production;
            return {
              file,
              input,
              identity: {
                ...identity,
                pieceId: identity.pieceId as Id<"qaVisualPieces"> | undefined,
                sourceVersionId: identity.sourceVersionId as
                  | Id<"qaVisualPieceVersions">
                  | undefined,
              },
              display: {
                title: file.name.replace(/\.[^.]+$/, ""),
                fileName: file.name,
                format: p?.format ?? "",
                width: p?.width ?? 0,
                height: p?.height ?? 0,
                channel: p?.channel ?? "",
                phase: p?.phase ?? "",
                inputHash: input.contextKey,
                warning: issues.filter((i) => i.severity === "warning").length,
                blocking: issues.filter((i) => i.severity === "blocking")
                  .length,
              },
            };
          },
        );
        const imageKeys = new Set(
          inventory.pieces.map((f) => pieceKey(f.name)),
        );
        const missingImages = Object.entries(production)
          .filter(([key]) => !imageKeys.has(key))
          .map(([key, p]) => ({ key, csvLine: p.csvLine ?? 0 }));
        const notices = [
          ...new Set([
            ...(excel.parsed as Omit<Matrix, "bytes">).issues
              .filter((i) => i.scope === "campaign")
              .map((i) => i.message),
            ...((csv.parsed as Omit<Csv, "bytes">).encodingNotice
              ? [(csv.parsed as Omit<Csv, "bytes">).encodingNotice!]
              : []),
            ...(!pieces.length
              ? ["No hay imágenes PNG o JPEG en DESPLIEGUE."]
              : []),
          ]),
        ].slice(0, 50);
        plan = {
          pieces,
          metadata: {
            fingerprint,
            excelFileId: excel.record._id,
            csvFileId: csv.record._id,
            deploymentFolderId,
            driveFolderName: inventory.campaignName ?? begun.campaign.name,
            ruleVersion: prepared.ruleVersion,
            rules: prepared.rules,
            notices,
            ignoredFiles: ignoredFiles.slice(0, 200),
            missingImages: missingImages.slice(0, 1000),
            excludedPieceIds:
              resolved.excludedPieceIds as Id<"qaVisualPieces">[],
            counts: {
              images: pieces.length,
              linked: pieces.filter((p) =>
                structuredRequirements(p.input).some(
                  (r) => r.basis === "client" && r.status === "ready",
                ),
              ).length,
              linkedWithNotices: pieces.filter((p) => p.input.issues?.length)
                .length,
              blocked: pieces.filter((p) =>
                p.input.issues?.some((i) => i.severity === "blocking"),
              ).length,
              csvRowsWithoutImage: missingImages.length,
              ignoredFiles: ignoredFiles.length,
            },
          },
        };
        const planStorageId = await ctx.storage.store(
          new Blob([JSON.stringify(plan)], { type: "application/json" }),
        );
        let adopted = false;
        try {
          adopted = await ctx.runMutation(internal.qaVisual.imports.setPlan, {
            ...request,
            ...plan.metadata,
            planStorageId,
          });
          if (!adopted) return;
        } finally {
          if (!adopted)
            await ctx.runMutation(internal.qaVisual.sourceFiles.discard, {
              storageIds: [planStorageId],
            });
        }
      }
      for (let offset = 0; offset < plan.pieces.length; ) {
        const chunk: Plan["pieces"] = [];
        let bytes = 2;
        for (const piece of plan.pieces.slice(offset, offset + 50)) {
          const size = Buffer.byteLength(JSON.stringify(piece)) + 1;
          if (size > MAX_CHUNK_BYTES)
            throw new DriveFolderError(
              "Los requisitos de una pieza superan el tamaño admitido.",
            );
          if (bytes + size > MAX_CHUNK_BYTES) break;
          chunk.push(piece);
          bytes += size;
        }
        if (
          !(await ctx.runMutation(internal.qaVisual.imports.writeChunk, {
            ...request,
            offset,
            hash: hash(chunk),
            pieces: chunk,
          }))
        )
          return;
        offset += chunk.length;
      }
      await ctx.runMutation(internal.qaVisual.imports.publish, request);
    } catch (error) {
      const failure = classify(error);
      if (failure.retryable) {
        await ctx.runMutation(internal.qaVisual.imports.retryError, {
          ...request,
          error: failure,
        });
        throw error;
      }
      await ctx.runMutation(internal.qaVisual.imports.fail, {
        ...request,
        error: failure,
      });
    }
  },
});
