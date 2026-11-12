import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../convex/_generated/dataModel";
import { prepareAnalysisInputs } from "../convex/qaVisual/analysisInput.node";
import type { parseClientMatrix } from "../convex/qaVisual/clientMatrix.node";
import { buildAnalysisFeed } from "../app/lib/qa-visual/analysis-feed";
import { getAiReviewState } from "../app/lib/qa-visual/review-state";
import type { ProductionFields } from "../app/lib/qa-visual/production-csv";

function storyInput({
  format = "STORY", generic = false, rule = true,
  prices = "1.\n2.$5,99", csvPrice = generic ? "" : "5,99",
}: {
  format?: string;
  generic?: boolean;
  rule?: boolean;
  prices?: string;
  csvPrice?: string;
} = {}) {
  const file = {
    name: generic ? "expectativa_generica.png" : "autorapido_octubre_21.png",
    bytes: 1, updatedAt: 1, driveId: "test", driveVersion: "1",
  };
  const production: ProductionFields = {
    product: generic ? "EXPECTATIVA GENERICA" : "PARTE Y COMPARTE 5 PRESAS",
    price: csvPrice, ctaAsset: "", dateAsset: "", campaign: "Semana de Locura",
    phase: "NOTORIEDAD", channel: "OFFLINE", platform: "META", format,
    width: 1080, height: format === "STORY" ? 1920 : 1080,
  };
  const matrix: Awaited<ReturnType<typeof parseClientMatrix>> = {
    name: "matriz.xlsx", hash: "test", bytes: Buffer.alloc(0),
    cells: [
      ...Object.entries({
        A1: "CAMPAÑA", A7: production.campaign, B7: production.phase, C7: production.channel,
        D7: production.platform, E7: format === "STORY" ? "Stories Estática" : "Post Estático",
        G7: "PNG", I7: "1080", J7: String(production.height),
        K7: "1. EXPECTATIVA GENERICA\n2. AUTORAPIDO 21 de Octubre PARTE Y COMPARTE 5 PRESAS", L7: prices,
      }).map(([cell, text]) => ({ sheet: "PRODUCCION" as const, cell, text })),
      ...(rule ? [{ sheet: "REGLAS" as const, cell: "B6", text: "3. Stories sin OFERTA DE VALOR" }] : []),
    ],
  };
  return prepareAnalysisInputs("story-test", {
    matrix: null, csv: null, pieces: [file], notices: [],
    production: { [file.name.slice(0, -4)]: production },
  }, matrix).inputs[0];
}

test("sends Story product, price and date to the model and persists one Excel notice", () => {
  const input = storyInput();
  assert.equal(input.expected.product, "PARTE Y COMPARTE 5 PRESAS");
  assert.equal(input.expected.price, "$5,99");
  assert.equal(input.expected.date, "21 de Octubre");
  assert.ok(input.requirements.every((requirement) => !requirement.pending));
  assert.equal(input.notices.length, 1);
  assert.match(input.notices[0].source, /PRODUCCION!K7 · REGLAS!B6:D6/);
});

test("leaves the generic Story price empty while making its content available for review", () => {
  const input = storyInput({ generic: true });
  assert.equal(input.expected.product, "EXPECTATIVA GENERICA");
  assert.equal(input.expected.price, undefined);
  assert.equal(input.expected.date, undefined);
  assert.equal(input.notices.length, 1);
  assert.ok(!input.requirements.some(({ id }) => id === "price"));
});

test("keeps genuinely ambiguous Story prices pending", () => {
  for (const input of [
    storyInput({ prices: "1.\n2.$5,99\n2.$6,99" }),
    storyInput({ csvPrice: "6,99" }),
  ]) {
    assert.equal(input.expected.price, undefined);
    assert.ok(input.requirements.find(({ id }) => id === "price")?.pending);
    assert.equal(input.expected.product, "PARTE Y COMPARTE 5 PRESAS");
    assert.equal(input.notices.length, 1);
  }
});

test("adds the notice only for a Story with the Excel rule", () => {
  assert.deepEqual(storyInput({ format: "POST" }).notices, []);
  assert.deepEqual(storyInput({ rule: false }).notices, []);
});

test("shows one notice per piece without counting it as a failed AI control", () => {
  const input = storyInput();
  const row = {
    name: input.name, status: "completed" as const, error: undefined, previous: false,
    verdict: "validated" as const, findings: [], resultAt: 1,
    resultId: "test-review" as Id<"qaVisualReviews">,
    notices: [...input.notices, ...input.notices],
  };
  const feed = buildAnalysisFeed([row]);
  assert.equal(feed.comments.length, 1);
  assert.equal(feed.comments[0].role, "Aviso del Excel");
  assert.equal(feed.comments[0].marker, undefined);
  assert.equal(feed.comments[0].severity, undefined);
  const state = getAiReviewState(feed.results[input.name][1], [...feed.comments]);
  assert.equal(state.status, "validated");
  assert.equal(state.findings, 0);
  assert.equal(state.openFindings, 0);
  assert.deepEqual(buildAnalysisFeed([{ ...row, notices: undefined }]).comments, []);
});
