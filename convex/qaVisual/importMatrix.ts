"use node";

import { createHash } from "node:crypto";
import { v, type Infer } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { clientRequirement, sourceCell } from "./validators";

const args = v.object({
  campaign: v.string(),
  name: v.string(),
  hash: v.string(),
  mappingVersion: v.string(),
  base64: v.string(),
  cells: v.array(sourceCell),
  pieces: v.array(
    v.object({ name: v.string(), requirements: v.array(clientRequirement) }),
  ),
});
async function importMatrix(
  ctx: ActionCtx,
  { base64, ...payload }: Infer<typeof args>,
): Promise<Id<"qaVisualSourceDocuments">> {
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length > 500_000 ||
    createHash("sha256").update(bytes).digest("hex") !== payload.hash
  ) {
    throw new Error("La matriz no coincide con la versión enviada");
  }
  const known = await ctx.runQuery(internal.qaVisual.documents.findVersion, {
    campaign: payload.campaign,
    hash: payload.hash,
    mappingVersion: payload.mappingVersion,
  });
  if (known) return known._id;
  const storageId = await ctx.storage.store(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  try {
    return await ctx.runMutation(internal.qaVisual.documents.save, {
      ...payload,
      storageId,
    });
  } catch (error) {
    const saved = await ctx
      .runQuery(internal.qaVisual.documents.findVersion, {
        campaign: payload.campaign,
        hash: payload.hash,
        mappingVersion: payload.mappingVersion,
      })
      .catch(() => undefined);
    if (saved !== undefined && saved?.storageId !== storageId)
      await ctx.storage.delete(storageId);
    throw error;
  }
}
export const seed = internalAction({ args, handler: importMatrix });
