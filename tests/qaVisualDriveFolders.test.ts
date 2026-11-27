import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import JSZip from "jszip";
import type { ActionCtx } from "../convex/_generated/server";
import { folderMime, type DriveFile } from "../convex/qaVisual/driveClient";
import {
  createProductionCsv,
  inspectDriveFolder,
  listDriveCampaign,
} from "../convex/qaVisual/driveSource.node";
import { createCsv } from "../convex/qaVisual/campaignRegistration";
import { authorizeMedia } from "../convex/qaVisual/drive";
import {
  buildProductionCsv,
  matrixOrders,
} from "../convex/qaVisual/model/productionCsvBuilder";
import { productionByPiece } from "../convex/qaVisual/model/productionCsv";
import { buildRequirements } from "../convex/qaVisual/model/requirements";
import { pieceKey } from "../convex/qaVisual/model/normalize";

const cells = {
  A1: "CAMPAÑA",
  A6: "Semana",
  B6: "NOTORIEDAD",
  C6: "OFFLINE",
  D6: "META",
  E6: "Post Estático",
  G6: "PNG",
  I6: "1080",
  J6: "1080",
  K6: "1. DOMICILIO HOY FESTIN DE LOCURA\n2. EXPRESS 21 de octubre COMBO FAMILIAR",
  L6: "1. $8,99\n2. $12,50",
  A7: "Semana",
  B7: "NOTORIEDAD",
  C7: "OFFLINE",
  D7: "META",
  E7: "Stories Estáticas",
  G7: "PNG",
  I7: "1080",
  J7: "1920",
  K7: "1. DOMICILIO HOY FESTIN DE LOCURA",
  L7: "1. $8,99",
  A8: "Semana",
  B8: "CONVERSION",
  C8: "OFFLINE",
  D8: "META",
  E8: "Post Estático",
  G8: "PNG",
  I8: "1080",
  J8: "1080",
  K8: "1. AUTORAPIDO HOY ALITAS",
  L8: "1. $4,50",
};
const matrix = {
  name: "MATRIZ.xlsx",
  cells: Object.entries(cells).map(([cell, text]) => ({
    sheet: "PRODUCCION",
    cell,
    text,
  })),
};
const images = [
  {
    name: "post_domicilio_festin_de_locura_hoy.png",
    width: 1080,
    height: 1080,
  },
  { name: "story_domicilio_festin_de_locura.png", width: 1080, height: 1920 },
  { name: "combo_familiar_express_octubre_21.png" },
  { name: "expectativa.png" },
];

test("the generated CSV has one row per matrix order and links each unambiguous image", () => {
  assert.equal(matrixOrders(matrix).length, 4);
  const built = buildProductionCsv(matrix, images);
  assert.equal(built.orders, 4);
  assert.equal(built.assigned, 3);
  assert.deepEqual(built.unassignedImages, ["expectativa.png"]);
  assert.ok(built.text.startsWith("﻿ID_PIEZA;TXT_PRODUCTO;TXT_PRECIO"));

  // The file is read by the same parser and linker as an agency CSV.
  const production = productionByPiece(built.text);
  assert.ok(production["f8_01_post_alitas"], "orders without image keep an ID");
  for (const image of images.slice(0, 3)) {
    const row = production[pieceKey(image.name)];
    assert.ok(row, image.name);
    const { requirements, issues } = buildRequirements(matrix, image.name, row);
    assert.ok(
      !issues.some((i) => /row_missing|row_ambiguous/.test(i.code)),
      `${image.name}: ${issues.map((i) => i.code).join(", ")}`,
    );
    const product = requirements.find((r) => r.ruleId === "product")!;
    assert.equal(product.status, "ready", image.name);
  }
  assert.equal(production[pieceKey(images[2].name)].product, "COMBO FAMILIAR");
  assert.equal(production[pieceKey(images[2].name)].price, "$12,50");
  // The generated CSV copies the matrix text, so it links without equivalences.
  assert.equal(
    production[pieceKey(images[1].name)].format,
    "STORIES ESTÁTICAS",
  );
});

test("two images that fit the same order are left for a person to resolve", () => {
  const built = buildProductionCsv(matrix, [
    { name: "post_festin_de_locura_a.png", width: 1080, height: 1080 },
    { name: "post_festin_de_locura_b.png", width: 1080, height: 1080 },
  ]);
  assert.equal(built.assigned, 0);
  assert.equal(built.unassignedImages.length, 2);
});

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs8", format: "pem" });
const folder = (id: string, name: string, parents?: string[]): DriveFile => ({
  id,
  name,
  mimeType: folderMime,
  parents,
  capabilities: { canListChildren: true, canAddChildren: true },
});
const url = "https://drive.google.com/drive/folders/root";

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

/** A campaign whose folders do not use the usual names. */
async function drive(t: TestContext) {
  const previous = process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "qa@example.test",
    private_key: privateKey,
  });
  t.after(() => {
    if (previous === undefined)
      delete process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON = previous;
  });
  const excelBytes = await workbook();
  const excel: DriveFile = {
    id: "excel",
    name: "MATRIZ.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    version: "1",
    size: String(excelBytes.length),
  };
  const listings: Record<string, DriveFile[]> = {
    root: [
      folder("client", "Material cliente"),
      folder("production", "Producción"),
      folder("visuals", "Visuales"),
    ],
    client: [excel],
    production: [folder("csv-folder", "CSV", ["production"])],
    "csv-folder": [],
    visuals: images.map((image, i) => ({
      id: `image-${i}`,
      name: image.name,
      mimeType: "image/png",
      version: "1",
      md5Checksum: `hash-${i}`,
      size: "10",
      parents: ["visuals"],
      ...(image.width
        ? { imageMediaMetadata: { width: image.width, height: image.height } }
        : {}),
    })),
  };
  const metadata: Record<string, DriveFile> = {
    root: folder("root", "Campaña sin nombres"),
    "csv-folder": folder("csv-folder", "CSV", ["production"]),
    foreign: folder("foreign", "Otra campaña", ["elsewhere"]),
  };
  const uploads: { url: URL; body: string }[] = [];
  let uploadResponse: () => Response = () => Response.json({ id: "new-csv" });
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL, init?: RequestInit) => {
      const request = new URL(String(input));
      if (request.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "test-only", expires_in: 3600 });
      if (init?.method === "POST") {
        assert.equal(request.pathname, "/upload/drive/v3/files");
        uploads.push({
          url: request,
          body: Buffer.from(init.body as Uint8Array).toString("utf8"),
        });
        return uploadResponse();
      }
      const id = decodeURIComponent(request.pathname.split("/").at(-1)!);
      if (request.searchParams.get("alt") === "media") {
        assert.equal(id, "excel");
        return new Response(Uint8Array.from(excelBytes));
      }
      if (metadata[id]) return Response.json(metadata[id]);
      const parent = request.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
      if (!parent) return Response.json({ error: {} }, { status: 404 });
      assert.ok(parent in listings, `unexpected listing ${parent}`);
      return Response.json({ files: listings[parent] });
    },
  );
  return {
    listings,
    uploads,
    respond: (fn: () => Response) => (uploadResponse = fn),
  };
}

test("VISUALES is detected as the pieces folder and other sources can be any folder of the campaign", async (t) => {
  await drive(t);
  const detected = await inspectDriveFolder(url);
  assert.ok("folder" in detected);
  assert.equal(detected.ok, false);
  const status = (key: string) =>
    detected.checks.find((check) => check.key === key)?.status;
  assert.equal(status("DESPLIEGUE"), "ok");
  assert.equal(status("RECURSOS"), "choose");
  assert.equal(status("EDITABLES"), "choose");
  assert.deepEqual(
    detected.folders.map((f) => f.name),
    [
      "Campaña sin nombres (carpeta compartida)",
      "Material cliente",
      "Producción",
      "Producción / CSV",
      "Visuales",
    ],
  );

  const chosen = await inspectDriveFolder(url, {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  });
  assert.ok("folder" in chosen);
  assert.deepEqual(chosen.selection, {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
    excelFileId: "excel",
  });
  assert.equal(chosen.canCreateCsv, true);
  assert.equal(chosen.csvFolder?.name, "Producción / CSV");
  assert.equal(
    chosen.checks.find((c) => c.key === "EDITABLES")?.status,
    "missing",
  );

  // Folders outside the shared folder are never read, even if the account can see them.
  const outside = await inspectDriveFolder(url, {
    resourcesFolderId: "foreign",
  });
  assert.ok("folder" in outside);
  assert.match(
    outside.checks.find((c) => c.key === "RECURSOS")!.title,
    /ya no está disponible/,
  );
});

test("a sync without the chosen folders asks for sources; with them it reads every source", async (t) => {
  const d = await drive(t);
  const missing = await listDriveCampaign("root");
  assert.equal(missing.needsSources, true);
  assert.ok(
    missing.inventory.notices.some((n) => /RECURSOS.*Elegir fuentes/.test(n)),
  );
  await assert.rejects(listDriveCampaign("root", {}, true), /RECURSOS/);

  d.listings["csv-folder"].push({
    id: "csv",
    name: "PEDIDO.csv",
    mimeType: "text/csv",
    version: "1",
  });
  const listed = await listDriveCampaign("root", {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  });
  assert.deepEqual(listed.inventory.notices, []);
  assert.equal(listed.needsSources, false);
  assert.equal(listed.matrix?.id, "excel");
  assert.equal(listed.csv?.id, "csv");
  assert.equal(listed.deployment?.folderId, "visuals");
  assert.equal(listed.inventory.pieces.length, 4);
});

test("the CSV is generated from the matrix and saved in the chosen production folder", async (t) => {
  const d = await drive(t);
  const selection = {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  };
  d.respond(() => {
    d.listings["csv-folder"].push({
      id: "new-csv",
      name: "CAMPANA_SIN_NOMBRES_QA_VISUAL.csv",
      mimeType: "text/csv",
      version: "1",
    });
    return Response.json({ id: "new-csv" });
  });
  const action = createCsv as unknown as {
    _handler(
      ctx: ActionCtx,
      args: Record<string, string>,
    ): ReturnType<typeof createProductionCsv> &
      Promise<{ inspection?: unknown }>;
  };
  const result = await action._handler(
    { runQuery: async () => true } as unknown as ActionCtx,
    { folderUrl: url, ...selection },
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(result.created, {
    id: "new-csv",
    name: "CAMPANA_SIN_NOMBRES_QA_VISUAL.csv",
    orders: 4,
    assigned: 3,
    unassigned: 1,
  });
  assert.equal(d.uploads.length, 1);
  assert.equal(d.uploads[0].url.searchParams.get("uploadType"), "multipart");
  assert.match(d.uploads[0].body, /"parents":\["csv-folder"\]/);
  assert.match(d.uploads[0].body, /ID_PIEZA;TXT_PRODUCTO/);
  const inspection = (
    result as { inspection?: { ok: boolean; selection: object } }
  ).inspection;
  assert.equal(inspection?.ok, true);
  assert.deepEqual(inspection?.selection, {
    ...selection,
    excelFileId: "excel",
    csvFileId: "new-csv",
  });
});

test("when Drive refuses the upload the CSV can still be downloaded", async (t) => {
  const d = await drive(t);
  d.respond(() =>
    Response.json(
      { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
      { status: 403 },
    ),
  );
  const result = await createProductionCsv(url, {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  });
  assert.match(result.error!, /Mi unidad/);
  assert.equal(result.created, undefined);
  assert.equal(result.download?.orders, 4);
  assert.match(result.download!.content, /F8_01_POST_ALITAS/);

  d.respond(() => Response.json({ error: {} }, { status: 403 }));
  const denied = await createProductionCsv(url, {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  });
  assert.match(denied.error!, /Editor/);

  d.listings["csv-folder"].push({
    id: "csv",
    name: "PEDIDO.csv",
    mimeType: "text/csv",
    version: "1",
  });
  const existing = await createProductionCsv(url, {
    resourcesFolderId: "client",
    editablesFolderId: "csv-folder",
  });
  assert.match(existing.error!, /ya tiene un CSV/);
  assert.equal(d.uploads.length, 2);
});

test("original images are served from the chosen pieces folder", async (t) => {
  await drive(t);
  const handler = (
    authorizeMedia as unknown as {
      _handler(ctx: unknown, args: Record<string, string>): Promise<unknown>;
    }
  )._handler;
  const image = {
    id: "image-0",
    name: "pieza.png",
    mimeType: "image/png",
    version: "1",
    size: "10",
    parents: ["custom"],
  };
  const metadata = new Map<string, DriveFile>([
    ["image-0", image],
    ["custom", folder("custom", "Finales", ["root"])],
  ]);
  const fetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL, init?: RequestInit) => {
      const id = new URL(String(input)).pathname.split("/").at(-1)!;
      return metadata.has(id)
        ? Response.json(metadata.get(id))
        : fetch(input, init);
    },
  );
  const args = { driveFolderId: "root", id: "image-0", version: "1" };
  assert.equal(
    await handler({}, args),
    null,
    "a folder that is not DESPLIEGUE needs to be chosen",
  );
  assert.ok(await handler({}, { ...args, deploymentFolderId: "custom" }));
});
