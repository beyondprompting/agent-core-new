"use node";

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import { prepareAnalysisInputs } from "./analysisInput.node";
import { driveContentUrl, driveToken, folderMime, getDriveFile, imageLimit } from "./driveClient";
import { DriveFolderError, imageMime, loadDriveMatrix, readDriveCampaign } from "./driveSource.node";
import type { QaInventory } from "../../app/lib/qa-visual/source";

type ViewerData = {
  inventory: Omit<QaInventory, "production" | "clientRequirements">;
  production: [string, NonNullable<QaInventory["production"]>[string]][];
  requirements: [string, NonNullable<QaInventory["clientRequirements"]>[string]][];
  analysis?: { campaignId: Id<"qaVisualCampaigns">; inputs: { name: string; contextKey: string }[] };
  analysisError?: string;
};

export const viewer = action({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }): Promise<ViewerData | null> => {
    const campaign = await ctx.runQuery(internal.qaVisual.campaigns.getActive, { campaignId });
    if (!campaign) return null;
    const data: ViewerData = {
      inventory: { campaignName: campaign.name, matrix: null, csv: null, pieces: [], notices: [] },
      production: [],
      requirements: [],
    };
    let source: Awaited<ReturnType<typeof readDriveCampaign>>;
    try {
      source = await readDriveCampaign(campaign.driveFolderId);
    } catch (error) {
      console.error("QA Visual: no se pudo leer la campaña de Drive", error);
      data.inventory.notices.push(
        error instanceof DriveFolderError ? error.message : "No se pudo leer la campaña en Google Drive.",
      );
      return data;
    }

    const { folderId, matrix, inventory: { production, ...inventory } } = source;
    data.inventory = { ...inventory, campaignName: campaign.name };
    data.production = Object.entries(production ?? {});
    if (!matrix || !production || !inventory.pieces.length) return data;
    try {
      const { inputs } = prepareAnalysisInputs(
        folderId, { ...inventory, production }, await loadDriveMatrix(matrix),
      );
      data.requirements = inputs.map(({ name, requirements }) => [name, requirements]);
      data.analysis = { campaignId: campaign._id, inputs: inputs.map(({ name, contextKey }) => ({ name, contextKey })) };
    } catch (error) {
      console.error("QA Visual: no se pudo preparar la matriz", error);
      data.analysisError = "No se pudieron preparar las reglas de análisis. Revisá la matriz de Google Drive.";
    }
    return data;
  },
});

export const authorizeMedia = internalAction({
  args: { driveFolderId: v.string(), id: v.string(), version: v.string() },
  handler: async (_ctx, { driveFolderId, id, version }) => {
    const file = await getDriveFile(id);
    const parentId = file?.parents?.[0];
    if (!file || file.trashed || file.version !== version || !parentId) return null;
    const parent = await getDriveFile(parentId);
    if (!parent || parent.trashed || parent.mimeType !== folderMime ||
        parent.name !== "DESPLIEGUE" || !parent.parents?.includes(driveFolderId)) return null;

    const mime = imageMime(file);
    const size = Number(file.size);
    if (!mime || !Number.isSafeInteger(size) || size <= 0 || size > imageLimit) return null;
    return { url: driveContentUrl(file.id), token: await driveToken(), mime, size };
  },
});
