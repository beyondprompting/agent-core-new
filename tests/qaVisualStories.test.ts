import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../convex/_generated/dataModel";
import { prepareAnalysisInputs } from "../convex/qaVisual/analysisInput.node";
import type { parseClientMatrix } from "../convex/qaVisual/clientMatrix.node";
import { buildAnalysisFeed } from "../app/lib/qa-visual/analysis-feed";
import { getAiReviewState } from "../app/lib/qa-visual/review-state";
import type { ProductionFields } from "../app/lib/qa-visual/production-csv";

function storyInput({
  format = "STORY",
  generic = false,
  rule = true,
  prices = "1.\n2.$5,99",
  csvPrice = generic ? "" : "5,99",
}: {
  format?: string;
  generic?: boolean;
  rule?: boolean;
  prices?: string;
  csvPrice?: string;
} = {}) {
  const file = {
    name: generic ? "expectativa_generica.png" : "autorapido_octubre_21.png",
    bytes: 1,
    updatedAt: 1,
    driveId: "test",
    driveVersion: "1",
  };
  const production: ProductionFields = {
    product: generic ? "EXPECTATIVA GENERICA" : "PARTE Y COMPARTE 5 PRESAS",
    price: csvPrice,
    ctaAsset: "",
    dateAsset: "",
    campaign: "Semana de Locura",
    phase: "NOTORIEDAD",
    channel: "OFFLINE",
    platform: "META",
    format,
    width: 1080,
    height: format === "STORY" ? 1920 : 1080,
  };
  const matrix: Awaited<ReturnType<typeof parseClientMatrix>> = {
    name: "matriz.xlsx",
    hash: "test",
    bytes: Buffer.alloc(0),
    issues: [],
    cells: [
      ...Object.entries({
        A1: "CAMPAÑA",
        A7: production.campaign,
        B7: production.phase,
        C7: production.channel,
        D7: production.platform,
        E7: format === "STORY" ? "Stories Estática" : "Post Estático",
        G7: "PNG",
        I7: "1080",
        J7: String(production.height),
        K7: "1. EXPECTATIVA GENERICA\n2. AUTORAPIDO 21 de Octubre PARTE Y COMPARTE 5 PRESAS",
        L7: prices,
      }).map(([cell, text]) => ({ sheet: "PRODUCCION" as const, cell, text })),
      ...(rule
        ? [
            {
              sheet: "REGLAS" as const,
              cell: "B6",
              text: "3. Stories sin OFERTA DE VALOR",
            },
          ]
        : []),
    ],
  };
  return prepareAnalysisInputs(
    "story-test",
    {
      matrix: null,
      csv: null,
      pieces: [file],
      notices: [],
      production: { [file.name.slice(0, -4)]: production },
    },
    matrix,
  ).inputs[0];
}

test("analyzes Story content and records one source notice without blocking", () => {
  const input = storyInput();
  const expected = Object.fromEntries(
    input.requirements.map((r) => [r.ruleId, r.expected]),
  );
  assert.equal(expected.product, "PARTE Y COMPARTE 5 PRESAS");
  assert.equal(expected.price, "$5,99");
  assert.equal(expected.date, "21 DE OCTUBRE");
  assert.equal(
    input.issues.filter((i) => i.code === "stories_offer_filled").length,
    1,
  );
  assert.ok(
    input.requirements.every((r) =>
      ["ready", "notRequested"].includes(r.status),
    ),
  );
});
test("generic Story content does not request a price or date", () => {
  const input = storyInput({ generic: true });
  for (const ruleId of ["price", "date"])
    assert.equal(
      input.requirements.find((r) => r.ruleId === ruleId)?.status,
      "notRequested",
    );
});
test("source conflicts and duplicate prices stay explicit on Stories", () => {
  assert.equal(
    storyInput({ prices: "1.\n2.$5,99\n2.$6,99" }).requirements.find(
      (r) => r.ruleId === "price",
    )?.status,
    "invalid",
  );
  assert.equal(
    storyInput({ csvPrice: "6,99" }).requirements.find(
      (r) => r.ruleId === "price",
    )?.status,
    "conflict",
  );
});
test("adds the Story source notice only when the rule applies", () => {
  assert.deepEqual(storyInput({ format: "POST" }).issues, []);
  assert.deepEqual(storyInput({ rule: false }).issues, []);
});
test("source notices have no visual marker and do not count as failed AI controls", () => {
  const input = storyInput();
  const row = {
    name: input.name,
    status: "completed",
    verdict: "validated" as const,
    findings: [],
    resultAt: 1,
    resultId: "review" as Id<"qaVisualReviews">,
    issues: [...input.issues, ...input.issues],
  };
  const feed = buildAnalysisFeed([row]);
  assert.equal(feed.comments.length, 1);
  assert.equal(feed.comments[0].kind, "source");
  assert.equal(feed.comments[0].marker, undefined);
  assert.equal(
    getAiReviewState(feed.results[input.name][1], [...feed.comments]).findings,
    0,
  );
});
