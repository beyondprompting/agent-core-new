import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAnalysisInputs } from "../convex/qaVisual/analysisInput.node";
import type { parseClientMatrix } from "../convex/qaVisual/clientMatrix.node";
import type { ProductionFields } from "../app/lib/qa-visual/production-csv";

function reviewPrice({
  offers = "1. EXPECTATIVA GENERICA\n2. AUTORAPIDO 21 de Octubre PARTE Y COMPARTE 5 PRESAS",
  prices,
  csvPrice,
  generic = false,
}: { offers?: string; prices: string; csvPrice: string; generic?: boolean }) {
  const file = {
    name: generic ? "expectativa_generica.png" : "autorapido_octubre_21.png",
    bytes: 1, updatedAt: 1, driveId: "test", driveVersion: "1",
  };
  const production: ProductionFields = {
    product: generic ? "EXPECTATIVA GENERICA" : "PARTE Y COMPARTE 5 PRESAS",
    price: csvPrice, ctaAsset: "", dateAsset: "", campaign: "Semana de Locura",
    phase: "NOTORIEDAD", channel: "OFFLINE", platform: "META", format: "POST",
    width: 1080, height: 1080,
  };
  const matrix: Awaited<ReturnType<typeof parseClientMatrix>> = {
    name: "matriz.xlsx", hash: "test", bytes: Buffer.alloc(0),
    cells: Object.entries({
      A1: "CAMPAÑA", A7: production.campaign, B7: production.phase, C7: production.channel,
      D7: production.platform, E7: "Post Estático", G7: "PNG", K7: offers, L7: prices,
    }).map(([cell, text]) => ({ sheet: "PRODUCCION", cell, text })),
  };
  const { inputs: [input] } = prepareAnalysisInputs("test-folder", {
    matrix: null, csv: null, pieces: [file], notices: [],
    production: { [file.name.slice(0, -4)]: production },
  }, matrix);
  return {
    expected: input.expected.price,
    requirement: input.requirements.find(({ id }) => id === "price"),
  };
}

test("keeps an empty price on its own line and pairs $5,99 with offer 2", () => {
  const prices = "1. \r\n2.$5,99";
  assert.deepEqual(reviewPrice({ prices, csvPrice: "", generic: true }), {
    expected: undefined, requirement: undefined,
  });
  assert.deepEqual(reviewPrice({ prices, csvPrice: "5.99" }), {
    expected: "$5,99",
    requirement: { id: "price", expected: "$5,99", source: "PRODUCCION!L7 · Precio n.º 2" },
  });
  assert.equal(reviewPrice({ prices: "2.$5,99\n1.", csvPrice: "5,99" }).expected, "$5,99");
});

test("withholds a price when the numbered offer or price is ambiguous", () => {
  for (const result of [
    reviewPrice({ prices: "1.\n2.$5,99\n02.$6,99", csvPrice: "5,99" }),
    reviewPrice({
      offers: "2. PARTE Y COMPARTE 5 PRESAS\n2. FESTIN POP",
      prices: "2.$5,99", csvPrice: "5,99",
    }),
    reviewPrice({ prices: "1.\n$5,99", csvPrice: "5,99" }),
    reviewPrice({ prices: "1.\n2.$5,99 o $6,99", csvPrice: "5,99" }),
    reviewPrice({ prices: "1.\n2.", csvPrice: "5,99" }),
  ]) {
    assert.equal(result.expected, undefined);
    assert.ok(result.requirement?.pending);
  }
});

test("withholds a price when the production CSV contradicts the Excel", () => {
  const result = reviewPrice({ prices: "1.\n2.$5,99", csvPrice: "6,99" });
  assert.equal(result.expected, undefined);
  assert.match(result.requirement?.pending ?? "", /Excel indica \$5,99 y el CSV indica 6,99/);
});
