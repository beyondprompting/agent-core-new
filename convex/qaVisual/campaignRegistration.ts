"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, type ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { driveReviewKey } from "./analysisInput.node";
import {
  createProductionCsv,
  DriveFolderError,
  inspectDriveFolder,
  type CsvCreation,
  type FolderInspection,
  type SourceSelection,
} from "./driveSource.node";
import {
  applyCsvFix as applyFix,
  checkCsvFix as checkFix,
  checkEquivalences,
  reviewMapping as review,
  type CsvFixResult,
  type MappingReview,
} from "./csvRepair.node";
import { csvEdit } from "./csvEdits";
import { equivalence } from "./equivalences";
import type { LinkOverride } from "./model/contracts";
import type { Equivalence } from "./model/mapping";

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
      const [excluded, overrides] = await Promise.all([
        ctx.runQuery(internal.qaVisual.overrides.excludedKeys, { campaignId }),
        ctx.runQuery(internal.qaVisual.equivalences.forCampaign, {
          campaignId,
        }),
      ]);
      return await inspectDriveFolder(
        folderUrl(campaign.driveFolderId),
        chosen,
        new Set(excluded),
        overrides,
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

/** Target folder of the mapping actions: a folder before registering or a campaign. */
async function mappingTarget(
  ctx: ActionCtx,
  url: string | undefined,
  campaignId: Id<"qaVisualCampaigns"> | undefined,
): Promise<
  | { error: string }
  | {
      url: string;
      excluded: Set<string>;
      overrides: LinkOverride[];
      campaign?: Doc<"qaVisualCampaigns">;
    }
> {
  await ctx.runQuery(internal.qaVisual.access.viewerIsQaAdmin, {});
  if (!campaignId)
    return url
      ? { url, excluded: new Set(), overrides: [] }
      : { error: "Pegá un enlace de carpeta de Google Drive." };
  const campaign = await ctx.runQuery(internal.qaVisual.campaigns.getActive, {
    campaignId,
  });
  if (!campaign) return { error: "La campaña ya no está disponible." };
  const [excluded, overrides] = await Promise.all([
    ctx.runQuery(internal.qaVisual.overrides.excludedKeys, { campaignId }),
    ctx.runQuery(internal.qaVisual.equivalences.forCampaign, { campaignId }),
  ]);
  return {
    url: folderUrl(campaign.driveFolderId),
    excluded: new Set(excluded),
    overrides,
    campaign,
  };
}
const where = {
  folderUrl: v.optional(v.string()),
  campaignId: v.optional(v.id("qaVisualCampaigns")),
  ...selection,
};
const connectionError =
  "No se pudo leer la carpeta. Revisá la conexión con Google Drive e intentá de nuevo.";

/**
 * §5.5 «Revisar con Gemini»: explains every difference of the mapping and proposes how to
 * fix it, verified by code. Nothing is written. The model gets the pieces, the CSV rows and the
 * identity, size and date of the candidate orders of the matrix, read-only.
 */
export const reviewMapping = action({
  // `pieces`: one batch of the panel; without it every difference is reviewed.
  args: { ...where, pieces: v.optional(v.array(v.string())) },
  handler: async (
    ctx,
    { folderUrl: url, campaignId, pieces, ...chosen },
  ): Promise<MappingReview> => {
    if (pieces && pieces.length > 50)
      return { error: "Se revisan hasta 50 piezas por vez.", suggestions: [] };
    const target = await mappingTarget(ctx, url, campaignId);
    if ("error" in target) return { error: target.error, suggestions: [] };
    try {
      return await review({ ...target, selection: chosen }, pieces);
    } catch (error) {
      console.error("QA Visual: no se pudo revisar el mapeo", error);
      return { error: connectionError, suggestions: [] };
    }
  },
});

/** Verifies the changes chosen in the panel before the user authorizes them. */
export const checkCsvFix = action({
  args: { ...where, csvVersion: v.string(), edits: v.array(csvEdit) },
  handler: async (
    ctx,
    { folderUrl: url, campaignId, csvVersion, edits, ...chosen },
  ): Promise<{
    error?: string;
    errors?: string[];
    warnings?: string[];
    next?: string[];
  }> => {
    if (edits.length > 1000) return { error: "Demasiados cambios." };
    const target = await mappingTarget(ctx, url, campaignId);
    if ("error" in target) return { error: target.error };
    try {
      return await checkFix(
        { ...target, selection: chosen },
        csvVersion,
        edits,
      );
    } catch (error) {
      console.error("QA Visual: no se pudo verificar el CSV", error);
      return { error: connectionError };
    }
  },
});

/** Writes the changes the user authorized, after verifying them again against Drive. */
export const applyCsvFix = action({
  args: {
    ...where,
    csvVersion: v.string(),
    edits: v.array(csvEdit),
    model: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { folderUrl: url, campaignId, csvVersion, edits, model, ...chosen },
  ): Promise<CsvFixResult & { inspection?: FolderInspection }> => {
    if (edits.length > 1000) return { error: "Demasiados cambios." };
    const target = await mappingTarget(ctx, url, campaignId);
    if ("error" in target) return { error: target.error };
    let result: Awaited<ReturnType<typeof applyFix>>;
    try {
      result = await applyFix(
        { ...target, selection: chosen },
        csvVersion,
        edits,
      );
    } catch (error) {
      console.error("QA Visual: no se pudo corregir el CSV", error);
      return {
        error:
          "No se pudo corregir el CSV. Revisá la conexión con Google Drive e intentá de nuevo.",
      };
    }
    const { csv, previousVersion, ...response } = result;
    if (!csv || !previousVersion) return response;
    await ctx.runMutation(internal.qaVisual.csvEdits.record, {
      ...(target.campaign ? { campaignId: target.campaign._id } : {}),
      driveFolderId:
        target.campaign?.driveFolderId ??
        target.url.split("/folders/")[1]?.split(/[/?]/)[0] ??
        "",
      csvFileId: csv.id,
      csvName: csv.name,
      previousVersion,
      ...(csv.version ? { newVersion: csv.version } : {}),
      edits,
      ...(model && edits.some((e) => e.origin === "ai") ? { model } : {}),
    });
    const inspection = await inspectDriveFolder(
      target.url,
      chosen,
      target.excluded,
      target.overrides,
    ).catch(() => undefined);
    return { ...response, inspection };
  },
});

/**
 * «Dicen lo mismo»: approves that the CSV and the matrix values of a piece are equivalent, for
 * the campaign or for every campaign of its client. Verified before saving; files untouched.
 */
export const approveEquivalence = action({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    ...selection,
    piece: v.string(),
    order: v.string(),
    scope: v.union(v.literal("campaign"), v.literal("client")),
    equivalences: v.array(equivalence),
  },
  handler: async (
    ctx,
    { campaignId, piece, order, scope, equivalences, ...chosen },
  ): Promise<{ error?: string; inspection?: FolderInspection }> => {
    if (!equivalences.length || equivalences.length > 5)
      return { error: "La equivalencia no es válida." };
    const target = await mappingTarget(ctx, undefined, campaignId);
    if ("error" in target) return { error: target.error };
    if (scope === "client" && !target.campaign?.client?.clientId)
      return {
        error:
          "La campaña no tiene un cliente asignado: aprobá la equivalencia solo para esta campaña.",
      };
    try {
      const checked = await checkEquivalences(
        { ...target, selection: chosen },
        piece,
        order,
        equivalences as Equivalence[],
      );
      if (checked.error) return checked;
    } catch (error) {
      console.error("QA Visual: no se pudo verificar la equivalencia", error);
      return { error: connectionError };
    }
    await ctx.runMutation(internal.qaVisual.equivalences.record, {
      campaignId,
      scope,
      piece,
      items: equivalences,
    });
    const overrides = await ctx.runQuery(
      internal.qaVisual.equivalences.forCampaign,
      { campaignId },
    );
    const inspection = await inspectDriveFolder(
      target.url,
      chosen,
      target.excluded,
      overrides,
    ).catch(() => undefined);
    return { ...(inspection ? { inspection } : {}) };
  },
});
