"use node";

import { parseClientMatrix } from "./clientMatrix.node";
import { productionByPiece } from "./model/productionCsv";
import { PARSER_VERSION } from "./model/contracts";
import { markDuplicateNames } from "./model/identity";
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  confirmedRulesConfig,
  prepareAnalysisInputs,
} from "./analysisInput.node";
import {
  downloadDriveFile,
  matrixLimit,
  csvLimit,
  type DriveFile,
} from "./driveClient";
import {
  DriveFolderError,
  listDriveCampaign,
  parseDriveCsv,
  loadDriveMatrix,
  toQaFile,
} from "./driveSource.node";

// Bump when changing the interpretation of a source or the stored review inputs.
const importVersion = PARSER_VERSION;

const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

async function saveOriginal(
  ctx: ActionCtx,
  campaign: string,
  kind: "excel" | "csv",
  file: DriveFile & { version: string },
  bytes: Buffer,
  cells?: Awaited<ReturnType<typeof loadDriveMatrix>>["cells"],
): Promise<Id<"qaVisualSourceDocuments">> {
  const source = {
    campaign,
    kind,
    driveFileId: file.id,
    driveVersion: file.version,
  };
  const known = await ctx.runQuery(
    internal.qaVisual.documents.findDriveVersion,
    source,
  );
  if (known) return known._id;

  const storageId = await ctx.storage.store(
    new Blob([Uint8Array.from(bytes)], {
      type:
        kind === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
    }),
  );
  try {
    return await ctx.runMutation(internal.qaVisual.documents.saveDriveVersion, {
      ...source,
      ...toQaFile(file),
      hash: hash(bytes),
      storageId,
      cells,
    });
  } catch (error) {
    const saved = await ctx
      .runQuery(internal.qaVisual.documents.findDriveVersion, source)
      .catch(() => undefined);
    if (saved !== undefined && saved?.storageId !== storageId)
      await ctx.storage.delete(storageId);
    throw error;
  }
}

export const run = internalAction({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    startedAt: v.number(),
    reprocess: v.optional(v.boolean()),
  },
  handler: async (ctx, { reprocess, ...request }): Promise<void> => {
    const campaign = await ctx.runQuery(
      internal.qaVisual.campaignSnapshots.requestedCampaign,
      request,
    );
    if (!campaign) return;
    try {
      const overrides = await ctx.runQuery(internal.qaVisual.overrides.list, {
        campaignId: request.campaignId,
      });
      if (reprocess) {
        const stored = await ctx.runQuery(
          internal.qaVisual.campaignSnapshots.storedSources,
          { campaignId: request.campaignId },
        );
        if (!stored)
          throw new DriveFolderError(
            "No hay fuentes guardadas para reprocesar. Actualizá desde Drive.",
          );
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "downloading",
          images: stored.files.length,
        });
        const [excelBlob, csvBlob] = await Promise.all([
          ctx.storage.get(stored.excel.storageId),
          ctx.storage.get(stored.csv.storageId),
        ]);
        if (!excelBlob || !csvBlob)
          throw new DriveFolderError(
            "Las fuentes guardadas ya no están disponibles. Actualizá desde Drive.",
          );
        const fingerprint = hash(
          JSON.stringify({
            importVersion,
            links: overrides,
            overrides: confirmedRulesConfig(campaign.driveFolderId),
            matrix: [stored.excel.driveFileId, stored.excel.driveVersion],
            csv: [stored.csv.driveFileId, stored.csv.driveVersion],
            deployment: stored.snapshot.deploymentFolderId,
            pieces: stored.files,
          }),
        );
        if (
          await ctx.runMutation(internal.qaVisual.campaignSnapshots.reuse, {
            ...request,
            fingerprint,
          })
        )
          return;
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "reading",
        });
        const matrix = await parseClientMatrix(
          stored.excel.name,
          Buffer.from(await excelBlob.arrayBuffer()),
        );
        const csvBytes = await csvBlob.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(csvBytes);
        } catch {
          text = new TextDecoder("windows-1252").decode(csvBytes);
        }
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "linking",
        });
        const prepared = prepareAnalysisInputs(
          campaign.driveFolderId,
          {
            matrix: null,
            csv: null,
            pieces: stored.files,
            notices: [],
            production: productionByPiece(text),
          },
          matrix,
          overrides,
        );
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "publishing",
        });
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.publish, {
          ...request,
          fingerprint,
          excelDocumentId: stored.excel._id,
          csvDocumentId: stored.csv._id,
          deploymentFolderId: stored.snapshot.deploymentFolderId,
          ruleVersion: prepared.ruleVersion,
          rules: prepared.rules,
          notices: stored.snapshot.notices,
          pieces: markDuplicateNames(stored.files, prepared.inputs).map(
            (input, i) => ({ file: stored.files[i], input }),
          ),
        });
        return;
      }
      const { folderId, inventory, matrix, csv, deployment, needsSources } =
        await listDriveCampaign(
          campaign.driveFolderId,
          campaign.sourceSelection,
        );
      if (inventory.notices.length)
        throw new DriveFolderError(
          inventory.notices.join(" "),
          needsSources ? "sources" : undefined,
        );
      if (!matrix?.version || !csv?.version || !deployment)
        throw new DriveFolderError(
          "Faltan fuentes con una versión válida en Google Drive.",
        );
      if (inventory.pieces.length > 1000)
        throw new DriveFolderError(
          "La campaña supera el límite de 1000 piezas.",
        );

      const fingerprint = hash(
        JSON.stringify({
          links: overrides,
          importVersion,
          overrides: confirmedRulesConfig(folderId),
          matrix: [matrix.id, matrix.version],
          csv: [csv.id, csv.version],
          deployment: deployment.folderId,
          pieces: inventory.pieces,
        }),
      );
      if (
        await ctx.runMutation(internal.qaVisual.campaignSnapshots.reuse, {
          ...request,
          fingerprint,
        })
      )
        return;

      if (
        !(await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "downloading",
          images: inventory.pieces.length,
        }))
      )
        return;
      const [excelBytes, csvBytes] = await Promise.all([
        downloadDriveFile(matrix, matrixLimit),
        downloadDriveFile(csv, csvLimit),
      ]);
      if (
        !(await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "reading",
        }))
      )
        return;
      const excel = await parseClientMatrix(matrix.name, excelBytes);
      const csvData = parseDriveCsv(csvBytes);
      if (
        !(await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "linking",
        }))
      )
        return;
      const { rules, ruleVersion, inputs } = prepareAnalysisInputs(
        folderId,
        { ...inventory, production: csvData.production },
        excel,
        overrides,
      );
      const [excelDocumentId, csvDocumentId] = await Promise.all([
        saveOriginal(
          ctx,
          campaign.reviewKey,
          "excel",
          { ...matrix, version: matrix.version },
          excel.bytes,
          excel.cells,
        ),
        saveOriginal(
          ctx,
          campaign.reviewKey,
          "csv",
          { ...csv, version: csv.version },
          csvData.bytes,
        ),
      ]);
      if (
        !(await ctx.runMutation(internal.qaVisual.campaignSnapshots.progress, {
          ...request,
          stage: "publishing",
        }))
      )
        return;
      await ctx.runMutation(internal.qaVisual.campaignSnapshots.publish, {
        ...request,
        fingerprint,
        excelDocumentId,
        csvDocumentId,
        deploymentFolderId: deployment.folderId,
        ruleVersion,
        rules,
        notices: [
          ...inventory.notices,
          ...(csvData.encodingNotice ? [csvData.encodingNotice] : []),
          ...excel.issues
            .filter((i) => i.scope === "campaign")
            .map((i) => i.message),
        ],
        pieces: markDuplicateNames(inventory.pieces, inputs).map(
          (input, index) => ({ file: inventory.pieces[index], input }),
        ),
      });
    } catch (error) {
      console.error(
        "QA Visual: falló la importación desde Drive",
        request.campaignId,
        error,
      );
      await ctx.runMutation(internal.qaVisual.campaignSnapshots.fail, {
        ...request,
        needsSources:
          error instanceof DriveFolderError && error.code === "sources",
        error:
          error instanceof DriveFolderError
            ? error.message
            : "No se pudieron importar los archivos de Drive. Revisá el Excel y el CSV e intentá de nuevo.",
      });
    }
  },
});
