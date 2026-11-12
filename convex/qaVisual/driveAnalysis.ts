"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { prepareAnalysisInputs } from "./analysisInput.node";
import {
  listDriveCampaign,
  loadDriveCsv,
  loadDriveMatrix,
  validateDriveFolder,
} from "./driveSource.node";
import { prepareDriveImage } from "./preview.node";

export type DriveInspection = {
  campaign?: string;
  sampleFile: {
    driveFolderId: string;
    id: string;
    version: string;
    bytes: number;
  };
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
    const { folderId, inventory, matrix, csv, deployment } =
      await listDriveCampaign(driveFolderId);
    if (!matrix || !csv || !deployment || !inventory.pieces.length)
      throw new Error(
        `No se pudieron leer las tres fuentes de la campaña. ${inventory.notices.join(" ")}`,
      );
    const [workbook, { production }] = await Promise.all([
      loadDriveMatrix(matrix),
      loadDriveCsv(csv),
    ]);
    const { inputs } = prepareAnalysisInputs(
      folderId,
      { ...inventory, production },
      workbook,
    );
    const sample = inventory.pieces[0];
    const preview = await prepareDriveImage(
      deployment.folderId,
      sample.driveId,
      sample.driveVersion,
    );
    return {
      campaign: inventory.campaignName,
      sampleFile: {
        driveFolderId,
        id: sample.driveId,
        version: sample.driveVersion,
        bytes: sample.bytes,
      },
      RECURSOS: {
        file: workbook.name,
        sheets: [...new Set(workbook.cells.map(({ sheet }) => sheet))],
        cells: workbook.cells.length,
      },
      EDITABLES: { file: csv.name, records: Object.keys(production).length },
      DESPLIEGUE: {
        pieces: inputs.length,
        piecesWithRequirements: inputs.filter(({ requirements }) =>
          requirements.some(
            (r) => r.basis === "client" && r.status === "ready",
          ),
        ).length,
        sample: sample.name,
        dimensions: [preview.snapshot.width, preview.snapshot.height],
        previewBytes: preview.bytes.byteLength,
      },
    };
  },
});
