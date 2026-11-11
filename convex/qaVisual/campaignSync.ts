"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { confirmedRulesConfig, prepareAnalysisInputs } from "./analysisInput.node";
import type { DriveFile } from "./driveClient";
import { DriveFolderError, listDriveCampaign, loadDriveCsv, loadDriveMatrix, toQaFile } from "./driveSource.node";

// Bump when changing the interpretation of a source or the stored review inputs.
const importVersion = 2;

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function saveOriginal(
  ctx: ActionCtx,
  campaign: string,
  kind: "excel" | "csv",
  file: DriveFile & { version: string },
  bytes: Buffer,
  cells?: Awaited<ReturnType<typeof loadDriveMatrix>>["cells"],
): Promise<Id<"qaVisualSourceDocuments">> {
  const source = { campaign, kind, driveFileId: file.id, driveVersion: file.version };
  const known = await ctx.runQuery(internal.qaVisual.documents.findDriveVersion, source);
  if (known) return known._id;

  const storageId = await ctx.storage.store(new Blob([Uint8Array.from(bytes)], {
    type: kind === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
  }));
  try {
    return await ctx.runMutation(internal.qaVisual.documents.saveDriveVersion, {
      ...source, ...toQaFile(file), hash: hash(bytes), storageId, cells,
    });
  } catch (error) {
    const saved = await ctx.runQuery(internal.qaVisual.documents.findDriveVersion, source)
      .catch(() => undefined);
    if (saved !== undefined && saved?.storageId !== storageId) await ctx.storage.delete(storageId);
    throw error;
  }
}

export const run = internalAction({
  args: { campaignId: v.id("qaVisualCampaigns"), startedAt: v.number() },
  handler: async (ctx, request): Promise<void> => {
    const campaign = await ctx.runQuery(internal.qaVisual.campaignSnapshots.requestedCampaign, request);
    if (!campaign) return;
    try {
      const { folderId, inventory, matrix, csv, deployment } = await listDriveCampaign(campaign.driveFolderId);
      if (inventory.notices.length) throw new DriveFolderError(inventory.notices.join(" "));
      if (!matrix?.version || !csv?.version || !deployment)
        throw new DriveFolderError("Faltan fuentes con una versión válida en Google Drive.");
      if (inventory.pieces.length > 1000)
        throw new DriveFolderError("La campaña supera el límite de 1000 piezas.");

      const fingerprint = hash(JSON.stringify({
        importVersion,
        overrides: confirmedRulesConfig(folderId),
        matrix: [matrix.id, matrix.version],
        csv: [csv.id, csv.version],
        deployment: deployment.folderId,
        pieces: inventory.pieces,
      }));
      if (await ctx.runMutation(internal.qaVisual.campaignSnapshots.reuse, { ...request, fingerprint }))
        return;

      const [excel, csvData] = await Promise.all([loadDriveMatrix(matrix), loadDriveCsv(csv)]);
      const { rules, ruleVersion, inputs } = prepareAnalysisInputs(
        folderId, { ...inventory, production: csvData.production }, excel,
      );
      const [excelDocumentId, csvDocumentId] = await Promise.all([
        saveOriginal(ctx, campaign.reviewKey, "excel", { ...matrix, version: matrix.version }, excel.bytes, excel.cells),
        saveOriginal(ctx, campaign.reviewKey, "csv", { ...csv, version: csv.version }, csvData.bytes),
      ]);
      await ctx.runMutation(internal.qaVisual.campaignSnapshots.publish, {
        ...request,
        fingerprint,
        excelDocumentId,
        csvDocumentId,
        deploymentFolderId: deployment.folderId,
        ruleVersion,
        rules,
        notices: inventory.notices,
        pieces: inventory.pieces.map((file, index) => ({ file, input: inputs[index] })),
      });
    } catch (error) {
      console.error("QA Visual: falló la importación desde Drive", request.campaignId, error);
      await ctx.runMutation(internal.qaVisual.campaignSnapshots.fail, {
        ...request,
        error: error instanceof DriveFolderError
          ? error.message
          : "No se pudieron importar los archivos de Drive. Revisá el Excel y el CSV e intentá de nuevo.",
      });
    }
  },
});
