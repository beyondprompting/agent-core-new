import assert from "node:assert/strict";
import { test } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import { analyzeReview } from "../convex/qaVisual/worker";
import { qaGemini } from "../convex/qaVisual/qaModels";
import { ANALYSIS_POLICY_VERSION } from "../convex/qaVisual/model/contracts";
import { reviewResult } from "../convex/qaVisual/model/verdict";

const requirements = [
  { ruleId: "date", expected: "15 DE OCTUBRE" },
  { ruleId: "price", expected: "$8,99" },
  { ruleId: "cta", expected: "Descargá la app" },
].map((req) => ({
  ...req,
  status: "ready" as const,
  basis: "client" as const,
  sources: [],
  issueIds: [],
}));

const contextWith = (extra: Record<string, unknown> = {}) =>
  ({
    async runQuery() {
      return {
        ...((await context.runQuery({} as never, {} as never)) as object),
        ...extra,
      };
    },
    storage: context.storage,
  }) as unknown as ActionCtx;

const context = {
  async runQuery() {
    return {
      asset: {
        storageId: "image",
        input: { policyVersion: ANALYSIS_POLICY_VERSION, requirements },
        snapshot: {
          width: 1080,
          height: 1080,
          format: "PNG",
          hash: "image-hash",
        },
      },
      rules: requirements.map(({ ruleId }) => ({
        id: ruleId,
        severity: "warning",
        criterion: "Comparar con el pedido",
      })),
    };
  },
  storage: {
    async get() {
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    },
  },
} as unknown as ActionCtx;

function model(controls: Record<string, unknown>[]) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ controls }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 50, text: 50, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

const controls = [
  {
    ruleId: "date",
    visibleText: "JUEVES 15",
    outcome: "unverifiable",
    observed: "Se lee JUEVES 15.",
    missingElements: [],
  },
  {
    ruleId: "price",
    visibleText: "USD 8.99",
    outcome: "pass",
    observed: "El importe coincide con $8,99.",
    missingElements: [],
  },
  {
    ruleId: "cta",
    visibleText: "A DOMICILIO POR KFC APP",
    outcome: "unverifiable",
    observed: "No invita a descargar la app.",
    missingElements: ["invitación a descargar"],
  },
  {
    ruleId: "spelling",
    visibleText: "OFERTA IMPERDIBLE",
    outcome: "pass",
    observed: "El texto está bien escrito.",
    missingElements: [],
  },
].map((control) => ({
  ...control,
  evidenceStatus: "readable",
  waivedByInstructions: false,
  visibleAnchor: control.visibleText,
  box_2d: [100, 100, 200, 400],
}));

test("the worker preserves omissions and semantic fallback through schema parsing and localization", async (t) => {
  const previous = qaGemini.model;
  const mockModel = model(controls);
  qaGemini.model = mockModel;
  t.after(() => {
    qaGemini.model = previous;
  });
  const result = await analyzeReview(
    context,
    "review" as Id<"qaVisualReviews">,
    "gemini",
  );
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(
    result.findings.map(({ ruleId, outcome, method }) => ({
      ruleId,
      outcome,
      method,
    })),
    [
      { ruleId: "date", outcome: "fail", method: "deterministic" },
      { ruleId: "price", outcome: "pass", method: "model" },
      { ruleId: "cta", outcome: "fail", method: "model" },
      { ruleId: "spelling", outcome: "pass", method: "model" },
    ],
  );
  assert.equal(result.findings[0].observedValue, "JUEVES 15");
  assert.equal(result.findings[0].evidenceStatus, "readable");
  assert.deepEqual(result.findings[2].missingElements, [
    "invitación a descargar",
  ]);
  assert.equal(reviewResult(requirements, result.findings).verdict, "findings");
  assert.equal(
    mockModel.doGenerateCalls.length,
    1,
    "Semantic fallback must not need another model call",
  );
});

test("readable unsupported syntax cannot be published as incomplete by the worker", async (t) => {
  const previous = qaGemini.model;
  qaGemini.model = model(
    controls.map((control) =>
      control.ruleId === "price"
        ? {
            ...control,
            outcome: "unverifiable",
            observed: "Formato no reconocido por el parser.",
          }
        : control,
    ),
  );
  t.after(() => {
    qaGemini.model = previous;
  });
  const result = await analyzeReview(
    context,
    "review" as Id<"qaVisualReviews">,
    "gemini",
  );
  assert.equal(result.kind, "provider");
  if (result.kind !== "provider") return;
  assert.equal(result.retryable, true);
  assert.equal(result.attempt.code, "invalid_output");
});

test("every piece is checked for spelling and each error is reported", async (t) => {
  const previous = qaGemini.model;
  const mockModel = model(
    controls.map((control) =>
      control.ruleId === "spelling"
        ? {
            ...control,
            outcome: "fail",
            visibleText: "OFERTA IMPERDIVLE",
            observed: "Hay una palabra mal escrita en el título.",
            missingElements: ["IMPERDIVLE → IMPERDIBLE", "ULTIMOS → ÚLTIMOS"],
          }
        : control,
    ),
  );
  qaGemini.model = mockModel;
  t.after(() => {
    qaGemini.model = previous;
  });
  const result = await analyzeReview(
    context,
    "review" as Id<"qaVisualReviews">,
    "gemini",
  );
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  const spelling = result.findings.find((f) => f.ruleId === "spelling")!;
  assert.equal(spelling.outcome, "fail");
  assert.equal(spelling.severity, "warning");
  assert.match(spelling.observed, /IMPERDIVLE → IMPERDIBLE; ULTIMOS → ÚLTIMOS/);
  const prompt = JSON.stringify(mockModel.doGenerateCalls[0].prompt);
  assert.match(prompt, /El control spelling revisa todo el texto visible/);
  assert.match(prompt, /Control general · ortografía/);
  assert.doesNotMatch(prompt, /instrucciones_del_equipo/);
  // A spelling error alone is a finding, even when every requirement passes.
  const passing = result.findings.map((f) =>
    f.ruleId === "spelling" ? f : { ...f, outcome: "pass" as const },
  );
  assert.equal(reviewResult(requirements, passing).verdict, "findings");
  assert.equal(
    reviewResult(
      requirements,
      passing.map((f) => ({
        ...f,
        outcome: "pass" as const,
        method: "model" as const,
      })),
    ).verdict,
    "validated",
  );
});

test("the QA team's instructions reach the model and can waive a control", async (t) => {
  const previous = qaGemini.model;
  const mockModel = model(
    controls.map((control) =>
      control.ruleId === "date"
        ? {
            ...control,
            outcome: "pass",
            evidenceStatus: "absent",
            visibleText: null,
            observed:
              "No hay fecha visible; se aplicó la instrucción de no revisar la vigencia.",
            waivedByInstructions: true,
          }
        : control,
    ),
  );
  qaGemini.model = mockModel;
  t.after(() => {
    qaGemini.model = previous;
  });
  const instructions = "No marques la vigencia: se agrega después.";
  const result = await analyzeReview(
    contextWith({ instructions }),
    "review" as Id<"qaVisualReviews">,
    "gemini",
  );
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(
    result.findings.find((f) => f.ruleId === "date")!.outcome,
    "pass",
  );
  const prompt = JSON.stringify(mockModel.doGenerateCalls[0].prompt);
  assert.match(prompt, /instrucciones_del_equipo/);
  assert.ok(prompt.includes(instructions));

  // Without instructions, the same answer cannot waive a confirmed absence.
  const plain = await analyzeReview(
    context,
    "review" as Id<"qaVisualReviews">,
    "gemini",
  );
  assert.equal(plain.kind, "success");
  if (plain.kind !== "success") return;
  assert.equal(
    plain.findings.find((f) => f.ruleId === "date")!.outcome,
    "fail",
  );
});

test("a piece without text does not count the spelling control", () => {
  const findings = requirements.map((r) => ({
    ruleId: r.ruleId,
    outcome: "pass" as const,
    method: "model" as const,
  }));
  const result = reviewResult(requirements, [
    ...findings,
    { ruleId: "spelling", outcome: "notApplicable", method: "model" },
  ]);
  assert.equal(result.verdict, "validated");
  assert.equal(result.coverage.requested, requirements.length);
});
