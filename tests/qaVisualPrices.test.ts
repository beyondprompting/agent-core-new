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
}: {
  offers?: string;
  prices: string;
  csvPrice: string;
  generic?: boolean;
}) {
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
    format: "POST",
    width: 1080,
    height: 1080,
  };
  const matrix: Awaited<ReturnType<typeof parseClientMatrix>> = {
    name: "matriz.xlsx",
    hash: "test",
    bytes: Buffer.alloc(0),
    issues: [],
    cells: Object.entries({
      A1: "CAMPAÑA",
      A7: production.campaign,
      B7: production.phase,
      C7: production.channel,
      D7: production.platform,
      E7: "Post Estático",
      G7: "PNG",
      K7: offers,
      L7: prices,
    }).map(([cell, text]) => ({ sheet: "PRODUCCION", cell, text })),
  };
  const {
    inputs: [input],
  } = prepareAnalysisInputs(
    "test-folder",
    {
      matrix: null,
      csv: null,
      pieces: [file],
      notices: [],
      production: { [file.name.slice(0, -4)]: production },
    },
    matrix,
  );
  return input.requirements.find((r) => r.ruleId === "price")!;
}

test("keeps an empty price on its own line and pairs $5,99 with offer 2", () => {
  const prices = "1. \r\n2.$5,99";
  assert.equal(
    reviewPrice({ prices, csvPrice: "", generic: true }).status,
    "notRequested",
  );
  const price = reviewPrice({ prices, csvPrice: "5.99" });
  assert.equal(price.expected, "$5,99");
  assert.equal(price.status, "ready");
  assert.equal(price.sources[0].cell, "L7");
  assert.equal(price.sources[0].ordinal, "2");
  assert.equal(
    reviewPrice({ prices: "2.$5,99\n1.", csvPrice: "5,99" }).expected,
    "$5,99",
  );
});

test("marks ambiguous or missing Excel prices explicitly and keeps the production basis visible", () => {
  for (const result of [
    reviewPrice({ prices: "1.\n2.$5,99\n02.$6,99", csvPrice: "5,99" }),
    reviewPrice({
      offers: "2. PARTE Y COMPARTE 5 PRESAS\n2. FESTIN POP",
      prices: "2.$5,99",
      csvPrice: "5,99",
    }),
    reviewPrice({ prices: "1.\n$5,99", csvPrice: "5,99" }),
    reviewPrice({ prices: "1.\n2.$5,99 o $6,99", csvPrice: "5,99" }),
    reviewPrice({ prices: "1.\n2.", csvPrice: "5,99" }),
  ]) {
    assert.ok(["invalid", "missing"].includes(result.status));
    assert.equal(result.basis, "production");
    assert.equal(result.expected, "5,99");
    assert.ok(result.issueIds.length);
  }
});

test("retains both values when the CSV contradicts the client price", () => {
  const result = reviewPrice({ prices: "1.\n2.$5,99", csvPrice: "6,99" });
  assert.equal(result.status, "conflict");
  assert.equal(result.basis, "client");
  assert.equal(result.expected, "$5,99");
  assert.deepEqual(result.expectedAlternatives, ["6,99"]);
});
