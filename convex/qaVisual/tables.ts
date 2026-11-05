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
  status,
} from "./validators";

export const qaVisualTables = {
  qaVisualSourceDocuments: defineTable({
    campaign: v.string(),
    name: v.string(),
    hash: v.string(),
    mappingVersion: v.string(),
    storageId: v.id("_storage"),
  }).index("by_version", ["campaign", "hash", "mappingVersion"]),
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
    ruleSetId: v.id("qaVisualRuleSets"),
    kind: v.union(v.literal("batch"), v.literal("piece"), v.literal("retry")),
    state: v.union(
      v.literal("preparing"),
      v.literal("running"),
      v.literal("finished"),
    ),
    requestId: v.string(),
  })
    .index("by_campaign_state", ["campaign", "state"])
    .index("by_campaign", ["campaign"])
    .index("by_request", ["requestedBy", "requestId"]),
  qaVisualReviews: defineTable({
    runId: v.id("qaVisualRuns"),
    campaign: v.string(),
    input,
    order: v.number(),
    status,
    assetId: v.optional(v.id("qaVisualAssetVersions")),
    attempts: v.array(attempt),
    findings: v.optional(v.array(finding)),
    error: v.optional(v.string()),
    verdict: v.optional(
      v.union(
        v.literal("findings"),
        v.literal("validated"),
        v.literal("partial"),
      ),
    ),
  })
    .index("by_run", ["runId", "order"])
    .index("by_piece", ["campaign", "input.name", "input.contextKey"])
    .index("by_piece_status", [
      "campaign",
      "input.name",
      "input.contextKey",
      "status",
    ]),
};
