import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { buildRequirements } from "../convex/qaVisual/model/requirements";
import { linkOffer } from "../convex/qaVisual/model/linking";
import {
  productionByPiece,
  type ProductionFields,
} from "../convex/qaVisual/model/productionCsv";
import { reviewResult } from "../convex/qaVisual/model/verdict";
import { compareVisibleValue } from "../convex/qaVisual/model/controls";
import { prepareAnalysisInputs } from "../convex/qaVisual/analysisInput.node";
import { parseClientMatrix } from "../convex/qaVisual/clientMatrix.node";
import type { Requirement } from "../convex/qaVisual/model/contracts";

const production: ProductionFields = {
  product: "FESTIN DE LOCURA",
  price: "8,99",
  ctaAsset: "",
  dateAsset: "HOY",
  campaign: "Semana",
  phase: "NOTORIEDAD",
  channel: "OFFLINE",
  platform: "META",
  format: "POST",
  width: 1080,
  height: 1080,
  csvLine: 17,
};
const matrix = {
  name: "pedido.xlsx",
  hash: "unused",
  bytes: Buffer.alloc(0),
  issues: [],
  cells: Object.entries({
    A1: "CAMPAÑA",
    A6: "Semana",
    B6: "NOTORIEDAD",
    C6: "OFFLINE",
    D6: "META",
    E6: "Post Estático",
    G6: "PNG",
    I6: "1080",
    J6: "1080",
    K6: "1. EXPRESS HOY OTRO PRODUCTO\n7. AUTORAPIDO HOY FESTIN LOCURA",
    L6: "1. $5,99\n7. $8,99",
    P6: "CTA: Descargá la app",
  }).map(([cell, text]) => ({ sheet: "PRODUCCION" as const, cell, text })),
};
const name = "16_AUTORAPIDO_FESTIN_DE_LOCURA_HOY_1080x1080px.png";
const file = {
  name,
  driveId: "image",
  driveVersion: "1",
  contentHash: "same-pixels",
  bytes: 10,
  updatedAt: 1,
};
const inventory = {
  matrix: null,
  csv: null,
  notices: [],
  pieces: [file],
  production: { [name.slice(0, -4).toLowerCase()]: production },
};

test("piece 16 links offer 7 with a single auditable equivalence notice", () => {
  const { requirements, issues } = buildRequirements(matrix, name, production);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "offer_name_equivalence");
  assert.equal(
    requirements.find((r) => r.ruleId === "price")?.expected,
    "$8,99",
  );
  assert.equal(
    requirements.find((r) => r.ruleId === "price")?.sources[0].cell,
    "L6",
  );
  assert.equal(
    requirements.find((r) => r.ruleId === "price")?.sources[0].ordinal,
    "7",
  );
  assert.equal(
    requirements.find((r) => r.ruleId === "product")?.sources[1].csvLine,
    17,
  );
});
test("matching stops on ambiguity and never treats different quantities as equivalent", () => {
  assert.equal(
    linkOffer("1. FESTIN LOCURA\n2. FESTIN DE LA LOCURA", "FESTIN DE LOCURA")
      .offer,
    undefined,
  );
  assert.equal(
    linkOffer("1. COMBO 12 PRESAS", "COMBO 10 PRESAS").offer,
    undefined,
  );
  assert.equal(linkOffer("1. COMBO 12 PRESAS", "COMBO").offer, undefined);
  assert.equal(linkOffer("1. FESTIN POP", "FESTIN P0P").offer, undefined);
});
test("a partial name blocks validation until the matching offer or alias is explicitly confirmed", () => {
  const shortened = { ...production, product: "FESTIN" };
  const before = buildRequirements(matrix, name, shortened);
  const warning = before.issues.find((i) => i.code === "offer_name_partial")!;
  assert.deepEqual(warning.affects, ["product", "price", "date"]);
  assert.deepEqual(
    warning.candidates?.map((c) => [c.row, c.ordinal]),
    [["6", "7"]],
  );
  assert.ok(
    before.requirements
      .find((r) => r.ruleId === "product")
      ?.issueIds.includes(warning.id),
  );
  const controls = before.requirements
    .filter((r) => r.status !== "notRequested")
    .map((r) => ({
      ruleId: r.ruleId,
      outcome: "pass" as const,
      method: ["format", "dimensions"].includes(r.ruleId)
        ? "deterministic"
        : "model",
    }));
  assert.equal(
    reviewResult(before.requirements, controls, before.issues).verdict,
    "partial",
  );
  for (const override of [
    {
      kind: "productAlias" as const,
      from: "FESTIN",
      to: "FESTIN LOCURA",
      author: "Revisora",
      at: 123,
    },
    {
      kind: "offerLink" as const,
      row: "6",
      ordinal: "7",
      pieceKey: name.slice(0, -4).toLowerCase(),
      author: "Revisora",
      at: 123,
    },
  ]) {
    const confirmed = buildRequirements(matrix, name, shortened, [override]);
    assert.equal(
      confirmed.issues.some((i) => i.code === "offer_name_partial"),
      false,
    );
    assert.ok(
      confirmed.issues.some(
        (i) =>
          i.severity === "info" &&
          i.sources.some(
            (s) => s.file === "override" && s.text.includes("Revisora"),
          ),
      ),
    );
    assert.equal(
      reviewResult(confirmed.requirements, controls, confirmed.issues).verdict,
      "validated",
    );
  }
  const revoked = buildRequirements(matrix, name, shortened);
  assert.equal(
    reviewResult(revoked.requirements, controls, revoked.issues).verdict,
    "partial",
  );
});
test("a confirmed partial alias selects its candidate, while conflicting confirmations stay ambiguous", () => {
  const offers = "1. FESTIN LOCURA\n2. FESTIN FAMILIAR";
  const aliases = [
    { kind: "productAlias" as const, from: "FESTIN", to: "FESTIN LOCURA" },
  ];
  assert.equal(linkOffer(offers, "FESTIN").offer, undefined);
  const confirmed = linkOffer(offers, "FESTIN", undefined, undefined, aliases);
  assert.equal(confirmed.method, "alias");
  assert.equal(confirmed.offer?.ordinal, "1");
  assert.equal(
    linkOffer(offers, "FESTIN", undefined, undefined, [
      ...aliases,
      { ...aliases[0], to: "FESTIN FAMILIAR" },
    ]).offer,
    undefined,
  );
});
test("a missing offer affects only its controls, emits one notice, and still evaluates CTA", () => {
  const { requirements, issues } = buildRequirements(matrix, name, {
    ...production,
    product: "INEXISTENTE",
  });
  assert.equal(issues.filter((i) => i.code === "offer_not_found").length, 1);
  for (const id of ["product", "price", "date"])
    assert.equal(
      requirements.find((r) => r.ruleId === id)?.basis,
      "production",
    );
  assert.equal(requirements.find((r) => r.ruleId === "cta")?.status, "ready");
});
test("no CSV or unrecognized CTA is unresolved, not notRequested", () => {
  assert.ok(
    buildRequirements(matrix, name).requirements.every(
      (r) => r.status !== "notRequested",
    ),
  );
  const changed = {
    ...matrix,
    cells: matrix.cells.map((c) =>
      c.cell === "P6" ? { ...c, text: "Invitar a descargar la aplicación" } : c,
    ),
  };
  assert.equal(
    buildRequirements(changed, name, production).requirements.find(
      (r) => r.ruleId === "cta",
    )?.status,
    "unresolved",
  );
});
test("adding or renaming another image and editing another production row does not invalidate a piece", () => {
  const original = prepareAnalysisInputs("campaign", inventory, matrix)
    .inputs[0];
  const next = prepareAnalysisInputs(
    "campaign",
    {
      ...inventory,
      pieces: [file, { ...file, name: "another.png", driveId: "other" }],
      production: {
        ...inventory.production,
        another: { ...production, price: "10" },
      },
    },
    matrix,
  ).inputs[0];
  assert.equal(original.contextKey, next.contextKey);
  assert.notEqual(
    original.contextKey,
    prepareAnalysisInputs(
      "campaign",
      { ...inventory, pieces: [{ ...file, contentHash: "changed" }] },
      matrix,
    ).inputs[0].contextKey,
  );
});
test("CSV preserves physical lines, BOM, semicolon, quoted text, and conflicting duplicate IDs", () => {
  const csv =
    '\uFEFFID_PIEZA;TXT_PRODUCTO;TXT_PRECIO\r\na.png;"FESTIN\nLOCURA";8,99\r\na.png;OTRO;9,99';
  const row = productionByPiece(csv).a;
  assert.equal(row.csvLine, 2);
  assert.equal(row.product, "FESTIN\nLOCURA");
  assert.deepEqual(
    row.duplicates?.map((d) => d.csvLine),
    [2, 4],
  );
});
test("a configured rule without a per-piece reference stays unresolved instead of borrowing the baseline", () => {
  const previousFolder = process.env.QA_VISUAL_GOOGLE_FOLDER_ID;
  const previousRules = process.env.QA_VISUAL_RULES_JSON;
  try {
    process.env.QA_VISUAL_GOOGLE_FOLDER_ID = "configured-campaign";
    process.env.QA_VISUAL_RULES_JSON = JSON.stringify({
      rules: [
        {
          id: "cta",
          criterion: "Verificar CTA aprobado",
          source: "Confirmación del cliente",
          severity: "warning",
          expectedByPiece: { "another.png": "Comprá ahora" },
        },
      ],
    });
    const data = prepareAnalysisInputs("configured-campaign", inventory, matrix)
      .inputs[0];
    const cta = data.requirements.find((r) => r.ruleId === "cta")!;
    assert.equal(cta.status, "unresolved");
    assert.equal(cta.expected, undefined);
    assert.ok(
      data.issues.some(
        (i) =>
          cta.issueIds.includes(i.id) && i.code === "confirmed_value_missing",
      ),
    );
    assert.equal(
      prepareAnalysisInputs(
        "other-campaign",
        inventory,
        matrix,
      ).inputs[0].requirements.find((r) => r.ruleId === "cta")?.status,
      "ready",
    );
  } finally {
    if (previousFolder === undefined)
      delete process.env.QA_VISUAL_GOOGLE_FOLDER_ID;
    else process.env.QA_VISUAL_GOOGLE_FOLDER_ID = previousFolder;
    if (previousRules === undefined) delete process.env.QA_VISUAL_RULES_JSON;
    else process.env.QA_VISUAL_RULES_JSON = previousRules;
  }
});
const req = (
  ruleId: string,
  other: Partial<Requirement> = {},
): Requirement => ({
  ruleId,
  status: "ready",
  basis: "client",
  expected: "value",
  sources: [],
  issueIds: [],
  ...other,
});
test("validation requires complete coverage, visual evidence, client basis, and no source conflict", () => {
  const requirements = [
    req("format"),
    req("product"),
    req("cta", { status: "notRequested" }),
  ];
  const findings = [
    { ruleId: "format", outcome: "pass" as const, method: "deterministic" },
    { ruleId: "product", outcome: "pass" as const, method: "model" },
  ];
  assert.equal(reviewResult(requirements, findings).verdict, "validated");
  for (const altered of [
    requirements.map((r) =>
      r.ruleId === "product" ? { ...r, status: "conflict" as const } : r,
    ),
    requirements.map((r) => ({ ...r, basis: "production" as const })),
  ])
    assert.equal(reviewResult(altered, findings).verdict, "partial");
  assert.equal(reviewResult([req("format")], [findings[0]]).verdict, "partial");
  assert.equal(
    reviewResult(requirements, [findings[0]]).coverage.unverifiable,
    1,
  );
  assert.equal(
    reviewResult(requirements, [...findings, findings[1]]).verdict,
    "partial",
  );
  assert.equal(
    reviewResult(requirements, [{ ...findings[1], outcome: "fail" }]).verdict,
    "findings",
  );
  assert.equal(reviewResult([], []).verdict, "partial");
});
test("code compares prices exactly and does not equate HOY with a concrete date", () => {
  assert.equal(
    compareVisibleValue(req("price", { expected: "$8,99" }), "8.99")?.outcome,
    "pass",
  );
  assert.equal(
    compareVisibleValue(
      req("price", { expected: "$8,99", expectedAlternatives: ["9,99"] }),
      "$9,99",
    )?.outcome,
    "fail",
  );
  assert.equal(
    compareVisibleValue(req("price", { expected: "$8,99" }), "8 o 9"),
    undefined,
  );
  assert.equal(
    compareVisibleValue(req("date", { expected: "22 de octubre" }), "HOY")
      ?.outcome,
    "fail",
  );
  assert.equal(
    compareVisibleValue(req("date", { expected: "22 de octubre" }), "JUEVES 22")
      ?.outcome,
    "fail",
  );
});
test("workbook propagates merged cells, interprets serial dates, and reports formulas without a value", async () => {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PRODUCCION" r:id="r1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    "xl/styles.xml",
    '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>CAMPAÑA</t></is></c><c r="A6" t="inlineStr"><is><t>Semana</t></is></c><c r="B6" s="1"><v>45952</v></c><c r="P6"><f>CONCAT(A6)</f></c></row></sheetData><mergeCells><mergeCell ref="A6:A7"/></mergeCells></worksheet>',
  );
  const result = await parseClientMatrix(
    "pedido.xlsx",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(result.cells.find((c) => c.cell === "A7")?.text, "Semana");
  assert.match(
    result.cells.find((c) => c.cell === "B6")?.text ?? "",
    /de octubre/,
  );
  assert.equal(
    result.issues.filter((i) => i.code === "formula_without_value").length,
    1,
  );
});

test("manual offer selection overrides automatic matching and aliases require confirmation", () => {
  const linked = linkOffer(
    "1. FESTIN POP",
    "FESTIN P0P",
    undefined,
    undefined,
    [{ kind: "productAlias", from: "FESTIN P0P", to: "FESTIN POP" }],
  );
  assert.equal(linked.method, "alias");
  const data = buildRequirements(matrix, name, production, [
    { kind: "offerLink", row: "6", ordinal: "1" },
  ]);
  assert.equal(
    data.requirements.find((r) => r.ruleId === "product")?.expected,
    "OTRO PRODUCTO",
  );
  assert.ok(data.issues.some((i) => i.code === "offer_manual"));
});
