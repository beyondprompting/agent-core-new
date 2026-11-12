import { anchor, exception } from "./model/collaboration";
import { result } from "./model/contracts";
import { defineTable } from "convex/server";
import { importStage } from "./model/importProgress";
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

import {
  importId,
  importPieceId,
  sourceFileId,
  importTrigger,
  importBuildStage,
  importError,
  importCounts,
  display,
  manifestEntry,
  disposition,
} from "./model/importContracts";

const audience = v.union(v.literal("internal"), v.literal("client"));
const audioClip = v.object({
  storageId: v.id("_storage"),
  mimeType: v.string(),
  durationMs: v.number(),
  bytes: v.number(),
});
const clientState = v.union(
  v.literal("sent"),
  v.literal("viewed"),
  v.literal("changesRequested"),
  v.literal("approved"),
);

export const qaVisualTables = {
  qaVisualSourceFiles: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    kind: sourceKind,
    driveFileId: v.string(),
    driveVersion: v.string(),
    md5: v.optional(v.string()),
    sha256: v.string(),
    name: v.string(),
    mimeType: v.string(),
    bytes: v.number(),
    modifiedAt: v.number(),
    storageId: v.id("_storage"),
    parsedId: v.optional(v.id("_storage")),
    parserVersion: v.string(),
  })
    .index("by_storage", ["storageId"])
    .index("by_parsed", ["parsedId"])
    .index("by_campaign_drive", ["campaignId", "driveFileId", "driveVersion"])
    .index("by_campaign_sha", ["campaignId", "kind", "sha256"]),
  qaVisualImports: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    requestedBy: v.optional(v.id("users")),
    trigger: importTrigger,
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("building"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("superseded"),
    ),
    stage: v.optional(importBuildStage),
    fingerprint: v.optional(v.string()),
    parserVersion: v.string(),
    templateVersion: v.string(),
    excelFileId: v.optional(v.id("qaVisualSourceFiles")),
    csvFileId: v.optional(v.id("qaVisualSourceFiles")),
    deploymentFolderId: v.optional(v.string()),
    driveFolderName: v.optional(v.string()),
    ruleVersion: v.optional(v.string()),
    rules: v.array(rule),
    notices: v.array(v.string()),
    counts: importCounts,
    manifest: v.array(manifestEntry),
    receipts: v.array(
      v.object({ offset: v.number(), count: v.number(), hash: v.string() }),
    ),
    ignoredFiles: v.array(v.object({ name: v.string(), reason: v.string() })),
    missingImages: v.array(v.object({ key: v.string(), csvLine: v.number() })),
    excludedPieceIds: v.array(v.id("qaVisualPieces")),
    error: v.optional(importError),
    workId: v.optional(v.string()),
    epoch: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
    cleanedAt: v.optional(v.number()),
    planStorageId: v.optional(v.id("_storage")),
    imageWarmupJobId: v.optional(v.id("_scheduled_functions")),
    imageWarmupComplete: v.optional(v.boolean()),
  })
    .index("by_plan", ["planStorageId"])
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_fingerprint", ["campaignId", "fingerprint", "status"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_cleanup", ["status", "cleanedAt"]),
  qaVisualImportPieces: defineTable({
    importId: v.id("qaVisualImports"),
    order: v.number(),
    file: pieceFile,
    input,
    display,
    disposition,
    pieceId: v.optional(v.id("qaVisualPieces")),
    pieceVersionId: v.optional(v.id("qaVisualPieceVersions")),
    requirementsHash: v.string(),
    inputHash: v.string(),
  })
    .index("by_import_order", ["importId", "order"])
    .index("by_import_visible", ["importId", "disposition", "order"])
    .index("by_import_piece", ["importId", "pieceId"])
    .index("by_drive_version", [
      "importId",
      "file.driveId",
      "file.driveVersion",
    ]),
  // Third review (§23): a delivery round publishes approved versions to the client.
  qaVisualDeliveries: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    number: v.number(),
    status: v.union(v.literal("published"), v.literal("withdrawn")),
    message: v.optional(v.string()),
    createdBy: v.id("users"),
    publishedAt: v.number(),
    itemCount: v.number(),
    requestId: v.string(),
  })
    .index("by_campaign_number", ["campaignId", "number"])
    .index("by_request", ["createdBy", "requestId"]),
  qaVisualDeliveryItems: defineTable({
    deliveryId: v.id("qaVisualDeliveries"),
    campaignId: v.id("qaVisualCampaigns"),
    pieceId: v.id("qaVisualPieces"),
    pieceVersionId: v.id("qaVisualPieceVersions"),
    order: v.number(),
    clientVersion: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("superseded"),
      v.literal("withdrawn"),
    ),
    // Frozen when published: the client always sees what this version was compared with.
    brief: v.object({
      title: v.string(),
      format: v.string(),
      fields: v.array(
        v.object({ key: v.string(), label: v.string(), value: v.string() }),
      ),
      requirementsHash: v.optional(v.string()),
    }),
    image: v.optional(v.object({ width: v.number(), height: v.number() })),
    clientState,
    currentDecisionId: v.optional(v.id("qaVisualClientDecisions")),
    firstViewedAt: v.optional(v.number()),
    firstViewedBy: v.optional(v.id("users")),
    publishedAt: v.number(),
  })
    .index("by_campaign_status_order", ["campaignId", "status", "order"])
    .index("by_piece", ["pieceId", "clientVersion"])
    .index("by_delivery", ["deliveryId", "order"])
    .index("by_version", ["pieceVersionId"]),
  qaVisualClientDecisions: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    deliveryItemId: v.id("qaVisualDeliveryItems"),
    pieceId: v.id("qaVisualPieces"),
    decision: v.union(v.literal("approved"), v.literal("changesRequested")),
    note: v.optional(v.string()),
    decidedBy: v.id("users"),
    supersedesId: v.optional(v.id("qaVisualClientDecisions")),
  }).index("by_item", ["deliveryItemId"]),
  // Each uploaded audio can be attached to one comment only.
  qaVisualUploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    commentId: v.optional(v.id("qaVisualComments")),
  })
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"]),
  qaVisualPieces: defineTable({
    campaignId: v.id("qaVisualCampaigns"),
    key: v.string(),
    fileKey: v.string(),
    driveFileId: v.string(),
    status: v.union(
      v.literal("staged"),
      v.literal("active"),
      v.literal("removed"),
      v.literal("excluded"),
    ),
    baseKey: v.optional(v.string()),
    duplicateOf: v.optional(v.id("qaVisualPieces")),
    stagedImportId: v.optional(v.id("qaVisualImports")),
    order: v.optional(v.number()),
    display: v.optional(display),
    currentVersionId: v.optional(v.id("qaVisualPieceVersions")),
    currentImportPieceId: v.optional(importPieceId),
    versionCount: v.number(),
  })
    .index("by_campaign_file_key", ["campaignId", "fileKey", "status"])
    .index("by_campaign_key", ["campaignId", "key"])
    .index("by_campaign_drive", ["campaignId", "driveFileId"])
    .index("by_campaign", ["campaignId", "status"])
    .index("by_campaign_order", ["campaignId", "status", "order"])
    .index("by_staged_import", ["stagedImportId"]),
  qaVisualPieceVersions: defineTable({
    pieceId: v.id("qaVisualPieces"),
    originalPieceId: v.optional(v.id("qaVisualPieces")),
    campaignId: v.id("qaVisualCampaigns"),
    number: v.number(),
    status: v.optional(v.union(v.literal("staged"), v.literal("active"))),
    stagedImportId: v.optional(v.id("qaVisualImports")),
    driveCreatedAt: v.optional(v.number()),
    contentHash: v.string(),
    driveFileId: v.string(),
    driveVersion: v.string(),
    fileName: v.string(),
    currentInputHash: v.string(),
    currentImportPieceId: importPieceId,
    currentDecisionId: v.optional(v.id("qaVisualDecisions")),
    copyId: v.optional(v.id("qaVisualImageCopies")),
    humanActivity: v.optional(v.boolean()),
    openThreads: v.optional(v.number()),
    threadCount: v.optional(v.number()),
  })
    .index("by_piece", ["pieceId", "number"])
    .index("by_piece_content", ["pieceId", "contentHash"])
    .index("by_campaign", ["campaignId"])
    .index("by_drive_version", ["campaignId", "driveFileId", "driveVersion"])
    .index("by_staged_import", ["stagedImportId"])
    .index("by_piece_status", ["pieceId", "status", "number"]),
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
    // Missing = internal. Client threads are the only ones visible in the client portal.
    audience: v.optional(audience),
    deliveryItemId: v.optional(v.id("qaVisualDeliveryItems")),
    createdBy: v.id("users"),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    lastActivityAt: v.number(),
    commentCount: v.number(),
    requestId: v.optional(v.string()),
  })
    .index("by_version", ["pieceVersionId", "status"])
    .index("by_finding", ["origin.reviewId", "origin.ruleId"])
    .index("by_item", ["deliveryItemId", "status"])
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
    // Missing = internal. Inside a client thread an internal comment is a private note.
    visibility: v.optional(audience),
    authorKind: v.optional(audience),
    audio: v.optional(audioClip),
    transcript: v.optional(
      v.object({
        status: v.union(
          v.literal("pending"),
          v.literal("done"),
          v.literal("failed"),
        ),
        text: v.optional(v.string()),
      }),
    ),
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
    kind: v.union(
      v.literal("productAlias"),
      v.literal("offerLink"),
      v.literal("keepDuplicate"),
      v.literal("mergeAsVersion"),
    ),
    baseKey: v.optional(v.string()),
    keepDriveFileId: v.optional(v.string()),
    olderDriveFileId: v.optional(v.string()),
    newerDriveFileId: v.optional(v.string()),
    revokedBy: v.optional(v.id("users")),
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
    currentImportId: v.optional(v.id("qaVisualImports")),
    activeImportId: v.optional(v.id("qaVisualImports")),
    driveFolderName: v.optional(v.string()),
    sync: v.optional(
      v.object({
        startedAt: v.number(),
        jobId: v.id("_scheduled_functions"),
        stage: v.optional(importStage),
        images: v.optional(v.number()),
      }),
    ),
    lastSyncedAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    syncNeedsSources: v.optional(v.boolean()),
    sourceSelection: v.optional(
      v.object({
        excelFileId: v.optional(v.string()),
        csvFileId: v.optional(v.string()),
      }),
    ),
    client: v.optional(
      v.object({
        clientId: v.id("corClients"),
        brandId: v.optional(v.id("clientBrands")),
      }),
    ),
    clientReview: v.optional(
      v.object({
        enabled: v.boolean(),
        agencyLabel: v.string(),
        approverIds: v.optional(v.array(v.id("users"))),
        // Keys of the client brief shown in the portal (§23.16 C2). Missing = all.
        briefFields: v.optional(v.array(v.string())),
      }),
    ),
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
        // 640 px WebP for gallery and carousel thumbnails (§23.9). Older copies fall back to analysis.
        previewId: v.optional(v.id("_storage")),
        snapshot,
      }),
    ),
    // Image pool job in flight and last terminal failure (§13).
    job: v.optional(v.object({ workId: v.string(), at: v.number() })),
    error: v.optional(v.string()),
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
    sourceDocumentId: v.optional(sourceFileId),
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
    snapshotId: v.optional(importId),
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
    scope: v.optional(v.union(v.literal("pending"), v.literal("all"))),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("users")),
    // "pool": stage 4 runner (qaVisualAnalysisPool). Missing: legacy workflow runner.
    runner: v.optional(v.literal("pool")),
    finishedAt: v.optional(v.number()),
  })
    .index("by_state", ["state"])
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
    workId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
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
