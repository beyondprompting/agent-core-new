import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYSIS_POLICY_VERSION,
  type Issue,
  type Requirement,
} from "../convex/qaVisual/model/contracts";
import {
  displayReviewStatus,
  reviewResult,
} from "../convex/qaVisual/model/verdict";
import { buildAnalysisFeed } from "../app/lib/qa-visual/analysis-feed";
import { getAiReviewState } from "../app/lib/qa-visual/review-state";

const requirements: Requirement[] = [
  "format",
  "dimensions",
  "product",
  "price",
  "date",
  "cta",
].map((ruleId) => ({
  ruleId,
  status: "ready",
  basis: "client",
  expected: "Referencia del cliente",
  sources: [],
  issueIds: [],
}));
const controls = requirements.map(({ ruleId }) => ({
  ruleId,
  outcome: "pass" as const,
  method: ["product", "cta"].includes(ruleId) ? "model" : "deterministic",
  modelRead: ["price", "date"].includes(ruleId),
}));
const notice = (extra: Partial<Issue> = {}): Issue => ({
  id: "notice",
  code: "offer_name_partial",
  severity: "warning",
  scope: "piece",
  affects: ["product"],
  message: "Vinculación por confirmar",
  sources: [],
  ...extra,
});

test("all requested controls must pass against client references, including every visual model observation", () => {
  const result = reviewResult(requirements, controls);
  assert.equal(result.verdict, "validated");
  assert.equal(result.coverage.requested, 6);
  assert.equal(result.coverage.pass, 6);
  assert.equal(result.coverage.visualRequested, 4);
  assert.equal(result.coverage.modelControls, 4);
  assert.equal(result.coverage.unresolvedInputs, 0);
  assert.equal(result.coverage.blockingNotices, 0);
});

test("no requested controls and technical-only controls cannot produce green, including 0 === 0 model coverage", () => {
  assert.equal(reviewResult([], []).verdict, "partial");
  assert.equal(reviewResult([], []).reason, "Pedido sin vincular o incompleto");
  const result = reviewResult(
    requirements.slice(0, 2),
    controls
      .slice(0, 2)
      .map((c) => ({ ...c, method: "model", modelRead: true })),
  );
  assert.equal(result.verdict, "partial");
  assert.equal(result.coverage.visualRequested, 0);
  assert.equal(result.coverage.modelControls, 0);
  assert.equal(result.reason, "Solo controles técnicos");
});

for (const outcome of [
  "unverifiable",
  "notApplicable",
  "missing",
  "duplicated",
] as const) {
  test(`a requested control that is ${outcome} prevents validation`, () => {
    const altered =
      outcome === "missing"
        ? controls.slice(1)
        : outcome === "duplicated"
          ? [...controls, controls[0]]
          : controls.map((c, i) => (i ? c : { ...c, outcome }));
    const result = reviewResult(requirements, altered);
    assert.equal(result.verdict, "partial");
    assert.equal(result.coverage.unverifiable, 1);
    assert.equal(result.coverage.executed, 5);
  });
}

test("a production reference and each unresolved requirement state block green even with passing findings", () => {
  const production = requirements.map((r, i) =>
    i === 2 ? { ...r, basis: "production" as const } : r,
  );
  assert.equal(reviewResult(production, controls).verdict, "partial");
  for (const status of [
    "conflict",
    "unresolved",
    "missing",
    "invalid",
  ] as const) {
    const result = reviewResult(
      requirements.map((r, i) => (i === 2 ? { ...r, status } : r)),
      controls,
    );
    assert.equal(result.verdict, "partial", status);
    assert.equal(result.coverage.unresolvedInputs, 1);
  }
});

test("only warnings and blocking notices affecting requested controls prevent green", () => {
  for (const severity of ["warning", "blocking"] as const) {
    const issue = notice({ severity });
    const result = reviewResult(requirements, controls, [issue, issue]);
    assert.equal(result.verdict, "partial");
    assert.equal(result.coverage.blockingNotices, 1);
    assert.equal(result.reason, "Vinculación por confirmar");
  }
  for (const issue of [
    notice({ severity: "info" }),
    notice({ affects: [] }),
    notice({ affects: ["not-a-requested-rule"] }),
  ])
    assert.equal(
      reviewResult(requirements, controls, [issue]).verdict,
      "validated",
    );
  const withoutCta = requirements.map((r) =>
    r.ruleId === "cta" ? { ...r, status: "notRequested" as const } : r,
  );
  assert.equal(
    reviewResult(withoutCta, controls.slice(0, -1), [
      notice({ affects: ["cta"] }),
    ]).verdict,
    "validated",
  );
});

test("one visual model control cannot stand in for another or for a custom visual rule", () => {
  const result = reviewResult(
    requirements,
    controls.map((c) =>
      c.ruleId === "price" ? { ...c, modelRead: false } : c,
    ),
  );
  assert.equal(result.verdict, "partial");
  assert.equal(result.coverage.modelControls, 3);
  assert.equal(result.coverage.visualRequested, 4);
  assert.equal(
    reviewResult(
      [...requirements, { ...requirements[2], ruleId: "legal" }],
      [
        ...controls,
        {
          ruleId: "legal",
          outcome: "pass",
          method: "deterministic",
          modelRead: false,
        },
      ],
    ).verdict,
    "partial",
  );
});

test("a failure takes precedence over incomplete coverage and is never hidden by a duplicate control", () => {
  const findings = controls.map((c, i) =>
    i === 2
      ? { ...c, outcome: "fail" as const }
      : i === 3
        ? { ...c, outcome: "unverifiable" as const }
        : c,
  );
  const result = reviewResult(
    requirements,
    [...findings, controls[2]],
    [notice()],
  );
  assert.equal(result.verdict, "findings");
  assert.equal(result.coverage.fail, 1);
  assert.equal(result.coverage.unverifiable, 1);
});

test("incomplete reasons follow source, conflict, confirmation, evidence and technical priority", () => {
  const altered = requirements.map((r, i) =>
    i === 2
      ? { ...r, basis: "production" as const }
      : i === 3
        ? { ...r, status: "conflict" as const }
        : r,
  );
  const result = reviewResult(altered, [], [notice()]);
  assert.equal(result.verdict, "partial");
  assert.deepEqual(result.reasons, [
    "Pedido sin vincular o incompleto",
    "Conflicto de fuentes",
    "Vinculación por confirmar",
    "Evidencia ilegible o controles sin verificar",
    "Solo controles técnicos",
  ]);
  assert.equal(result.reason, result.reasons?.[0]);
});

test("technical progress/errors and freshness override a previously green verdict", () => {
  const input = {
    contextKey: "current",
    policyVersion: ANALYSIS_POLICY_VERSION,
  };
  for (const status of [
    "pending",
    "preparing",
    "queued",
    "analyzing",
    "retrying",
    "failed",
  ] as const) {
    const visible = displayReviewStatus({ status, input }, "current");
    const feed = buildAnalysisFeed([
      { name: "piece", status: visible, verdict: "validated" },
    ]);
    assert.notEqual(feed.results.piece?.[1], "validated");
    assert.equal(visible, status);
  }
  for (const obsolete of [
    { ...input, contextKey: "previous" },
    { ...input, policyVersion: "qa-visual-3" },
  ]) {
    const status = displayReviewStatus(
      { status: "completed", input: obsolete },
      "current",
    );
    const feed = buildAnalysisFeed([
      { name: "piece", status, verdict: "validated" },
    ]);
    const state = getAiReviewState(feed.results.piece[1], feed.comments);
    assert.equal(state.status, "stale");
    assert.equal(state.tone, "neutral");
  }
  assert.equal(
    displayReviewStatus({ status: "completed", input }, "current"),
    "completed",
  );
});
