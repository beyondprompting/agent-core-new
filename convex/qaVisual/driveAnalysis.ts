"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import { prepareAnalysisInputs } from "./analysisInput.node";
import { loadDriveMatrix, readDriveCampaign, validateDriveFolder } from "./driveSource.node";
import { prepareDriveImage } from "./preview.node";

type LaunchResult = { runId: string } | { error: string };

export const launch = action({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    requestId: v.string(),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
    names: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { campaignId, requestId, kind, names }): Promise<LaunchResult> => {
    const registered = await ctx.runQuery(internal.qaVisual.campaigns.getActive, { campaignId });
    if (!registered) return { error: "La campaña ya no está disponible." };
    const campaign = registered.reviewKey;
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId) || (names?.length ?? 0) > 200)
      return { error: "Solicitud de análisis inválida." };
    try {
      const { folderId, inventory, matrix, deployment } = await readDriveCampaign(registered.driveFolderId);
      if (!matrix) return { error: "Falta el Excel del cliente en RECURSOS." };
      if (!inventory.production) return { error: "No se pudo leer el CSV de producción en EDITABLES." };
      if (!deployment) return { error: "No se pudo leer DESPLIEGUE." };

      const prepared = prepareAnalysisInputs(folderId, inventory, await loadDriveMatrix(matrix));
      const { inputs, ruleVersion, rules } = prepared;
      const selectedNames = new Set(names);
      const selected = inputs.filter((item) => kind === "batch" || selectedNames.has(item.name));
      if (!selected.length || selected.length > 200 ||
          (kind !== "batch" && selected.length !== selectedNames.size) ||
          (kind === "piece" && selected.length !== 1))
        return { error: "La selección ya no coincide con el inventario. Actualizá la página." };

      const workbook = prepared.matrix!;
      const sourceDocumentId = await ctx.runAction(internal.qaVisual.importMatrix.seed, {
        campaign,
        name: workbook.name,
        hash: workbook.hash,
        mappingVersion: ruleVersion,
        base64: workbook.bytes.toString("base64"),
        cells: workbook.cells,
        pieces: inputs.map(({ name, requirements }) => ({ name, requirements })),
      });
      const byName = new Map(inventory.pieces.map((file) => [file.name, file]));
      const { runId } = await ctx.runMutation(internal.qaVisual.runs.start, {
        campaignId, requestId, kind, ruleVersion, sourceDocumentId, rules,
        inputs: selected,
        driveFolderId: deployment.folderId,
        driveFiles: selected.map(({ name }) => {
          const file = byName.get(name)!;
          return { id: file.driveId, version: file.driveVersion };
        }),
      });
      return { runId };
    } catch (error) {
      console.error("QA Visual: no se pudo iniciar el análisis desde Google Drive", error);
      return { error: "No se pudo iniciar el análisis. Revisá la conexión y la configuración de la campaña." };
    }
  },
});

export type DriveInspection = {
  campaign?: string;
  sampleFile: { driveFolderId: string; id: string; version: string; bytes: number };
  RECURSOS: { file: string; sheets: string[]; cells: number };
  EDITABLES: { file: string; records: number };
  DESPLIEGUE: {
    pieces: number;
    piecesWithRequirements: number;
    sample: string;
    dimensions: [number, number];
    previewBytes: number;
  };
};

export const inspectCampaign = internalAction({
  args: { folderUrl: v.string() },
  handler: async (_ctx, { folderUrl }): Promise<DriveInspection> => {
    const { driveFolderId } = await validateDriveFolder(folderUrl);
    const { folderId, inventory, matrix, deployment } = await readDriveCampaign(driveFolderId);
    if (!matrix || !inventory.csv || !inventory.production || !deployment || !inventory.pieces.length)
      throw new Error(`No se pudieron leer las tres fuentes de la campaña. ${inventory.notices.join(" ")}`);
    const workbook = await loadDriveMatrix(matrix);
    const { inputs } = prepareAnalysisInputs(folderId, inventory, workbook);
    const sample = inventory.pieces[0];
    const preview = await prepareDriveImage(deployment.folderId, sample.driveId, sample.driveVersion);
    return {
      campaign: inventory.campaignName,
      sampleFile: { driveFolderId, id: sample.driveId, version: sample.driveVersion, bytes: sample.bytes },
      RECURSOS: { file: workbook.name, sheets: [...new Set(workbook.cells.map(({ sheet }) => sheet))], cells: workbook.cells.length },
      EDITABLES: { file: inventory.csv.name, records: Object.keys(inventory.production).length },
      DESPLIEGUE: {
        pieces: inputs.length,
        piecesWithRequirements: inputs.filter(({ matrixLinked }) => matrixLinked).length,
        sample: sample.name,
        dimensions: [preview.snapshot.width, preview.snapshot.height],
        previewBytes: preview.bytes.byteLength,
      },
    };
  },
});
