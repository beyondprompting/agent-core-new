import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import JSZip from "jszip";
import type { DriveFile } from "../convex/qaVisual/driveClient";
import { folderMime } from "../convex/qaVisual/driveClient";
import {
  decodeCsv,
  encodeCsv,
  inspectDriveFolder,
} from "../convex/qaVisual/driveSource.node";
import {
  applyCsvFix,
  checkCsvFix,
  checkEquivalences,
  reviewMapping,
} from "../convex/qaVisual/csvRepair.node";
import {
  applyCsvEdits,
  csvRows,
  mappingLocked,
  mappingReport,
  pieceMappingStatus,
  verifyCsvEdits,
  valueOf,
  verifyEquivalences,
  type EditRef,
} from "../convex/qaVisual/model/mapping";

/** Convex rejects non-ASCII field names, and the CSV columns are Spanish words («CAMPAÑA»). */
function assertConvexKeys(value: unknown, path = "report") {
  if (Array.isArray(value))
    value.forEach((item, i) => assertConvexKeys(item, `${path}[${i}]`));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      assert.match(
        key,
        /^[\x20-\x7e]+$/,
        `${path}.${key} is not a Convex field name`,
      );
      assertConvexKeys(item, `${path}.${key}`);
    }
}
import type { LinkOverride } from "../convex/qaVisual/model/contracts";
import {
  csvTable,
  productionByPiece,
} from "../convex/qaVisual/model/productionCsv";
import { buildRequirements } from "../convex/qaVisual/model/requirements";
import { pieceKey } from "../convex/qaVisual/model/normalize";

// A matrix in the newer template: the date of each order has its own column (FECHA, O) and the
// same order is repeated once per date.
const cells: Record<string, string> = {
  A5: "CAMPAÑA",
  B5: "FASE",
  C5: "CANAL",
  D5: "MEDIO",
  E5: "PIEZA",
  G5: "FORMATO",
  I5: "ANCHO_PX",
  J5: "ALTO_PX",
  K5: "OFERTA DE VALOR",
  L5: "PVP",
  O5: "FECHA",
  P5: "COPY",
};
const order = (row: number, piece: string, h: number, date: string) => {
  Object.assign(cells, {
    [`A${row}`]: "OFFLINE_45",
    [`B${row}`]: "NOTORIEDAD",
    [`C${row}`]: "AUTORAPIDO",
    [`D${row}`]: "META",
    [`E${row}`]: piece,
    [`G${row}`]: "JPG/PNG",
    [`I${row}`]: "1080",
    [`J${row}`]: String(h),
    [`K${row}`]: "1. PARTE Y COMPARTE 5 PRESAS\n2. 8 PRESAS + 1 PAPA",
    [`L${row}`]: "1. $5,99\n2. $9,99",
    [`O${row}`]: date,
  });
};
order(6, "Post Estático", 1080, "Miércoles 25");
order(7, "Post Estático", 1080, "HOY");
order(8, "Stories Estática", 1920, "HOY");
const matrix = {
  name: "MATRIZ.xlsx",
  cells: Object.entries(cells).map(([cell, text]) => ({
    sheet: "PRODUCCION",
    cell,
    text,
  })),
};

const header =
  "CAMPAÑA,ID_PIEZA,FASE,CANAL,MEDIO_PLATAFORMA,FORMATO_TIPO,ANCHO_PX,ALTO_PX,SLOT_FECHA,TXT_PRODUCTO,TXT_PRECIO";
const row = (
  id: string,
  format: string,
  h: number,
  date: string,
  product: string,
  price: string,
) =>
  `OFFLINE_45,${id},NOTORIEDAD,AUTORAPIDO,META,${format},1080,${h},${date},${product},"${price}"`;
// The agency names the rows with words the files do not have (ESTATICO, no OFFLINE_ prefix)
// and writes the format as «POST» while the matrix says «Post Estático».
const POST = "M_AUTORAPIDO_META_POST_ESTATICO_5_PRESAS_1080X1080px";
const STORY = "M_AUTORAPIDO_META_STORIES_ESTATICA_5_PRESAS_1080X1920px";
const EIGHT = "M_AUTORAPIDO_META_POST_ESTATICO_8_PRESAS_1_PAPA_1080X1080px";
const csv =
  "﻿" +
  [
    header,
    row(
      POST,
      "POST",
      1080,
      "FECHAS_MIERCOLES25.ai",
      "PARTE Y COMPARTE 5 PRESAS",
      "5,99",
    ),
    row(
      POST,
      "POST",
      1080,
      "FECHAS_HOY.ai",
      "PARTE Y COMPARTE 5 PRESAS",
      "5,99",
    ),
    row(
      STORY,
      "STORY",
      1920,
      "FECHAS_HOY.ai",
      "PARTE Y COMPARTE 5 PRESAS",
      "5,99",
    ),
    row(EIGHT, "POST", 1080, "FECHAS_HOY.ai", "8 PRESAS + 1 PAPA", "9,99"),
  ].join("\r\n") +
  "\r\n";
const images = [
  {
    name: "OFFLINE_M_AUTORAPIDO_META_POST_5_PRESAS_1080X1080px.png",
    width: 1080,
    height: 1080,
  },
  {
    name: "OFFLINE_M_AUTORAPIDO_META_POST_5_PRESAS_1080X1080px_HOY.png",
    width: 1080,
    height: 1080,
  },
  {
    name: "OFFLINE_M_AUTORAPIDO_META_STORIES_5_PRESAS_1080X1920px.png",
    width: 1080,
    height: 1920,
  },
  {
    name: "OFFLINE_M_AUTORAPIDO_META_POST_8_PRESAS_1080X1080px.png",
    width: 1080,
    height: 1080,
  },
  { name: "logo_96.png", width: 96, height: 96 },
];
const stem = (name: string) => name.replace(/\.[^.]+$/, "");
/** The four ID changes that give each piece its own row. */
const idEdits: EditRef[] = [
  { csvLine: 2, column: "ID_PIEZA", from: POST, to: stem(images[0].name) },
  { csvLine: 3, column: "ID_PIEZA", from: POST, to: stem(images[1].name) },
  { csvLine: 4, column: "ID_PIEZA", from: STORY, to: stem(images[2].name) },
  { csvLine: 5, column: "ID_PIEZA", from: EIGHT, to: stem(images[3].name) },
];
const withIds = () => {
  const applied = applyCsvEdits(csv, idEdits, images, matrix);
  assert.ok(applied.ok);
  return applied.text;
};
const postEquivalence: LinkOverride = {
  kind: "matrixEquivalence",
  column: "FORMATO_TIPO",
  from: "POST",
  to: "Post Estático",
};
const postValues = {
  column: "FORMATO_TIPO" as const,
  csvValue: "POST",
  matrixValue: "Post Estático",
};

test("the matrix row is chosen by its date and size when an order repeats", () => {
  const production = {
    ...productionByPiece(csv)[pieceKey(POST)],
    // The CSV says what the matrix says.
    format: "POST ESTÁTICO",
    duplicates: undefined,
  };
  const today = buildRequirements(matrix, `${POST}_HOY.png`, {
    ...production,
    dateAsset: "FECHAS_HOY.ai",
  });
  assert.ok(
    today.issues.some(
      (i) => i.code === "excel_row_by_date" && /fila 7/.test(i.message),
    ),
  );
  assert.ok(
    !today.issues.some((i) => /excel_row_(missing|ambiguous)/.test(i.code)),
  );
  const date = today.requirements.find((r) => r.ruleId === "date")!;
  assert.equal(date.status, "ready");
  assert.equal(date.expected, "HOY");
  assert.equal(date.sources[0].cell, "O7");

  const wednesday = buildRequirements(matrix, `${POST}.png`, production);
  assert.equal(
    wednesday.requirements.find((r) => r.ruleId === "date")!.expected,
    "Miércoles 25",
  );
  // Without a date that tells them apart the order stays ambiguous.
  const unknown = buildRequirements(matrix, `${POST}.png`, {
    ...production,
    dateAsset: "",
  });
  assert.ok(unknown.issues.some((i) => i.code === "excel_row_ambiguous"));
});

test("names are compared exactly: there are no hidden rules for words or prefixes", () => {
  const report = mappingReport({ images, csvText: csv, matrix });
  assert.equal(report.total, 5);
  assert.equal(report.linked, 0);
  assert.deepEqual(
    report.groups.map((g) => [g.code, g.pieces.length]),
    [["csv_missing", 5]],
  );
  assert.ok(report.problems.every((p) => p.status === "csv_missing"));
  assert.deepEqual(
    [report.problems[0].width, report.problems[0].height],
    [1080, 1080],
  );
  // Every row is free to be chosen in the panel.
  assert.deepEqual(
    report.freeRows.map((r) => r.csvLine),
    [2, 3, 4, 5],
  );
  assert.equal(
    valueOf(report.freeRows[0].values, "SLOT_FECHA"),
    "FECHAS_MIERCOLES25.ai",
  );
  assertConvexKeys(report);
  assert.equal(report.orphanRows.length, 4);
  assert.equal("proposals" in report, false);
  assert.equal("hints" in report, false);

  // Case and surrounding spaces do not matter; any other difference does.
  const upper = csv.replace(EIGHT, ` ${stem(images[3].name).toUpperCase()} `);
  const linked = mappingReport({ images, csvText: upper, matrix });
  assert.equal(
    linked.problems.find((p) => p.piece === images[3].name)?.status,
    "matrix_missing",
  );

  const excluded = mappingReport({
    images,
    csvText: csv,
    matrix,
    excluded: new Set([pieceKey("logo_96.png")]),
  });
  assert.equal(excluded.excluded, 1);
  assert.deepEqual(excluded.excludedPieces, ["logo_96.png"]);
  assert.equal(excluded.unmapped, 4);
});

test("a value written differently in the CSV and the matrix is shown with the closest orders", () => {
  const text = withIds();
  const report = mappingReport({ images, csvText: text, matrix });
  assert.deepEqual(
    report.groups.map((g) => [g.code, g.pieces.length]),
    [
      ["csv_missing", 1],
      ["matrix_missing", 4],
    ],
  );
  const post = report.problems.find((p) => p.piece === images[0].name)!;
  assert.deepEqual(post.csvLines, [2]);
  assert.equal(valueOf(post.csv, "FORMATO_TIPO"), "POST");
  assert.equal(
    valueOf(post.candidates?.[0].values, "CAMPAÑA"),
    valueOf(post.csv, "CAMPAÑA"),
  );
  assertConvexKeys(report);
  assert.equal(post.candidates?.[0].row, "6");
  assert.deepEqual(post.candidates?.[0].differences, [postValues]);
  const story = report.problems.find((p) => p.piece === images[2].name)!;
  assert.equal(story.candidates?.[0].row, "8", "the size breaks the tie");
  assert.equal(story.candidates?.[0].date, "HOY");

  // An approved equivalence links the posts without touching the CSV.
  const approved = mappingReport({
    images,
    csvText: text,
    matrix,
    overrides: [postEquivalence],
  });
  assert.equal(approved.linked, 3);
  assert.deepEqual(
    approved.groups.map((g) => [g.code, g.pieces]),
    [
      ["csv_missing", ["logo_96.png"]],
      ["matrix_missing", [images[2].name]],
    ],
  );
});

test("an equivalence is approved only when the piece links to the chosen order", () => {
  const text = withIds();
  const base = { text, images, matrix };
  assert.deepEqual(
    verifyEquivalences({
      ...base,
      piece: images[0].name,
      order: "6",
      equivalences: [postValues],
    }),
    { ok: true },
  );
  // The row of this piece is for Wednesday 25: it would not link to the order of today.
  const other = verifyEquivalences({
    ...base,
    piece: images[0].name,
    order: "7",
    equivalences: [postValues],
  });
  assert.equal(other.ok, false);
  assert.match(!other.ok ? other.errors[0] : "", /fila 6, no al elegido/);
  // «STORY» = «Post Estático» would link the story to a post of another size.
  const wrong = verifyEquivalences({
    ...base,
    piece: images[2].name,
    order: "7",
    equivalences: [
      {
        column: "FORMATO_TIPO",
        csvValue: "STORY",
        matrixValue: "Post Estático",
      },
    ],
  });
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.errors[0] : "", /1080 × 1080.*1080 × 1920/);
  // A change must not take a linked piece away from its own row: a new row with its ID
  // makes it repeated.
  const extra = `${text}${row("SOBRA", "POST", 1080, "FECHAS_LUNES.ai", "OTRO", "1,00")}\r\n`;
  const repeated = verifyCsvEdits({
    text: extra,
    edits: [
      {
        csvLine: 6,
        column: "ID_PIEZA",
        from: "SOBRA",
        to: stem(images[0].name),
      },
    ],
    images,
    matrix,
    overrides: [postEquivalence],
  });
  assert.equal(repeated.ok, false);
  assert.match(
    !repeated.ok ? repeated.errors.join(" ") : "",
    /estaba vinculada y quedaría con el ID repetido/,
  );
});

test("identity cells take exactly the value of the chosen order and nothing else changes", () => {
  const text = withIds();
  const story: EditRef = {
    csvLine: 4,
    column: "FORMATO_TIPO",
    from: "STORY",
    to: "Stories Estática",
    order: "8",
    piece: images[2].name,
  };
  const verified = verifyCsvEdits({ text, edits: [story], images, matrix });
  assert.ok(verified.ok);
  if (!verified.ok) return;
  assert.deepEqual(verified.warnings, []);
  const before = text.split("\r\n"),
    after = verified.text.split("\r\n");
  before.forEach((line, i) =>
    assert.equal(
      after[i],
      i === 3 ? line.replace(",STORY,", ",Stories Estática,") : line,
    ),
  );
  const fixed = mappingReport({ images, csvText: verified.text, matrix });
  assert.equal(
    fixed.problems.some((p) => p.piece === images[2].name),
    false,
  );

  const refused = (edit: EditRef) => {
    const result = verifyCsvEdits({ text, edits: [edit], images, matrix });
    assert.equal(result.ok, false);
    return result.ok ? "" : result.errors.join(" ");
  };
  assert.match(
    refused({ ...story, to: "Stories" }),
    /no es el valor del pedido/,
  );
  assert.match(refused({ ...story, order: undefined }), /no indica un pedido/);
  assert.match(
    refused({ ...story, column: "TXT_PRECIO" as never, from: "5,99" }),
    /no se puede modificar/,
  );
  assert.match(
    refused({ ...story, from: "OTRO" }),
    /cambió desde la propuesta/,
  );
  // Copying a post order into the story: it links, but not to the order chosen.
  assert.match(
    refused({ ...story, to: "Post Estático", order: "6" }),
    /fila 7, no al elegido \(fila 6\)/,
  );
});

test("ID_PIEZA changes keep every other byte and are checked for coherence", () => {
  const applied = applyCsvEdits(csv, idEdits, images, matrix);
  assert.ok(applied.ok);
  if (!applied.ok) return;
  assert.ok(applied.text.startsWith("﻿"));
  const before = csv.split("\r\n"),
    after = applied.text.split("\r\n");
  assert.equal(after.length, before.length);
  before.forEach((line, i) => {
    const a = line.split(","),
      b = after[i].split(",");
    assert.deepEqual(
      [...a.slice(0, 1), ...a.slice(2)],
      [...b.slice(0, 1), ...b.slice(2)],
    );
  });

  // A right row whose order still differs: accepted, the matrix is the next step.
  const eight = verifyCsvEdits({
    text: csv,
    edits: [idEdits[3]],
    images,
    matrix,
  });
  assert.ok(eight.ok);
  assert.deepEqual(eight.ok && eight.warnings, []);
  assert.match(eight.ok ? eight.next[0] : "", /sin pedido en la matriz/);
  // The 5-piece file on the row of 8 pieces: the number tells it is suspicious.
  const swapped = verifyCsvEdits({
    text: csv,
    edits: [{ ...idEdits[3], to: stem(images[0].name) }],
    images,
    matrix,
  });
  assert.ok(swapped.ok);
  assert.match(swapped.ok ? swapped.warnings[0] : "", /«5»/);

  const refused = (edits: EditRef[], text = csv) => {
    const result = applyCsvEdits(text, edits, images, matrix);
    assert.equal(result.ok, false);
    return result.ok ? "" : result.errors.join(" ");
  };
  assert.match(
    refused([{ ...idEdits[0], to: "no_es_una_pieza" }]),
    /no es el nombre/,
  );
  assert.match(refused([{ ...idEdits[0], from: "otro" }]), /cambió/);
  assert.match(
    refused([idEdits[0], { ...idEdits[1], to: idEdits[0].to }]),
    /más de una fila/,
  );
  assert.match(refused([{ ...idEdits[0], csvLine: 99 }]), /no existe/);
  // A row already linked to a piece cannot be taken away from it.
  const linked = csv.replace(STORY, "logo_96");
  assert.match(
    refused(
      [{ csvLine: 4, column: "ID_PIEZA", from: "logo_96", to: idEdits[2].to }],
      linked,
    ),
    /ya está vinculada/,
  );
  assert.equal(csvRows(csv).length, 4);
});

test("quoted, multiline and semicolon CSVs keep their format", () => {
  const text = 'ID_PIEZA;NOTA\r\n"vieja";"línea 1\nlínea 2"\r\nOTRA;x;y\r\n';
  const [, first] = csvTable(text).records;
  assert.equal(first.fields[1].value, "línea 1\nlínea 2");
  const result = applyCsvEdits(
    text,
    [{ csvLine: 2, column: "ID_PIEZA", from: "vieja", to: "nueva; pieza" }],
    [{ name: "nueva; pieza.png" }],
  );
  assert.ok(result.ok);
  assert.equal(
    result.ok && result.text,
    'ID_PIEZA;NOTA\r\n"nueva; pieza";"línea 1\nlínea 2"\r\nOTRA;x;y\r\n',
  );
});

test("Windows-1252 CSVs are written back in the same encoding", () => {
  const bytes = Buffer.from([
    0x49, 0x44, 0x0d, 0x0a, 0x43, 0x41, 0x4d, 0x50, 0x41, 0xd1, 0x41, 0x80,
  ]);
  const decoded = decodeCsv(bytes);
  assert.equal(decoded.encoding, "windows-1252");
  assert.match(decoded.text, /^ID\r\nCAMPAÑA/);
  assert.deepEqual(encodeCsv(decoded.text, decoded.encoding), bytes);
  assert.throws(() => encodeCsv("日本", "windows-1252"), /Windows-1252/);
  const bom = Buffer.from("﻿ID\r\n", "utf8");
  assert.deepEqual(encodeCsv(decodeCsv(bom).text, "utf-8"), bom);
});

test("the editor locks only new campaigns with unlinked pieces", () => {
  assert.equal(pieceMappingStatus([]), "linked");
  assert.equal(
    pieceMappingStatus([{ code: "csv_row_missing", affects: [] }]),
    "csv_missing",
  );
  assert.equal(
    pieceMappingStatus([{ code: "csv_duplicate_id", affects: [] }]),
    "linked",
    "an identical repeated row is harmless",
  );
  assert.equal(
    pieceMappingStatus([
      { code: "csv_row_missing", affects: [] },
      { code: "piece_excluded", affects: [] },
    ]),
    "excluded",
  );
  assert.equal(mappingLocked({ mappingCheck: { unmapped: 2 } }), true);
  assert.equal(
    mappingLocked({ mappingCheck: { unmapped: 2 }, mappingCompletedAt: 1 }),
    false,
  );
  assert.equal(mappingLocked({}), false);
});

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs8", format: "pem" });
const folder = (id: string, name: string): DriveFile => ({
  id,
  name,
  mimeType: folderMime,
  capabilities: { canListChildren: true, canAddChildren: true },
});
const url = "https://drive.google.com/drive/folders/root";
const context = (overrides: LinkOverride[] = []) => ({
  url,
  selection: {},
  excluded: new Set<string>(),
  overrides,
});

async function workbook() {
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
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>${Object.entries(cells)
      .map(
        ([r, value]) =>
          `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`,
      )
      .join("")}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A campaign folder with RECURSOS, EDITABLES and DESPLIEGUE, and a mocked Gemini Neon. */
async function drive(t: TestContext, answers: unknown[] = []) {
  const previous = {
    account: process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON,
    key: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };
  process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "qa@example.test",
    private_key: privateKey,
  });
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-only";
  t.after(() => {
    for (const [key, value] of [
      ["QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON", previous.account],
      ["GOOGLE_GENERATIVE_AI_API_KEY", previous.key],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const excelBytes = await workbook();
  const state = { csv: Buffer.from(csv, "utf8"), version: 1 };
  const csvFile = (): DriveFile => ({
    id: "csv",
    name: "PEDIDO_CONVERTED.csv",
    mimeType: "text/csv",
    version: String(state.version),
    size: String(state.csv.length),
    capabilities: { canEdit: true },
  });
  const excel: DriveFile = {
    id: "excel",
    name: "MATRIZ.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    version: "1",
    size: String(excelBytes.length),
  };
  const listings = (): Record<string, DriveFile[]> => ({
    root: [
      folder("r", "RECURSOS"),
      folder("e", "EDITABLES"),
      folder("d", "DESPLIEGUE"),
    ],
    r: [excel],
    e: [csvFile()],
    d: images.map((image, i) => ({
      id: `image-${i}`,
      name: image.name,
      mimeType: "image/png",
      version: "1",
      md5Checksum: `hash-${i}`,
      size: "10",
      imageMediaMetadata: { width: image.width, height: image.height },
    })),
  });
  const calls = {
    model: [] as { url: string; body: string }[],
    writes: [] as Buffer[],
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL, init?: RequestInit) => {
      const request = new URL(String(input));
      if (request.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "test-only", expires_in: 3600 });
      if (request.hostname === "generativelanguage.googleapis.com") {
        calls.model.push({ url: request.href, body: String(init?.body) });
        return Response.json({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(answers.shift()) }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        });
      }
      if (init?.method === "PATCH") {
        assert.equal(request.pathname, "/upload/drive/v3/files/csv");
        state.csv = Buffer.from(init.body as Uint8Array);
        calls.writes.push(state.csv);
        state.version++;
        return Response.json(csvFile());
      }
      assert.ok(
        !init?.method || init.method === "GET",
        "only the CSV is written",
      );
      const id = decodeURIComponent(request.pathname.split("/").at(-1)!);
      if (request.searchParams.get("alt") === "media")
        return new Response(
          Uint8Array.from(id === "csv" ? state.csv : excelBytes),
        );
      if (id === "root") return Response.json(folder("root", "45 OFF"));
      if (id === "csv") return Response.json(csvFile());
      const parent = request.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
      if (!parent) return Response.json({ error: {} }, { status: 404 });
      return Response.json({ files: listings()[parent] ?? [] });
    },
  );
  return { state, calls };
}

test("the folder check reports the mapping before the campaign is registered", async (t) => {
  await drive(t);
  const inspection = await inspectDriveFolder(url);
  assert.ok("folder" in inspection);
  // Mapping problems never block registering; they block the analysis.
  assert.equal(inspection.ok, true);
  assert.equal(inspection.mapping?.status, "ready");
  if (inspection.mapping?.status !== "ready") return;
  assert.equal(inspection.mapping.unmapped, 5);
  assert.equal(inspection.mapping.freeRows.length, 4);
  assert.deepEqual(inspection.mapping.csv, {
    name: "PEDIDO_CONVERTED.csv",
    canEdit: true,
    version: "1",
  });
});

test("Gemini Neon explains and proposes, code verifies and only the CSV is written", async (t) => {
  const d = await drive(t, [
    {
      rows: [
        ...images.slice(0, 4).map((image, i) => ({
          piece: image.name,
          csvLine: i + 2,
          explanation:
            "El ID del CSV no tiene el prefijo OFFLINE_ del archivo.",
        })),
        // Not a free row: refused by code.
        { piece: "logo_96.png", csvLine: 99, explanation: "Inventada." },
      ],
      orders: [],
    },
    {
      rows: [
        {
          piece: "logo_96.png",
          csvLine: null,
          explanation: "No hay ninguna fila para el logo: agregala o excluilo.",
        },
      ],
      orders: (
        [
          [0, "6"],
          [1, "7"],
          [2, "8"],
          [3, "7"],
        ] as const
      ).map(([i, row]) => ({
        piece: images[i].name,
        order: row,
        explanation:
          "El CSV dice el formato con otras palabras que la matriz. Corregí el CSV o aprobá que dicen lo mismo.",
      })),
    },
  ]);

  // Step 1: pieces without a row.
  const first = await reviewMapping(context());
  assert.equal(first.error, undefined);
  assert.equal(first.model, "gemini-4-neon");
  assert.equal(d.calls.model.length, 1);
  assert.match(d.calls.model[0].url, /gemini-4-neon/);
  assert.match(d.calls.model[0].body, /8_PRESAS_1_PAPA/);
  // Nothing of the matrix is needed yet: it is not sent.
  assert.doesNotMatch(
    d.calls.model[0].body,
    /\$5,99|OFERTA DE VALOR|MATRIZ\.xlsx|Miércoles 25/,
  );
  const logo = first.suggestions.find((s) => s.piece === "logo_96.png")!;
  assert.match(logo.rejected!, /no está libre/);
  assert.deepEqual(logo.edits, []);
  const rowEdits = first.suggestions.flatMap((s) => s.edits);
  assert.deepEqual(
    rowEdits
      .map((e) => [e.csvLine, e.column, e.origin])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [2, "ID_PIEZA", "ai"],
      [3, "ID_PIEZA", "ai"],
      [4, "ID_PIEZA", "ai"],
      [5, "ID_PIEZA", "ai"],
    ],
  );
  assert.equal(d.calls.writes.length, 0, "a review never writes");
  const checked = await checkCsvFix(context(), first.csv!.version, rowEdits);
  assert.equal(checked.errors, undefined);
  assert.equal(checked.next?.length, 4, "the matrix is the next step");
  assertConvexKeys(first, "review");
  assertConvexKeys(checked, "check");
  const applied = await applyCsvFix(context(), first.csv!.version, rowEdits);
  assert.equal(applied.error, undefined);
  assert.equal(applied.applied, 4);
  assert.equal(d.state.version, 2);

  // Step 2: the rows do not say what the matrix says.
  const second = await reviewMapping(context());
  const body = d.calls.model[1].body;
  assert.match(body, /Post Estático/);
  assert.match(
    body,
    /Miércoles 25/,
    "the date of the candidates is read-only data",
  );
  assert.doesNotMatch(body, /\$5,99|\$9,99|OFERTA DE VALOR|MATRIZ\.xlsx/);
  // The model still reads the row and the orders by column name.
  assert.match(body, /FORMATO_TIPO\\?":\\?"POST/);
  assert.match(body, /FORMATO_TIPO\\?":\\?"Post Estático/);
  assertConvexKeys(second, "review");
  const formatEdits = second.suggestions.flatMap((s) => s.edits);
  assert.deepEqual(
    formatEdits
      .map((e) => [e.csvLine, e.column, e.to, e.order])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [2, "FORMATO_TIPO", "Post Estático", "6"],
      [3, "FORMATO_TIPO", "Post Estático", "7"],
      [4, "FORMATO_TIPO", "Stories Estática", "8"],
      [5, "FORMATO_TIPO", "Post Estático", "7"],
    ],
  );
  assert.deepEqual(
    second.suggestions.find((s) => s.piece === images[0].name)?.equivalences,
    [postValues],
  );
  // «Dicen lo mismo» is verified against the files too.
  assert.deepEqual(
    await checkEquivalences(context(), images[0].name, "6", [postValues]),
    {},
  );
  assert.ok(
    (
      await checkEquivalences(context(), images[0].name, "8", [
        { ...postValues, matrixValue: "Stories Estática" },
      ])
    ).error,
  );

  // A tampered change is refused before writing.
  const tampered = await applyCsvFix(context(), second.csv!.version, [
    { ...formatEdits[0], to: "Inventado" },
  ]);
  assert.match(tampered.error!, /no pasaron la verificación/);
  assert.equal(d.state.version, 2);

  const done = await applyCsvFix(context(), second.csv!.version, formatEdits);
  assert.equal(done.error, undefined);
  assert.equal(d.calls.writes.length, 2);
  const written = d.state.csv.toString("utf8");
  assert.ok(written.startsWith("﻿"));
  assert.equal(
    written.split("\r\n")[3],
    `OFFLINE_45,${stem(images[2].name)},NOTORIEDAD,AUTORAPIDO,META,Stories Estática,1080,1920,FECHAS_HOY.ai,PARTE Y COMPARTE 5 PRESAS,"5,99"`,
  );
  const after = await inspectDriveFolder(url);
  assert.ok("folder" in after && after.mapping?.status === "ready");
  if (!("folder" in after) || after.mapping?.status !== "ready") return;
  assert.equal(after.mapping.linked, 4);
  assert.deepEqual(
    after.mapping.groups.map((g) => g.pieces),
    [["logo_96.png"]],
  );

  // The proposal was made for a previous version of the CSV.
  const stale = await applyCsvFix(context(), "1", rowEdits);
  assert.match(stale.error!, /cambió en Drive/);
});

test("an approved equivalence links the pieces in the folder check without writing", async (t) => {
  const d = await drive(t);
  d.state.csv = Buffer.from(withIds(), "utf8");
  const inspection = await inspectDriveFolder(url, {}, new Set(), [
    postEquivalence,
  ]);
  assert.ok("folder" in inspection && inspection.mapping?.status === "ready");
  if (!("folder" in inspection) || inspection.mapping?.status !== "ready")
    return;
  assert.equal(inspection.mapping.linked, 3);
  assert.equal(d.calls.writes.length, 0);
});
