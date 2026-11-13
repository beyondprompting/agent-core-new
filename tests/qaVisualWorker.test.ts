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
].map((control) => ({
  ...control,
  evidenceStatus: "readable",
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
