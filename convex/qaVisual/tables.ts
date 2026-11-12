import { anchor, exception } from "./model/collaboration";
import { result } from "./model/contracts";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  attempt,
  clientRequirement,
  finding,
  input,
  rule,
  snapshot,
  sourceCell,
  sourceKind,
  pieceFile,
  status,
} from "./validators";

export const qaVisualTables = {
  qaVisualPieces: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    key: v.string(),
    fileKey: v.string(),
    driveFileId: v.string(),
    status: v.union(v.literal("active"), v.literal("removed")),
    currentVersionId: v.optional(v.id("qaVisualPieceVersions")),
    currentImportPieceId: v.optional(v.id("qaVisualCampaignPieces")),
    versionCount: v.number(),
  })
    .index("by_campaign_file_key", ["campaignId", "fileKey", "status"])
    .index("by_campaign_key", ["campaignId", "key"])
    .index("by_campaign_drive", ["campaignId", "driveFileId"])
    .index("by_campaign", ["campaignId", "status"]),
  qaVisualPieceVersions: defineTable({
    pieceId: v.id("qaVisualPieces"),
    campaignId: v.id("qaVisualCampaigns"),
    number: v.number(),
    contentHash: v.string(),
    driveFileId: v.string(),
    driveVersion: v.string(),
    fileName: v.string(),
    currentInputHash: v.string(),
    currentImportPieceId: v.id("qaVisualCampaignPieces"),
    currentDecisionId: v.optional(v.id("qaVisualDecisions")),
    copyId: v.optional(v.id("qaVisualImageCopies")),
    humanActivity: v.optional(v.boolean()),
    openThreads: v.optional(v.number()),
    threadCount: v.optional(v.number()),
  })
    .index("by_piece", ["pieceId", "number"])
    .index("by_piece_content", ["pieceId", "contentHash"])
    .index("by_drive_version", ["campaignId", "driveFileId", "driveVersion"]),
  qaVisualThreads: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    pieceId: v.id("qaVisualPieces"),
    pieceVersionId: v.id("qaVisualPieceVersions"),
    origin: v.union(
      v.object({ kind: v.literal("human") }),
      v.object({
        kind: v.literal("finding"),
        reviewId: v.id("qaVisualReviews"),
        ruleId: v.string(),
      }),
    ),
    anchor,
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdBy: v.id("users"),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    lastActivityAt: v.number(),
    commentCount: v.number(),
    requestId: v.optional(v.string()),
  })
    .index("by_version", ["pieceVersionId", "status"])
    .index("by_finding", ["origin.reviewId", "origin.ruleId"])
    .index("by_request", ["createdBy", "requestId"]),
  qaVisualComments: defineTable({
    threadId: v.id("qaVisualThreads"),
    pieceVersionId: v.id("qaVisualPieceVersions"),
    authorId: v.id("users"),
    body: v.string(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    requestId: v.optional(v.string()),
    event: v.optional(v.union(v.literal("resolved"), v.literal("reopened"))),
  })
    .index("by_thread", ["threadId"])
    .index("by_version", ["pieceVersionId"])
    .index("by_request", ["authorId", "requestId"]),
  qaVisualDecisions: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    pieceId: v.id("qaVisualPieces"),
    pieceVersionId: v.id("qaVisualPieceVersions"),
    decision: v.union(
      v.literal("approved"),
      v.literal("changesRequested"),
      v.literal("revoked"),
    ),
    exception: v.optional(exception),
    note: v.optional(v.string()),
    decidedBy: v.id("users"),
    supersedesId: v.optional(v.id("qaVisualDecisions")),
    aiSeen: v.object({
      reviewId: v.optional(v.id("qaVisualReviews")),
      verdict: v.optional(v.string()),
      status: v.optional(v.string()),
      inputHash: v.optional(v.string()),
      stale: v.boolean(),
    }),
  }).index("by_version", ["pieceVersionId"]),
  qaVisualLinkOverrides: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    kind: v.union(v.literal("productAlias"), v.literal("offerLink")),
    pieceKey: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    row: v.optional(v.string()),
    ordinal: v.optional(v.string()),
    note: v.string(),
    createdBy: v.id("users"),
    revokedAt: v.optional(v.number()),
  }).index("by_campaign", ["campaignId"]),
  qaVisualCampaigns: defineTable({
    name: v.string(),
    driveFolderId: v.string(),
    reviewKey: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdBy: v.id("users"),
    currentSnapshotId: v.optional(v.id("qaVisualCampaignSnapshots")),
    sync: v.optional(
      v.object({
        startedAt: v.number(),
        jobId: v.id("_scheduled_functions"),
      }),
    ),
    lastSyncedAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
  })
    .index("by_review_key", ["reviewKey"])
    .index("by_drive_folder", ["driveFolderId"])
    .index("by_status", ["status"]),
  qaVisualSourceDocuments: defineTable({
    campaign: v.string(),
    name: v.string(),
    hash: v.string(),
    mappingVersion: v.optional(v.string()),
    kind: v.optional(sourceKind),
    driveFileId: v.optional(v.string()),
    driveVersion: v.optional(v.string()),
    bytes: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    storageId: v.id("_storage"),
  }).index("by_drive_version", [
    "campaign",
    "kind",
    "driveFileId",
    "driveVersion",
  ]),
  qaVisualCampaignSnapshots: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    fingerprint: v.string(),
    excelDocumentId: v.id("qaVisualSourceDocuments"),
    csvDocumentId: v.id("qaVisualSourceDocuments"),
    deploymentFolderId: v.string(),
    ruleVersion: v.string(),
    rules: v.array(rule),
    notices: v.array(v.string()),
    imageWarmupJobId: v.optional(v.id("_scheduled_functions")),
    imageWarmupComplete: v.optional(v.boolean()),
  }).index("by_campaign_fingerprint", ["campaignId", "fingerprint"]),
  qaVisualCampaignPieces: defineTable({
    snapshotId: v.id("qaVisualCampaignSnapshots"),
    order: v.number(),
    file: pieceFile,
    input,
    pieceId: v.optional(v.id("qaVisualPieces")),
    pieceVersionId: v.optional(v.id("qaVisualPieceVersions")),
  })
    .index("by_snapshot", ["snapshotId", "order"])
    .index("by_drive_version", [
      "snapshotId",
      "file.driveId",
      "file.driveVersion",
    ]),
  qaVisualImageCopies: defineTable({
    campaign: v.string(),
    driveId: v.string(),
    driveVersion: v.string(),
    lease: v.optional(v.object({ token: v.string(), expiresAt: v.number() })),
    files: v.optional(
      v.object({
        thumbnailId: v.id("_storage"),
        analysisId: v.id("_storage"),
        snapshot,
      }),
    ),
  }).index("by_version", ["campaign", "driveId", "driveVersion"]),
  qaVisualClientRequirements: defineTable({
    documentId: v.id("qaVisualSourceDocuments"),
    cell: v.optional(sourceCell),
    piece: v.optional(v.string()),
    requirement: v.optional(clientRequirement),
  }).index("by_document", ["documentId"]),
  qaVisualRuleSets: defineTable({
    campaign: v.string(),
    version: v.string(),
    rules: v.array(rule),
    sourceDocumentId: v.optional(v.id("qaVisualSourceDocuments")),
  }).index("by_campaign_version", ["campaign", "version"]),
  qaVisualAssetVersions: defineTable({
    campaign: v.string(),
    input,
    snapshot,
    storageId: v.id("_storage"),
  })
    .index("by_storage", ["storageId"])
    .index("by_input", [
      "campaign",
      "input.name",
      "input.contextKey",
      "snapshot.hash",
    ]),
  qaVisualRuns: defineTable({
    campaign: v.string(),
    requestedBy: v.id("users"),
    snapshotId: v.optional(v.id("qaVisualCampaignSnapshots")),
    ruleSetId: v.id("qaVisualRuleSets"),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
    state: v.union(
      v.literal("preparing"),
      v.literal("running"),
      v.literal("finished"),
    ),
    requestId: v.string(),
    activeBatch: v.optional(v.array(v.id("qaVisualReviews"))),
    rollingQueue: v.optional(v.literal(true)),
  })
    .index("by_campaign_state", ["campaign", "state"])
    .index("by_campaign", ["campaign"])
    .index("by_request", ["requestedBy", "requestId"]),
  qaVisualReviews: defineTable({
    runId: v.id("qaVisualRuns"),
    campaign: v.string(),
    campaignId: v.optional(v.id("qaVisualCampaigns")),
    pieceId: v.optional(v.id("qaVisualPieces")),
    pieceVersionId: v.optional(v.id("qaVisualPieceVersions")),
    input,
    order: v.number(),
    status,
    assetId: v.optional(v.id("qaVisualAssetVersions")),
    copyId: v.optional(v.id("qaVisualImageCopies")),
    attempts: v.array(attempt),
    findings: v.optional(v.array(finding)),
    result: v.optional(result),
    error: v.optional(v.string()),
    verdict: v.optional(
      v.union(
        v.literal("findings"),
        v.literal("validated"),
        v.literal("partial"),
      ),
    ),
  })
    .index("by_version_input", ["pieceVersionId", "input.contextKey", "status"])
    .index("by_version", ["pieceVersionId"])
    .index("by_run", ["runId", "order"])
    .index("by_run_status", ["runId", "status", "order"])
    .index("by_piece", ["campaign", "input.name", "input.contextKey"])
    .index("by_piece_status", [
      "campaign",
      "input.name",
      "input.contextKey",
      "status",
    ]),
};
