import {
  ANALYSIS_POLICY_VERSION,
  type Issue,
  type Requirement,
  type ReviewResult,
} from "./contracts";

type Control = {
  ruleId: string;
  outcome: "pass" | "fail" | "unverifiable" | "notApplicable";
  modelRead?: boolean;
  method?: string;
};

export function reviewResult(
  requirements: Requirement[],
  findings: Control[],
  issues: Issue[] = [],
): ReviewResult {
  const coverage = {
    requested: 0,
    executed: 0,
    pass: 0,
    fail: 0,
    unverifiable: 0,
    notApplicable: 0,
    modelControls: 0,
    productionBasis: 0,
    conflicts: 0,
    visualRequested: 0,
    unresolvedInputs: 0,
    blockingNotices: 0,
  };
  for (const requirement of requirements) {
    if (requirement.status === "notRequested") {
      coverage.notApplicable++;
      continue;
    }
    coverage.requested++;
    const visual =
      requirement.ruleId !== "format" && requirement.ruleId !== "dimensions";
    if (visual) coverage.visualRequested++;
    if (requirement.status !== "ready") coverage.unresolvedInputs++;
    if (requirement.basis === "production") coverage.productionBasis++;
    if (requirement.status === "conflict") coverage.conflicts++;
    const matches = findings.filter((f) => f.ruleId === requirement.ruleId);
    const control = matches.length === 1 ? matches[0] : undefined;
    if (visual && (control?.modelRead || control?.method === "model"))
      coverage.modelControls++;
    if (matches.some((f) => f.outcome === "fail")) {
      coverage.executed++;
      coverage.fail++;
    } else if (control?.outcome === "pass") {
      coverage.executed++;
      coverage.pass++;
    } else coverage.unverifiable++;
  }
  const requested = requirements.filter((r) => r.status !== "notRequested");
  const requestedIds = new Set(requested.map((r) => r.ruleId));
  coverage.blockingNotices = new Set(
    issues
      .filter(
        (i) =>
          i.severity !== "info" && i.affects.some((id) => requestedIds.has(id)),
      )
      .map((i) => i.id),
  ).size;
  // The order is also the priority of the main reason displayed in the UI.
  const reasons: string[] = [];
  if (
    !coverage.requested ||
    coverage.productionBasis ||
    requested.some((r) => r.status === "unresolved" || r.status === "missing")
  )
    reasons.push("Pedido sin vincular o incompleto");
  if (coverage.conflicts) reasons.push("Conflicto de fuentes");
  if (requested.some((r) => r.status === "invalid"))
    reasons.push("Dato inválido en el pedido");
  if (requestedIds.size !== requested.length)
    reasons.push("Controles duplicados en el pedido");
  if (coverage.blockingNotices) reasons.push("Vinculación por confirmar");
  if (coverage.unverifiable)
    reasons.push("Evidencia ilegible o controles sin verificar");
  if (!coverage.visualRequested || !coverage.modelControls)
    reasons.push("Solo controles técnicos");
  else if (coverage.modelControls !== coverage.visualRequested)
    reasons.push("Controles visuales sin verificar por IA");
  const validated =
    coverage.requested > 0 &&
    coverage.pass === coverage.requested &&
    !reasons.length;
  return {
    verdict: coverage.fail ? "findings" : validated ? "validated" : "partial",
    coverage,
    ...(reasons.length ? { reason: reasons[0], reasons } : {}),
  };
}

export function isCurrentReview(
  input: { contextKey: string; policyVersion?: string },
  currentInputHash: string,
) {
  return (
    input.contextKey === currentInputHash &&
    input.policyVersion === ANALYSIS_POLICY_VERSION
  );
}

/** Technical progress/errors take priority; an old completed result is never current green. */
export function displayReviewStatus<T extends string>(
  review: {
    status: T;
    input: { contextKey: string; policyVersion?: string };
  },
  currentInputHash: string,
): T | "stale" {
  return review.status === "completed" &&
    !isCurrentReview(review.input, currentInputHash)
    ? "stale"
    : review.status;
}
