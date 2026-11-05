import { v } from "convex/values";

export const provider = v.union(v.literal("gemini"), v.literal("openai"));
export const status = v.union(
  v.literal("preparing"),
  v.literal("queued"),
  v.literal("analyzing"),
  v.literal("retrying"),
  v.literal("completed"),
  v.literal("failed"),
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
export const finding = v.object({
  ruleId: v.string(),
  outcome,
  expected: v.string(),
  observed: v.string(),
  source: v.string(),
  severity: v.union(v.literal("warning"), v.literal("blocking")),
  region: v.optional(region),
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
export const input = v.object({
  name: v.string(),
  revision: v.number(),
  contextKey: v.string(),
  production: v.optional(production),
  requirements: v.optional(v.array(clientRequirement)),
  matrixLinked: v.optional(v.boolean()),
  expected: v.record(v.string(), v.string()),
});
export const snapshot = v.object({
  hash: v.string(),
  width: v.number(),
  height: v.number(),
  format: v.string(),
});
