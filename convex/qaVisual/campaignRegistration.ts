"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { driveReviewKey } from "./analysisInput.node";
import {
  createProductionCsv,
  DriveFolderError,
  inspectDriveFolder,
  type CsvCreation,
  type FolderInspection,
  type SourceSelection,
} from "./driveSource.node";

type RegistrationResult =
  | { name: string; campaignId: string }
  | { error: string; inspection?: FolderInspection };
const selection = {
  excelFileId: v.optional(v.string()),
  csvFileId: v.optional(v.string()),
  resourcesFolderId: v.optional(v.string()),
  editablesFolderId: v.optional(v.string()),
  deploymentFolderId: v.optional(v.string()),
};
const folderUrl = (id: string) =>
  `https://drive.google.com/drive/folders/${id}`;

/** Step 1 of the registration dialog: read-only checklist of the folder. */
export const inspect = action({
  args: { folderUrl: v.string(), ...selection },
  handler: async (ctx, { folderUrl, ...chosen }): Promise<FolderInspection> => {
    await ctx.runQuery(internal.qaVisual.access.viewerIsQaAdmin, {});
    try {
      return await inspectDriveFolder(folderUrl, chosen);
    } catch (error) {
      console.error("QA Visual: no se pudo verificar la carpeta", error);
      return {
        ok: false,
        error:
          "No se pudo leer la carpeta. Revisá la conexión con Google Drive e intentá de nuevo.",
      };
    }
  },
});

export const add = action({
  args: { folderUrl: v.string(), ...selection },
  handler: async (
    ctx,
    { folderUrl, ...chosen },
  ): Promise<RegistrationResult> => {
    await ctx.runQuery(internal.qaVisual.access.viewerIsQaAdmin, {});
    try {
      const preview = await inspectDriveFolder(folderUrl, chosen);
      if (!("folder" in preview) || !preview.ok)
        return {
          inspection: preview,
          error:
            "error" in preview
              ? preview.error
              : "La carpeta todavía no tiene todo lo necesario. Revisá la lista de verificación.",
        };
      const result = await ctx.runMutation(
        internal.qaVisual.campaigns.register,
        {
          name: preview.folder.name,
          driveFolderId: preview.folder.id,
          reviewKey: driveReviewKey(preview.folder.id),
          sourceSelection: preview.selection,
        },
      );
      if (result.status === "existing")
        return { error: "Esta carpeta ya está registrada." };
      if (result.status === "archived")
        return { error: "Esta carpeta pertenece a una campaña archivada." };
      return { name: preview.folder.name, campaignId: result.campaignId };
    } catch (error) {
      if (error instanceof DriveFolderError) return { error: error.message };
      console.error("QA Visual: no se pudo registrar la campaña", error);
      return {
        error:
          "No se pudo registrar la campaña. Revisá la conexión con Google Drive e intentá de nuevo.",
      };
    }
  },
});

/** Lists the source candidates of a registered campaign (used by «Elegir fuentes»). */
export const inspectCampaign = action({
  args: { campaignId: v.id("qaVisualCampaigns"), ...selection },
  handler: async (
    ctx,
    { campaignId, ...chosen },
  ): Promise<FolderInspection> => {
    const campaign = await ctx.runQuery(internal.qaVisual.campaigns.getActive, {
      campaignId,
    });
    if (!campaign)
      return { ok: false, error: "La campaña ya no está disponible." };
    try {
      // The dialog always sends its whole selection (it starts from the saved one), so a
      // cleared folder or file goes back to automatic detection.
      return await inspectDriveFolder(
        folderUrl(campaign.driveFolderId),
        chosen,
      );
    } catch {
      return {
        ok: false,
        error:
          "No se pudo leer la carpeta. Volvé a verificar en unos instantes.",
      };
    }
  },
});

export const chooseSources = action({
  args: { campaignId: v.id("qaVisualCampaigns"), ...selection },
  handler: async (
    ctx,
    { campaignId, ...chosen },
  ): Promise<{ error?: string; inspection?: FolderInspection }> => {
    const campaign = await ctx.runQuery(internal.qaVisual.campaigns.getActive, {
      campaignId,
    });
    if (!campaign) return { error: "La campaña ya no está disponible." };
    const preview = await inspectDriveFolder(
      folderUrl(campaign.driveFolderId),
      chosen,
    );
    if ("error" in preview)
      return { error: preview.error, inspection: preview };
    if (!preview.ok)
      return {
        error: "La carpeta cambió. Revisá las fuentes y volvé a verificar.",
        inspection: preview,
      };
    await ctx.runMutation(internal.qaVisual.campaigns.setSources, {
      campaignId,
      sourceSelection: preview.selection,
    });
    return {};
  },
});

/**
 * Generates the production CSV from the matrix and saves it in the production folder
 * (EDITABLES or the chosen one). Works before registering (folderUrl) and from «Elegir
 * fuentes» (campaignId). The returned inspection already selects the new file.
 */
export const createCsv = action({
  args: {
    folderUrl: v.optional(v.string()),
    campaignId: v.optional(v.id("qaVisualCampaigns")),
    ...selection,
  },
  handler: async (
    ctx,
    { folderUrl: url, campaignId, ...chosen },
  ): Promise<CsvCreation & { inspection?: FolderInspection }> => {
    await ctx.runQuery(internal.qaVisual.access.viewerIsQaAdmin, {});
    let target = url;
    const current: SourceSelection = chosen;
    if (campaignId) {
      const campaign = await ctx.runQuery(
        internal.qaVisual.campaigns.getActive,
        { campaignId },
      );
      if (!campaign) return { error: "La campaña ya no está disponible." };
      target = folderUrl(campaign.driveFolderId);
    }
    if (!target) return { error: "Pegá un enlace de carpeta de Google Drive." };
    let result: CsvCreation;
    try {
      result = await createProductionCsv(target, current);
    } catch (error) {
      console.error("QA Visual: no se pudo crear el CSV de producción", error);
      const message = error instanceof Error ? error.message : "";
      return {
        error: /Plantilla|PRODUCCION|matriz/i.test(message)
          ? message
          : "No se pudo crear el CSV. Revisá la matriz y la conexión con Google Drive e intentá de nuevo.",
      };
    }
    if (!result.created) return result;
    // Drive may take a moment to list a new file: retry before reporting it missing.
    let inspection: FolderInspection | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
      inspection = await inspectDriveFolder(target, {
        ...current,
        csvFileId: result.created.id,
      }).catch(() => undefined);
      if (
        inspection &&
        "folder" in inspection &&
        inspection.selection.csvFileId === result.created.id
      )
        break;
    }
    return { ...result, inspection };
  },
});
