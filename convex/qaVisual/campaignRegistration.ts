"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { driveReviewKey } from "./analysisInput.node";
import { DriveFolderError, validateDriveFolder } from "./driveSource.node";

type RegistrationResult = { name: string } | { error: string };

export const add = action({
  args: { folderUrl: v.string() },
  handler: async (ctx, { folderUrl }): Promise<RegistrationResult> => {
    await ctx.runQuery(internal.qaVisual.access.viewerIsQaAdmin, {});
    try {
      const folder = await validateDriveFolder(folderUrl);
      const result = await ctx.runMutation(internal.qaVisual.campaigns.register, {
        ...folder,
        reviewKey: driveReviewKey(folder.driveFolderId),
      });
      if (result === "existing") return { error: "Esta carpeta ya está registrada." };
      if (result === "archived") return { error: "Esta carpeta pertenece a una campaña archivada." };
      return { name: folder.name };
    } catch (error) {
      if (error instanceof DriveFolderError) return { error: error.message };
      console.error("QA Visual: no se pudo registrar la campaña", error);
      return { error: "No se pudo registrar la campaña. Revisá la conexión con Google Drive e intentá de nuevo." };
    }
  },
});
