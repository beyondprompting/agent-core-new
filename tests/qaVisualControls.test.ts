import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVisibleValue,
  resolveVisualControl,
  type VisualAssessment,
} from "../convex/qaVisual/model/controls";
import type { Requirement } from "../convex/qaVisual/model/contracts";
import { reviewResult } from "../convex/qaVisual/model/verdict";
import { buildAnalysisFeed } from "../app/lib/qa-visual/analysis-feed";
import { getAiReviewState } from "../app/lib/qa-visual/review-state";
import { completeCommentLocations } from "../convex/qaVisual/commentLocations";

const requirement = (ruleId: string, expected: string): Requirement => ({
  ruleId,
  expected,
  status: "ready",
  basis: "client",
  sources: [],
  issueIds: [],
});
const assessment = (
  visibleText: string | null,
  extra: Partial<VisualAssessment> = {},
): VisualAssessment => ({
  visibleText,
  evidenceStatus: "readable",
  outcome: "pass",
  missingElements: [],
  observed: `Se lee «${visibleText}».`,
  ...extra,
});
const date = requirement("date", "15 DE OCTUBRE");

test("a readable date missing the requested month produces one finding, not an incomplete review", () => {
  const result = resolveVisualControl(
    date,
    assessment("JUEVES 15", { outcome: "unverifiable" }),
  );
  assert.equal(result.outcome, "fail");
  assert.match(result.observed, /omite el mes/);
  const requirements = ["format", "dimensions", "product", "cta"].map((id) =>
    requirement(id, "Pedido"),
  );
  requirements.push(date);
  const controls = requirements.map((r) => ({
    ruleId: r.ruleId,
    modelRead: true,
    outcome: "pass" as const,
  }));
  const findings = [
    ...controls.slice(0, -1),
    { ruleId: "date", modelRead: true, ...result },
  ];
  const review = reviewResult(requirements, findings);
  assert.equal(review.verdict, "findings");
  assert.equal(review.coverage.executed, 5);
  assert.equal(review.coverage.fail, 1);
  assert.equal(review.coverage.unverifiable, 0);
  const feed = buildAnalysisFeed([
    {
      name: "piece",
      status: "completed",
      verdict: review.verdict,
      findings: [
        {
          ruleId: "date",
          ...result,
          expected: date.expected!,
          source: "Cliente",
          severity: "warning",
        },
      ],
    },
  ]);
  assert.equal(feed.comments[0].role, "Hallazgo");
  assert.equal(
    getAiReviewState(feed.results.piece[1], feed.comments).shortLabel,
    "1 hallazgo",
  );
});

test("equivalent date formats retain all required information", () => {
  for (const visible of [
    "15 DE OCTUBRE",
    "OCTUBRE 15",
    "15 OCT.",
    "15/10",
    "15-10",
    "15.10",
    "15/10/2026",
    "2026-10-15",
    "JUEVES 15 DE OCTUBRE",
  ]) {
    const result = resolveVisualControl(
      date,
      assessment(visible, { outcome: "unverifiable" }),
    );
    assert.equal(result.outcome, "pass", visible);
    assert.equal(result.method, "deterministic");
  }
});

test("missing or different required date components fail without inferring them from the brief", () => {
  for (const [expected, visible] of [
    ["15 DE OCTUBRE", "15"],
    ["15 DE OCTUBRE", "OCTUBRE"],
    ["15 DE OCTUBRE", "16/10"],
    ["15 DE OCTUBRE", "15/11"],
    ["15 DE OCTUBRE DE 2026", "15/10"],
    ["15 DE OCTUBRE DE 2026", "15/10/2027"],
    ["JUEVES 15 DE OCTUBRE", "VIERNES 15 DE OCTUBRE"],
    ["JUEVES 15 DE OCTUBRE", "15/10"],
    ["15 DE OCTUBRE", "HOY"],
    ["HOY", "15 DE OCTUBRE"],
    ["28 DE FEBRERO", "31/02"],
  ])
    assert.equal(
      resolveVisualControl(requirement("date", expected), assessment(visible))
        .outcome,
      "fail",
      `${expected} / ${visible}`,
    );
});

test("readable omissions in product, CTA and price are failures even if the model calls them unverifiable", () => {
  for (const [ruleId, expected, visible, missing] of [
    ["product", "FESTIN LOCURA 12 PRESAS", "FESTIN LOCURA", "12 PRESAS"],
    [
      "cta",
      "Descargá la app",
      "A DOMICILIO POR KFC APP",
      "invitación a descargar",
    ],
    ["price", "$8,99", "$8,", "centavos requeridos"],
  ]) {
    const result = resolveVisualControl(
      requirement(ruleId, expected),
      assessment(visible, {
        outcome: "unverifiable",
        missingElements: [missing],
      }),
    );
    assert.equal(result.outcome, "fail");
    assert.ok(result.observed.includes(missing));
  }
});

test("confirmed absence differs from unreadable or ambiguous evidence", () => {
  for (const ruleId of ["price", "date", "product", "cta"]) {
    const req = requirement(ruleId, "Referencia confirmada");
    const absent = resolveVisualControl(
      req,
      assessment(null, {
        evidenceStatus: "absent",
        observed: "El elemento no aparece en la imagen completa.",
      }),
    );
    assert.equal(absent.outcome, "fail", ruleId);
    for (const evidenceStatus of ["unreadable", "ambiguous"] as const) {
      const result = resolveVisualControl(
        req,
        assessment(null, {
          evidenceStatus,
          observed: "La zona está borrosa y no se puede determinar el texto.",
        }),
      );
      assert.equal(
        result.outcome,
        "unverifiable",
        `${ruleId} / ${evidenceStatus}`,
      );
    }
    assert.equal(
      resolveVisualControl(
        { ...req, expected: undefined, status: "missing" },
        assessment(null, { evidenceStatus: "absent" }),
      ).outcome,
      "unverifiable",
    );
  }
});

test("unsupported readable syntax uses semantic evaluation rather than returning unverifiable", () => {
  for (const [req, text] of [
    [requirement("price", "$8,99"), "USD 8.99"],
    [requirement("date", "DEL 15 AL 20 DE OCTUBRE"), "15–20 OCT"],
  ] as const) {
    assert.equal(compareVisibleValue(req, text), undefined);
    for (const outcome of ["pass", "fail"] as const) {
      const result = resolveVisualControl(
        req,
        assessment(text, {
          outcome,
          observed: "Comparación semántica de todo el contenido solicitado.",
        }),
      );
      assert.equal(result.outcome, outcome);
      assert.equal(result.method, "model");
    }
  }
  // Do not take the first date from a range and silently approve it.
  assert.equal(
    compareVisibleValue(date, "15 DE OCTUBRE AL 20 DE NOVIEMBRE"),
    undefined,
  );
});

test("price comparison remains exact and a CSV alternative cannot override the client", () => {
  const req = {
    ...requirement("price", "$8,99"),
    expectedAlternatives: ["$9,99"],
  };
  assert.equal(resolveVisualControl(req, assessment("8.99")).outcome, "pass");
  assert.equal(resolveVisualControl(req, assessment("9.99")).outcome, "fail");
  assert.equal(
    resolveVisualControl(
      req,
      assessment("8 o 9", {
        evidenceStatus: "ambiguous",
        observed:
          "Hay dos importes y no se distingue cuál corresponde a la oferta.",
      }),
    ).outcome,
    "unverifiable",
  );
});

test("invalid model classifications trigger retry instead of a completed incomplete review", () => {
  assert.throws(
    () =>
      resolveVisualControl(
        date,
        assessment("Quince de octubre", { outcome: "unverifiable" }),
      ),
    /invalid_controls/,
  );
  assert.throws(
    () =>
      resolveVisualControl(
        requirement("cta", "Descargá la app"),
        assessment("Descargá la app", { outcome: "notApplicable" }),
      ),
    /invalid_controls/,
  );
  assert.throws(
    () => resolveVisualControl(date, assessment(null)),
    /invalid_controls/,
  );
  assert.throws(
    () =>
      resolveVisualControl(
        date,
        assessment(null, {
          evidenceStatus: "unreadable",
          missingElements: ["mes"],
        }),
      ),
    /invalid_controls/,
  );
  assert.equal(
    resolveVisualControl({ ...date, status: "notRequested" }, assessment(null))
      .outcome,
    "notApplicable",
  );
});

test("an omission stays a finding when localization fails and another control is unreadable", async () => {
  const result = resolveVisualControl(date, assessment("JUEVES 15"));
  const [located] = await completeCommentLocations(
    [{ ruleId: "date", ...result, region: null, visibleAnchor: "JUEVES 15" }],
    async () => {
      throw new Error("timeout");
    },
  );
  assert.equal(located.outcome, "fail");
  assert.equal(located.locationStatus, "unlocated");
  assert.equal(
    reviewResult(
      [date, requirement("product", "Combo")],
      [
        { ...located, modelRead: true },
        { ruleId: "product", outcome: "unverifiable", modelRead: true },
      ],
    ).verdict,
    "findings",
  );
});
