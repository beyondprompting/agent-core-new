import { v, type Infer } from "convex/values";

export const source = v.object({
  file: v.union(
    v.literal("excel"),
    v.literal("csv"),
    v.literal("filename"),
    v.literal("override"),
  ),
  name: v.optional(v.string()),
  sheet: v.optional(v.string()),
  cell: v.optional(v.string()),
  ordinal: v.optional(v.string()),
  csvLine: v.optional(v.number()),
  column: v.optional(v.string()),
  text: v.string(),
});
export const requirementStatus = v.union(
  ...(
    [
      "ready",
      "notRequested",
      "conflict",
      "unresolved",
      "missing",
      "invalid",
    ] as const
  ).map((value) => v.literal(value)),
);
export const basis = v.union(v.literal("client"), v.literal("production"));
export const requirement = v.object({
  ruleId: v.string(),
  status: requirementStatus,
  basis,
  expected: v.optional(v.string()),
  display: v.optional(v.string()),
  expectedAlternatives: v.optional(v.array(v.string())),
  sources: v.array(source),
  issueIds: v.array(v.string()),
});
export const issue = v.object({
  id: v.string(),
  code: v.string(),
  severity: v.union(
    v.literal("info"),
    v.literal("warning"),
    v.literal("blocking"),
  ),
  scope: v.union(v.literal("campaign"), v.literal("piece")),
  affects: v.array(v.string()),
  message: v.string(),
  sources: v.array(source),
  candidates: v.optional(
    v.array(
      v.object({ row: v.string(), ordinal: v.string(), text: v.string() }),
    ),
  ),
});
export const coverage = v.object({
  requested: v.number(),
  executed: v.number(),
  pass: v.number(),
  fail: v.number(),
  unverifiable: v.number(),
  notApplicable: v.number(),
  modelControls: v.number(),
  productionBasis: v.number(),
  conflicts: v.number(),
  // Optional for archived results from the previous analysis policy.
  visualRequested: v.optional(v.number()),
  unresolvedInputs: v.optional(v.number()),
  blockingNotices: v.optional(v.number()),
});
export const verdict = v.union(
  v.literal("validated"),
  v.literal("findings"),
  v.literal("partial"),
);
export const result = v.object({
  verdict,
  coverage,
  reason: v.optional(v.string()),
  reasons: v.optional(v.array(v.string())),
});
export type Source = Infer<typeof source>;
export type Requirement = Infer<typeof requirement>;
export type Issue = Infer<typeof issue>;
export type Coverage = Infer<typeof coverage>;
export type ReviewResult = Infer<typeof result>;
export type MatrixCell = { sheet: string; cell: string; text: string };
export type Matrix = { name: string; cells: MatrixCell[]; issues?: Issue[] };
export type LinkOverride = {
  kind: "productAlias" | "offerLink";
  from?: string;
  to?: string;
  row?: string;
  ordinal?: string;
  pieceKey?: string;
  author?: string;
  at?: number;
};
export const ANALYSIS_POLICY_VERSION = "qa-visual-4";
export const PARSER_VERSION = 5;

export function structuredRequirements(input: {
  requirements?: ({ ruleId: string } | { id: string })[];
}) {
  return (input.requirements ?? []).filter(
    (r): r is Requirement => "ruleId" in r,
  );
}
export function sourceLabel(sources: Source[]) {
  return sources
    .map((s) =>
      s.file === "excel"
        ? `${s.sheet}!${s.cell}${s.ordinal ? ` · n.º ${s.ordinal}` : ""}`
        : s.file === "csv"
          ? `CSV${s.csvLine ? ` · línea ${s.csvLine}` : ""}${s.column ? ` · ${s.column}` : ""}`
          : s.file === "override"
            ? "Confirmación humana"
            : "Nombre del archivo",
    )
    .join(" · ");
}
