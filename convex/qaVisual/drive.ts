"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { driveContentUrl, driveToken, getDriveFile, imageLimit, isCampaignFolder } from "./driveClient";
import { imageMime } from "./driveSource.node";

export const authorizeMedia = internalAction({
  args: {
    driveFolderId: v.string(),
    /** Pieces folder chosen by the user; otherwise DESPLIEGUE or VISUALES under the campaign. */
    deploymentFolderId: v.optional(v.string()),
    id: v.string(),
    version: v.string(),
  },
  handler: async (_ctx, { driveFolderId, deploymentFolderId, id, version }) => {
    const file = await getDriveFile(id);
    const parentId = file?.parents?.[0];
    if (!file || file.trashed || file.version !== version || !parentId) return null;
    if (parentId !== deploymentFolderId) {
      const parent = await getDriveFile(parentId);
      if (!parent || parent.trashed || !isCampaignFolder(parent, "DESPLIEGUE") ||
          !parent.parents?.includes(driveFolderId)) return null;
    }

    const mime = imageMime(file);
    const size = Number(file.size);
    if (!mime || !Number.isSafeInteger(size) || size <= 0 || size > imageLimit) return null;
    return { url: driveContentUrl(file.id), token: await driveToken(), mime, size };
  },
});
