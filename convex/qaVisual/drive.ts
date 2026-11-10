"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { driveContentUrl, driveToken, folderMime, getDriveFile, imageLimit } from "./driveClient";
import { imageMime } from "./driveSource.node";

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
