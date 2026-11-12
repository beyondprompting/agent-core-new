import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
export type PublishedImportId =
  | Id<"qaVisualImports">
  | Id<"qaVisualCampaignSnapshots">;
export type ImportedPiece =
  | Doc<"qaVisualImportPieces">
  | Doc<"qaVisualCampaignPieces">;
export const publishedId = (campaign: Doc<"qaVisualCampaigns">) =>
  campaign.currentImportId ?? campaign.currentSnapshotId;

/** Legacy snapshots remain readable until each campaign is imported with stage 2. */
export async function readImport(ctx: QueryCtx, id: PublishedImportId) {
  const data = await ctx.db.get(id);
  if (!data) return null;
  if ("status" in data) {
    if (
      !["ready", "superseded"].includes(data.status) ||
      !data.excelFileId ||
      !data.csvFileId ||
      !data.ruleVersion ||
      !data.deploymentFolderId
    )
      return null;
    return {
      ...data,
      excelDocumentId: data.excelFileId,
      csvDocumentId: data.csvFileId,
      ruleVersion: data.ruleVersion,
      deploymentFolderId: data.deploymentFolderId,
    };
  }
  return data;
}
export async function readPieces(
  ctx: QueryCtx,
  id: PublishedImportId,
  all = false,
): Promise<ImportedPiece[]> {
  const next = ctx.db.normalizeId("qaVisualImports", id);
  return next
    ? all
      ? ctx.db
          .query("qaVisualImportPieces")
          .withIndex("by_import_order", (q) => q.eq("importId", next))
          .collect()
      : ctx.db
          .query("qaVisualImportPieces")
          .withIndex("by_import_visible", (q) =>
            q.eq("importId", next).eq("disposition", "active"),
          )
          .collect()
    : ctx.db
        .query("qaVisualCampaignPieces")
        .withIndex("by_snapshot", (q) =>
          q.eq("snapshotId", id as Id<"qaVisualCampaignSnapshots">),
        )
        .collect();
}
export function sourceDetails(
  source: Doc<"qaVisualSourceFiles"> | Doc<"qaVisualSourceDocuments"> | null,
) {
  return source
    ? {
        name: source.name,
        bytes: source.bytes ?? 0,
        updatedAt:
          "modifiedAt" in source ? source.modifiedAt : (source.updatedAt ?? 0),
      }
    : null;
}
