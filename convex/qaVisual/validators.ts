import { v } from "convex/values";
import { requirement, issue, source, basis } from "./model/contracts";

export const provider = v.union(v.literal("gemini"), v.literal("openai"));
export const status = v.union(
  v.literal("preparing"),
  v.literal("queued"),
  v.literal("analyzing"),
  v.literal("retrying"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export const outcome = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("unverifiable"),
  v.literal("notApplicable"),
);
export const region = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});
export const locationStatus = v.union(
  v.literal("located"),
  v.literal("absent"),
  v.literal("unreadable"),
  v.literal("unlocated"),
);
export const finding = v.object({
  ruleId: v.string(),
  outcome,
  expected: v.string(),
  observed: v.string(),
  source: v.string(),
  severity: v.union(v.literal("warning"), v.literal("blocking")),
  basis: v.optional(basis),
  method: v.optional(v.union(v.literal("deterministic"), v.literal("model"))),
  modelRead: v.optional(v.boolean()),
  evidenceStatus: v.optional(
    v.union(
      v.literal("readable"),
      v.literal("absent"),
      v.literal("unreadable"),
      v.literal("ambiguous"),
    ),
  ),
  missingElements: v.optional(v.array(v.string())),
  sources: v.optional(v.array(source)),
  expectedAlternatives: v.optional(v.array(v.string())),
  observedValue: v.optional(v.string()),
  causeIssueId: v.optional(v.string()),
  region: v.optional(region),
  visibleAnchor: v.optional(v.string()),
  locationStatus: v.optional(locationStatus),
});
export const rule = v.object({
  id: v.string(),
  criterion: v.string(),
  source: v.string(),
  severity: v.union(v.literal("warning"), v.literal("blocking")),
});
export const attempt = v.object({
  provider,
  model: v.string(),
  elapsedMs: v.number(),
  code: v.string(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});
export const production = v.object({
  csvLine: v.optional(v.number()),
  duplicates: v.optional(
    v.array(
      v.object({
        csvLine: v.number(),
        values: v.record(v.string(), v.string()),
      }),
    ),
  ),
  product: v.string(),
  price: v.string(),
  ctaAsset: v.string(),
  dateAsset: v.string(),
  campaign: v.string(),
  phase: v.string(),
  channel: v.string(),
  platform: v.string(),
  format: v.string(),
  width: v.number(),
  height: v.number(),
});
export const clientRequirement = v.object({
  id: v.string(),
  expected: v.string(),
  source: v.string(),
  pending: v.optional(v.string()),
});
export const sourceCell = v.object({
  sheet: v.string(),
  cell: v.string(),
  text: v.string(),
});
export const reviewNotice = v.object({
  id: v.string(),
  message: v.string(),
  source: v.string(),
});
export const input = v.object({
  name: v.string(),
  revision: v.number(),
  contextKey: v.string(),
  production: v.optional(production),
  requirements: v.optional(v.array(v.union(clientRequirement, requirement))),
  notices: v.optional(v.array(reviewNotice)),
  matrixLinked: v.optional(v.boolean()),
  expected: v.optional(v.record(v.string(), v.string())),
  issues: v.optional(v.array(issue)),
  requirementsHash: v.optional(v.string()),
  policyVersion: v.optional(v.string()),
  contentHash: v.optional(v.string()),
});
export const snapshot = v.object({
  hash: v.string(),
  width: v.number(),
  height: v.number(),
  format: v.string(),
});

export const sourceKind = v.union(v.literal("excel"), v.literal("csv"));
export const pieceFile = v.object({
  createdAt: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  name: v.string(),
  bytes: v.number(),
  updatedAt: v.number(),
  driveId: v.string(),
  driveVersion: v.string(),
  contentHash: v.optional(v.string()),
});
export const campaignPiece = v.object({ file: pieceFile, input });
