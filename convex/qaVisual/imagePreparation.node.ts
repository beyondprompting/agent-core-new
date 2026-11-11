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
  const deadline = Date.now() + 95_000;
  while (Date.now() < deadline) {
    const claim = await ctx.runMutation(internal.qaVisual.imageCopies.claim, {
      campaign, id, version, token,
    });
    if (claim.state === "ready") return claim.copyId;
    if (claim.state === "busy") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }

    const { copyId } = claim;
    const uploaded: Id<"_storage">[] = [];
    try {
      const image = await prepareDriveImage(folderId, id, version);
      const thumbnailId = await ctx.storage.store(new Blob([image.thumbnail], { type: "image/webp" }));
      uploaded.push(thumbnailId);
      const analysisId = await ctx.storage.store(new Blob([image.bytes], { type: "image/jpeg" }));
      uploaded.push(analysisId);
      if (await ctx.runMutation(internal.qaVisual.imageCopies.finish, {
        copyId, token, files: { thumbnailId, analysisId, snapshot: image.snapshot },
      })) return copyId;
      throw new Error("La reserva de la imagen expiró.");
    } catch (error) {
      const stored = await ctx.runQuery(internal.qaVisual.imageCopies.storedFiles, { copyId })
        .catch(() => undefined);
      if (stored !== undefined) {
        await Promise.allSettled(uploaded
          .filter((storageId) => storageId !== stored?.thumbnailId && storageId !== stored?.analysisId)
          .map((storageId) => ctx.storage.delete(storageId)));
      }
      if (stored?.analysisId) return copyId;
      await ctx.runMutation(internal.qaVisual.imageCopies.release, { copyId, token });
      throw error;
    }
  }
  throw new Error("La preparación de la imagen tardó demasiado.");
}
