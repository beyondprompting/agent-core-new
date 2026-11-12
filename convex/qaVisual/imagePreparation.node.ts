import { randomUUID } from "node:crypto";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { prepareDriveImage } from "./preview.node";

export async function ensureImageCopies(
  ctx: ActionCtx,
  campaign: string,
  folderId: string,
  id: string,
  version: string,
): Promise<Id<"qaVisualImageCopies">> {
  const token = randomUUID();
  {
    const claim = await ctx.runMutation(internal.qaVisual.imageCopies.claim, {
      campaign, id, version, token,
    });
    if (claim.state === "ready") return claim.copyId;
    // Another job is preparing the same file: the caller retries later instead of waiting here.
    if (claim.state === "busy") throw new ImageBusyError();

    const { copyId } = claim;
    const uploaded: Id<"_storage">[] = [];
    try {
      const image = await prepareDriveImage(folderId, id, version);
      const thumbnailId = await ctx.storage.store(new Blob([image.thumbnail], { type: "image/webp" }));
      uploaded.push(thumbnailId);
      const analysisId = await ctx.storage.store(new Blob([image.bytes], { type: "image/jpeg" }));
      uploaded.push(analysisId);
      const previewId = await ctx.storage.store(new Blob([image.preview], { type: "image/webp" }));
      uploaded.push(previewId);
      if (await ctx.runMutation(internal.qaVisual.imageCopies.finish, {
        copyId, token, files: { thumbnailId, analysisId, previewId, snapshot: image.snapshot },
      })) return copyId;
      throw new Error("La reserva de la imagen expiró.");
    } catch (error) {
      const stored = await ctx.runQuery(internal.qaVisual.imageCopies.storedFiles, { copyId })
        .catch(() => undefined);
      if (stored !== undefined) {
        const kept = new Set([stored?.thumbnailId, stored?.analysisId, stored?.previewId]);
        await Promise.allSettled(uploaded
          .filter((storageId) => !kept.has(storageId))
          .map((storageId) => ctx.storage.delete(storageId)));
      }
      if (stored?.analysisId) return copyId;
      await ctx.runMutation(internal.qaVisual.imageCopies.release, { copyId, token });
      throw error;
    }
  }
}

export class ImageBusyError extends Error {
  constructor() {
    super("image_busy");
  }
}
