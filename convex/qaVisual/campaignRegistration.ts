"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { driveReviewKey } from "./analysisInput.node";
import {
  DriveFolderError,
  inspectDriveFolder,
  type FolderInspection,
} from "./driveSource.node";

type RegistrationResult =
  | { name: string; campaignId: string }
  | { error: string; inspection?: FolderInspection };
const selection = {
  excelFileId: v.optional(v.string()),
  csvFileId: v.optional(v.string()),
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
      return await inspectDriveFolder(folderUrl(campaign.driveFolderId), {
        ...campaign.sourceSelection,
        ...chosen,
      });
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
