import { v } from "convex/values";
import { input, pieceFile, rule } from "../validators";

export const importId = v.union(
  v.id("qaVisualImports"),
  v.id("qaVisualCampaignSnapshots"),
);
export const importPieceId = v.union(
  v.id("qaVisualImportPieces"),
  v.id("qaVisualCampaignPieces"),
);
export const sourceFileId = v.union(
  v.id("qaVisualSourceFiles"),
  v.id("qaVisualSourceDocuments"),
);
export const importTrigger = v.union(
  v.literal("register"),
  v.literal("manual"),
  v.literal("reprocess"),
  v.literal("parserUpgrade"),
);
export const importBuildStage = v.union(
  v.literal("listing"),
  v.literal("downloading"),
  v.literal("parsing"),
  v.literal("linking"),
  v.literal("writing"),
);
export const importError = v.object({
  code: v.string(),
  message: v.string(),
  retryable: v.boolean(),
});
export const importCounts = v.object({
  images: v.number(),
  linked: v.number(),
  linkedWithNotices: v.number(),
  blocked: v.number(),
  csvRowsWithoutImage: v.number(),
  ignoredFiles: v.number(),
});
export const display = v.object({
  title: v.string(),
  fileName: v.string(),
  format: v.string(),
  width: v.number(),
  height: v.number(),
  channel: v.string(),
  phase: v.string(),
  inputHash: v.string(),
  warning: v.number(),
  blocking: v.number(),
});
export const disposition = v.union(
  v.literal("active"),
  v.literal("excluded"),
  v.literal("historical"),
);
export const identityPlan = v.object({
  key: v.string(),
  baseKey: v.string(),
  pieceId: v.optional(v.id("qaVisualPieces")),
  duplicateOfKey: v.optional(v.string()),
  disposition,
  duplicate: v.boolean(),
  sourceVersionId: v.optional(v.id("qaVisualPieceVersions")),
});
export const preparedPiece = v.object({
  file: pieceFile,
  input,
  display,
  identity: identityPlan,
});
// Identity and content hashes already live on pieces/versions; do not repeat them
// for every image in the single-document publication manifest.
export const manifestEntry = v.object({
  pieceId: v.id("qaVisualPieces"),
  versionId: v.id("qaVisualPieceVersions"),
  importPieceId: v.id("qaVisualImportPieces"),
  duplicateOfKey: v.optional(v.string()),
  disposition,
  display: v.object({
    fileName: v.string(),
    format: v.string(),
    width: v.number(),
    height: v.number(),
    channel: v.string(),
    phase: v.string(),
    inputHash: v.string(),
    warning: v.number(),
    blocking: v.number(),
  }),
  driveFileId: v.string(),
  driveVersion: v.string(),
  driveCreatedAt: v.number(),
  number: v.number(),
});
export const importMetadata = {
  fingerprint: v.string(),
  excelFileId: v.id("qaVisualSourceFiles"),
  csvFileId: v.id("qaVisualSourceFiles"),
  deploymentFolderId: v.string(),
  driveFolderName: v.string(),
  ruleVersion: v.string(),
  rules: v.array(rule),
  notices: v.array(v.string()),
  counts: importCounts,
  ignoredFiles: v.array(v.object({ name: v.string(), reason: v.string() })),
  missingImages: v.array(v.object({ key: v.string(), csvLine: v.number() })),
  excludedPieceIds: v.array(v.id("qaVisualPieces")),
};
export const EMPTY_COUNTS = {
  images: 0,
  linked: 0,
  linkedWithNotices: 0,
  blocked: 0,
  csvRowsWithoutImage: 0,
  ignoredFiles: 0,
};
export const TEMPLATE_VERSION = "matriz-kfc-v1";
export const MAX_IMPORT_PIECES = 1000;
export const MAX_CHUNK_BYTES = 650_000;
