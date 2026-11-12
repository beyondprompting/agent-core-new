import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { v, type Infer } from "convex/values";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { importPool } from "../convex/qaVisual/importPool";
import {
  resolveIdentities,
  type IdentityPiece,
  type IdentityVersion,
  type IdentityFile,
} from "../convex/qaVisual/model/identity";
import {
  preparedPiece,
  importMetadata,
} from "../convex/qaVisual/model/importContracts";
import { ANALYSIS_POLICY_VERSION } from "../convex/qaVisual/model/contracts";

const modules = {
  "../convex/qaVisual/imageWarmup.ts": () =>
    import("../convex/qaVisual/imageWarmup"),
  "../convex/qaVisual/prepareImages.ts": () =>
    import("../convex/qaVisual/prepareImages"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/qaVisual/imports.ts": () => import("../convex/qaVisual/imports"),
  "../convex/qaVisual/importJob.ts": () =>
    import("../convex/qaVisual/importJob"),
  "../convex/qaVisual/sourceFiles.ts": () =>
    import("../convex/qaVisual/sourceFiles"),
  "../convex/qaVisual/campaigns.ts": () =>
    import("../convex/qaVisual/campaigns"),
  "../convex/qaVisual/campaignSnapshots.ts": () =>
    import("../convex/qaVisual/campaignSnapshots"),
  "../convex/qaVisual/editor.ts": () => import("../convex/qaVisual/editor"),
  "../convex/qaVisual/overrides.ts": () =>
    import("../convex/qaVisual/overrides"),
  "../convex/qaVisual/imageCopies.ts": () =>
    import("../convex/qaVisual/imageCopies"),
  "../convex/qaVisual/runs.ts": () => import("../convex/qaVisual/runs"),
};
const file = (
  id: string,
  name = "pieza.png",
  createdAt = 1,
  contentHash = id,
): IdentityFile => ({ driveId: id, name, createdAt, contentHash });
const piece = (
  id = "piece",
  driveFileId = "old",
  status = "active",
): IdentityPiece => ({
  id,
  key: "pieza",
  baseKey: "pieza",
  driveFileId,
  status,
  createdAt: 1,
});
const version = (
  pieceId = "piece",
  driveFileId = "old",
  contentHash = "old",
): IdentityVersion => ({ pieceId, driveFileId, contentHash });

test("identity uses Drive ownership before names, and only absent files allow replacement", () => {
  const p = piece();
  for (const f of [
    file("old", "renamed.png"),
    file("old", "pieza.png", 1, "changed"),
    file("new"),
  ]) {
    const r = resolveIdentities([f], [p], [version()]);
    assert.equal(r.entries[0].identity.pieceId, p.id);
    assert.equal(r.entries[0].identity.key, "pieza");
  }
  const r = resolveIdentities(
    [file("old", "renamed.png"), file("new")],
    [p],
    [version()],
  );
  assert.equal(
    r.entries.find((e) => e.file.driveId === "old")!.identity.pieceId,
    p.id,
  );
  assert.equal(
    r.entries.find((e) => e.file.driveId === "new")!.identity.key,
    "pieza#new",
  );
  assert.ok(r.entries.every((e) => e.identity.duplicate));
});
test("first duplicates choose the oldest deterministically, including suffix collisions", () => {
  const r = resolveIdentities(
    [
      file("zzzzzz2", "pieza.png", 3),
      file("aaaaaa1", "pieza.png", 1),
      file("zzzzzz1", "pieza.png", 2),
    ],
    [],
    [],
  );
  assert.equal(r.entries[0].file.driveId, "aaaaaa1");
  assert.equal(r.entries[0].identity.key, "pieza");
  assert.equal(new Set(r.entries.map((e) => e.identity.key)).size, 3);
  const tied = resolveIdentities([file("b"), file("a")], [], []);
  assert.equal(tied.entries[0].file.driveId, "a");
});
test("retired pieces return to their identity and human resolutions exclude or merge live duplicates", () => {
  assert.equal(
    resolveIdentities(
      [file("new")],
      [piece("piece", "old", "removed")],
      [version()],
    ).entries[0].identity.pieceId,
    "piece",
  );
  const files = [file("old"), file("new", "pieza.png", 2)];
  const keep = resolveIdentities(
    files,
    [piece()],
    [version()],
    [{ kind: "keepDuplicate", baseKey: "pieza", keepDriveFileId: "new" }],
  );
  assert.equal(keep.entries[0].identity.disposition, "excluded");
  assert.equal(keep.entries[1].identity.disposition, "active");
  assert.ok(keep.entries.every((e) => !e.identity.duplicate));
  const merge = resolveIdentities(
    files,
    [piece()],
    [version()],
    [
      {
        kind: "mergeAsVersion",
        baseKey: "pieza",
        olderDriveFileId: "old",
        newerDriveFileId: "new",
      },
    ],
  );
  assert.equal(merge.entries[0].identity.disposition, "historical");
  assert.equal(merge.entries[1].identity.pieceId, "piece");
});

async function setup(t: TestContext, mockPool = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let jobs = 0;
  if (mockPool) {
    t.mock.method(importPool, "enqueueAction", async () => `work-${++jobs}`);
    t.mock.method(importPool, "cancel", async () => {});
  }
  const db = convexTest(schema, modules);
  const ids = await db.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Revisora" });
    await ctx.db.insert("userAccessProfiles", {
      userId,
      platformRole: "super_admin",
      updatedAt: 1,
      updatedBy: userId,
    });
    const campaignId = await ctx.db.insert("qaVisualCampaigns", {
      name: "QA",
      driveFolderId: "root",
      reviewKey: "qa",
      status: "active",
      createdBy: userId,
    });
    const storageId = await ctx.storage.store(new Blob(["source"]));
    const sourceId = await ctx.db.insert("qaVisualSourceFiles", {
      campaignId,
      kind: "excel",
      driveFileId: "excel",
      driveVersion: "1",
      sha256: "source",
      name: "matrix.xlsx",
      mimeType: "application/octet-stream",
      bytes: 6,
      modifiedAt: 1,
      storageId,
      parserVersion: "5",
    });
    return { userId, campaignId, sourceId };
  });
  return { db, user: db.withIdentity({ subject: ids.userId }), ...ids };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const metadataValidator = v.object(importMetadata);
function item(
  id: string,
  name = `${id}.png`,
  contentHash = id,
  identity?: Infer<typeof preparedPiece>["identity"],
): Infer<typeof preparedPiece> {
  const contextKey = `input:${contentHash}`;
  return {
    file: {
      name,
      driveId: id,
      driveVersion: "1",
      contentHash,
      createdAt: 1,
      bytes: 10,
      updatedAt: 1,
    },
    input: {
      name,
      revision: 1,
      contextKey,
      contentHash,
      requirementsHash: "requirements",
      policyVersion: ANALYSIS_POLICY_VERSION,
      requirements: [],
      issues: [],
    },
    display: {
      title: name,
      fileName: name,
      format: "PNG",
      width: 1080,
      height: 1080,
      phase: "",
      channel: "",
      warning: 0,
      blocking: 0,
      inputHash: contextKey,
    },
    identity: identity ?? {
      key: id,
      baseKey: id,
      disposition: "active",
      duplicate: false,
    },
  };
}
async function begin(
  s: Setup,
  pieces: Infer<typeof preparedPiece>[],
  fingerprint = crypto.randomUUID(),
  excludedPieceIds: Id<"qaVisualPieces">[] = [],
) {
  const importId = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
  });
  const started = (await s.db.mutation(internal.qaVisual.imports.start, {
    importId,
  }))!;
  const request = { importId, epoch: started.epoch };
  const metadata: Infer<typeof metadataValidator> = {
    fingerprint,
    excelFileId: s.sourceId,
    csvFileId: s.sourceId,
    deploymentFolderId: "deployment",
    driveFolderName: "QA",
    ruleVersion: "rules",
    rules: [],
    notices: [],
    ignoredFiles: [],
    missingImages: [],
    excludedPieceIds,
    counts: {
      images: pieces.length,
      linked: 0,
      linkedWithNotices: 0,
      blocked: 0,
      csvRowsWithoutImage: 0,
      ignoredFiles: 0,
    },
  };
  const planStorageId = await s.db.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify({ pieces, metadata })])),
  );
  await s.db.mutation(internal.qaVisual.imports.setPlan, {
    ...request,
    ...metadata,
    planStorageId,
  });
  return request;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function write(
  s: Setup,
  request: { importId: Id<"qaVisualImports">; epoch: number },
  pieces: Infer<typeof preparedPiece>[],
  offset = 0,
) {
  return s.db.mutation(internal.qaVisual.imports.writeChunk, {
    ...request,
    offset,
    hash: digest(pieces),
    pieces,
  });
}
async function publish(
  s: Setup,
  items: Infer<typeof preparedPiece>[],
  fingerprint?: string,
) {
  const request = await begin(s, items, fingerprint);
  for (let i = 0; i < items.length; i += 50)
    await write(s, request, items.slice(i, i + 50), i);
  await s.db.mutation(internal.qaVisual.imports.publish, request);
  return request;
}
const viewer = (s: Setup) =>
  s.user.query(api.qaVisual.campaignSnapshots.viewer, {
    campaignId: s.campaignId,
  });

test("staged imports are invisible until a complete atomic publication; chunks are idempotent", async (t) => {
  const s = await setup(t);
  const first = await publish(s, [item("old")]);
  const visible = (await viewer(s))!;
  const oldPiece = visible.pieces[0].pieceId!,
    oldVersion = visible.pieces[0].pieceVersionId!;
  const before = await s.db.run(async (ctx) => ({
    piece: await ctx.db.get(oldPiece),
    version: await ctx.db.get(oldVersion),
  }));
  const next = item("new", "old.png", "new-content", {
    key: "old",
    baseKey: "old",
    pieceId: oldPiece,
    disposition: "active",
    duplicate: false,
  });
  const request = await begin(s, [next, item("added")]);
  await write(s, request, [next]);
  await write(s, request, [next]);
  const middle = await viewer(s);
  assert.equal(middle!.snapshotId, first.importId);
  assert.equal(middle!.pieces.length, 1);
  assert.deepEqual(
    await s.db.run(async (ctx) => ({
      piece: await ctx.db.get(oldPiece),
      version: await ctx.db.get(oldVersion),
    })),
    before,
  );
  const detail = await s.user.query(api.qaVisual.editor.piece, {
    pieceId: oldPiece,
  });
  assert.equal(detail!.versions.length, 1);
  const staged = await s.db.run((ctx) =>
    ctx.db
      .query("qaVisualPieceVersions")
      .withIndex("by_staged_import", (q) =>
        q.eq("stagedImportId", request.importId),
      )
      .first(),
  );
  assert.equal(
    await s.user.query(api.qaVisual.editor.piece, {
      pieceId: oldPiece,
      version: staged!.number,
    }),
    null,
  );
  assert.equal(
    await s.user.query(internal.qaVisual.imageCopies.versionMedia, {
      campaignId: s.campaignId,
      pieceVersionId: staged!._id,
      variant: "analysis",
    }),
    null,
  );
  await assert.rejects(
    s.db.mutation(internal.qaVisual.imports.publish, request),
    /completa/,
  );
  await assert.rejects(write(s, request, [item("tampered")]), /contenido/);
  await write(s, request, [item("added")], 1);
  await s.db.mutation(internal.qaVisual.imports.publish, request);
  const after = (await viewer(s))!;
  assert.equal(after.pieces.length, 2);
  assert.equal(after.pieces[0].version, 2);
  assert.equal(after.pieces[0].humanStatus, "Pendiente");
  assert.equal(
    (await s.db.run((ctx) => ctx.db.get(first.importId)))!.status,
    "superseded",
  );
});

test("a failed import preserves the published review, fences old workers and cleans only its own staged rows", async (t) => {
  const s = await setup(t);
  const first = await publish(s, [item("old")]);
  const failed = await begin(s, [item("new")]);
  await write(s, failed, [item("new")]);
  await s.db.mutation(internal.qaVisual.imports.fail, {
    ...failed,
    error: { code: "test", message: "Fallo", retryable: true },
  });
  const replacement = await begin(s, [item("new")]);
  await write(s, replacement, [item("new")]);
  assert.equal(
    await s.db.mutation(internal.qaVisual.imports.publish, failed),
    false,
  );
  assert.equal(await write(s, failed, [item("new")]), false);
  await s.db.mutation(internal.qaVisual.imports.cleanup, {
    importId: failed.importId,
  });
  assert.equal((await viewer(s))!.snapshotId, first.importId);
  assert.equal(
    (
      await s.db.run((ctx) =>
        ctx.db
          .query("qaVisualPieces")
          .withIndex("by_staged_import", (q) =>
            q.eq("stagedImportId", replacement.importId),
          )
          .collect(),
      )
    ).length,
    1,
  );
  await s.db.mutation(internal.qaVisual.imports.publish, replacement);
  assert.equal((await viewer(s))!.pieces[0].file.driveId, "new");
});

test("a retried action resumes its frozen plan; stale attempt progress and callbacks cannot end the new work", async (t) => {
  const s = await setup(t);
  const pieces = [item("one"), item("two")];
  const old = await begin(s, pieces);
  await write(s, old, [pieces[0]]);
  const retry = (await s.db.mutation(internal.qaVisual.imports.start, {
    importId: old.importId,
  }))!;
  const request = { importId: old.importId, epoch: retry.epoch };
  assert.equal(
    await s.db.mutation(internal.qaVisual.imports.progress, {
      ...old,
      stage: "linking",
    }),
    false,
  );
  await s.db.mutation(internal.qaVisual.imports.onComplete, {
    context: { importId: old.importId },
    workId: "different-job" as import("@convex-dev/workpool").WorkId,
    result: { kind: "failed", error: "late" },
  });
  await write(s, request, [pieces[0]]);
  await write(s, request, [pieces[1]], 1);
  await s.db.mutation(internal.qaVisual.imports.publish, request);
  assert.equal((await viewer(s))!.pieces.length, 2);
});

test("unchanged input reuses the import without new pieces, versions or persistent import rows", async (t) => {
  const s = await setup(t);
  const first = await publish(s, [item("one")], "same");
  const original = await s.db.run(async (ctx) => ({
    piece: await ctx.db.query("qaVisualPieces").first(),
    version: await ctx.db.query("qaVisualPieceVersions").first(),
  }));
  const id = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
  });
  await assert.rejects(
    s.user.mutation(api.qaVisual.imports.request, { campaignId: s.campaignId }),
    /curso/,
  );
  const started = (await s.db.mutation(internal.qaVisual.imports.start, {
    importId: id,
  }))!;
  assert.equal(
    await s.db.mutation(internal.qaVisual.imports.reuse, {
      importId: id,
      epoch: started.epoch,
      fingerprint: "same",
    }),
    true,
  );
  assert.equal(await s.db.run((ctx) => ctx.db.get(id)), null);
  assert.equal((await viewer(s))!.snapshotId, first.importId);
  assert.deepEqual(
    await s.db.run(async (ctx) => ({
      piece: await ctx.db.query("qaVisualPieces").first(),
      version: await ctx.db.query("qaVisualPieceVersions").first(),
    })),
    original,
  );
});

test("renaming retains a creative version and approval; changed content creates only its own unapproved version", async (t) => {
  const s = await setup(t);
  await publish(s, [item("one"), item("two")]);
  const before = (await viewer(s))!.pieces;
  await s.db.run(async (ctx) => {
    const id = await ctx.db.insert("qaVisualDecisions", {
      campaignId: s.campaignId,
      pieceId: before[0].pieceId!,
      pieceVersionId: before[0].pieceVersionId!,
      decision: "approved",
      decidedBy: s.userId,
      aiSeen: { inputHash: "input:one", stale: false },
    });
    await ctx.db.patch(before[0].pieceVersionId!, { currentDecisionId: id });
  });
  const rename = item("one", "renamed.png", "one", {
    key: "one",
    baseKey: "one",
    pieceId: before[0].pieceId!,
    disposition: "active",
    duplicate: false,
  });
  await publish(s, [rename, item("two")]);
  assert.equal(
    (await viewer(s))!.pieces[0].pieceVersionId,
    before[0].pieceVersionId,
  );
  assert.equal((await viewer(s))!.pieces[0].humanStatus, "Aprobada");
  await publish(s, [
    item("replacement", "renamed.png", "pixels-2", rename.identity),
    item("two"),
  ]);
  const after = (await viewer(s))!.pieces;
  assert.equal(after[0].version, 2);
  assert.equal(after[0].humanStatus, "Pendiente");
  assert.equal(after[1].pieceVersionId, before[1].pieceVersionId);
});

test("merging duplicate deliveries moves the existing version atomically and preserves its human decision", async (t) => {
  const s = await setup(t);
  const a = item("old", "same.png", "old", {
    key: "same",
    baseKey: "same",
    disposition: "active",
    duplicate: true,
  });
  const b = item("new", "same.png", "new", {
    key: "same#new",
    baseKey: "same",
    duplicateOfKey: "same",
    disposition: "active",
    duplicate: true,
  });
  b.file.createdAt = 2;
  await publish(s, [a, b]);
  const before = (await viewer(s))!.pieces;
  await s.db.run(async (ctx) => {
    const id = await ctx.db.insert("qaVisualDecisions", {
      campaignId: s.campaignId,
      pieceId: before[1].pieceId!,
      pieceVersionId: before[1].pieceVersionId!,
      decision: "approved",
      decidedBy: s.userId,
      aiSeen: { inputHash: "input:new", stale: false },
    });
    await ctx.db.patch(before[1].pieceVersionId!, { currentDecisionId: id });
  });
  const historical = {
    ...a,
    identity: {
      ...a.identity,
      pieceId: before[0].pieceId!,
      disposition: "historical" as const,
      duplicate: false,
    },
  };
  const current = {
    ...b,
    identity: {
      ...a.identity,
      pieceId: before[0].pieceId!,
      sourceVersionId: before[1].pieceVersionId!,
      disposition: "active" as const,
      duplicate: false,
    },
  };
  const request = await begin(s, [historical, current], undefined, [
    before[1].pieceId!,
  ]);
  await write(s, request, [historical, current]);
  assert.equal(
    (await s.db.run((ctx) => ctx.db.get(before[1].pieceVersionId!)))!.pieceId,
    before[1].pieceId,
  );
  await s.db.mutation(internal.qaVisual.imports.publish, request);
  const after = (await viewer(s))!.pieces;
  assert.equal(after.length, 1);
  assert.equal(after[0].version, 2);
  assert.equal(after[0].pieceVersionId, before[1].pieceVersionId);
  assert.equal(after[0].humanStatus, "Aprobada");
});

test("the import watchdog invalidates stale work before cleanup and leaves recent work intact", async (t) => {
  const s = await setup(t);
  await publish(s, [item("visible")]);
  const old = await begin(s, [item("hidden")]);
  await write(s, old, [item("hidden")]);
  await s.db.mutation(internal.qaVisual.imports.sweep, {});
  assert.equal(
    (await s.db.run((ctx) => ctx.db.get(old.importId)))!.status,
    "building",
  );
  await s.db.run((ctx) =>
    ctx.db.patch(old.importId, { updatedAt: Date.now() - 31 * 60_000 }),
  );
  await s.db.mutation(internal.qaVisual.imports.sweep, {});
  assert.equal(
    (await s.db.run((ctx) => ctx.db.get(old.importId)))!.status,
    "failed",
  );
  assert.equal(
    await s.db.mutation(internal.qaVisual.imports.publish, old),
    false,
  );
  assert.equal((await viewer(s))!.pieces[0].file.driveId, "visible");
});

test("1000 pieces can be staged in 50-piece chunks with a bounded publication manifest", async (t) => {
  const s = await setup(t);
  const items = Array.from({ length: 1000 }, (_, i) =>
    item(
      `image-${i}`,
      `${i}_AUTORAPIDO_FESTIN_DE_LOCURA_HOY_CAMPANA_NOVIEMBRE_CANAL_DIGITAL_1080x1920px.png`,
      "a".repeat(64),
    ),
  );
  const request = await publish(s, items);
  const row = (await s.db.run((ctx) => ctx.db.get(request.importId)))!;
  assert.equal(row.manifest.length, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(row)) < 1_000_000);
  assert.equal((await viewer(s))!.pieces.length, 1000);
});

async function syntheticDrive(t: TestContext, count = 61) {
  const { generateKeyPairSync } = await import("node:crypto");
  const { default: JSZip } = await import("jszip");
  const { folderMime } = await import("../convex/qaVisual/driveClient");
  const previous = process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "qa@example.test",
    private_key: generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  t.after(() => {
    if (previous === undefined)
      delete process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON = previous;
  });
  const names = Array.from(
    { length: count },
    (_, i) => `${i + 1}_AUTORAPIDO_FESTIN_HOY_1080x1080px.png`,
  );
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PRODUCCION" r:id="r1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
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
    K6: "1. AUTORAPIDO HOY FESTIN",
    L6: "1. $8,99",
  };
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>${Object.entries(cells)
      .map(
        ([r, value]) =>
          `<c r="${r}" t="inlineStr"><is><t>${value}</t></is></c>`,
      )
      .join("")}</sheetData></worksheet>`,
  );
  const contents: Record<string, Buffer> = {
    excel: await zip.generateAsync({ type: "nodebuffer" }),
    csv: Buffer.from(
      "ID_PIEZA;TXT_PRODUCTO;TXT_PRECIO;SLOT_FECHA;CAMPAÑA;FASE;CANAL;MEDIO_PLATAFORMA;FORMATO_TIPO;ANCHO_PX;ALTO_PX\n" +
        names
          .map(
            (name) =>
              `${name};FESTIN;8,99;HOY;Semana;NOTORIEDAD;OFFLINE;META;POST;1080;1080`,
          )
          .join("\n"),
    ),
  };
  const folder = (id: string, name: string) => ({
    id,
    name,
    mimeType: folderMime,
    capabilities: { canListChildren: true },
  });
  const listings: Record<
    string,
    import("../convex/qaVisual/driveClient").DriveFile[]
  > = {
    root: [
      folder("resources", "RECURSOS"),
      folder("editables", "EDITABLES"),
      folder("deployment", "DESPLIEGUE"),
    ],
    resources: [
      {
        id: "excel",
        name: "MATRIZ.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        version: "1",
        size: String(contents.excel.length),
        md5Checksum: createHash("md5").update(contents.excel).digest("hex"),
      },
    ],
    editables: [
      {
        id: "csv",
        name: "PEDIDO_CONVERTED.csv",
        mimeType: "text/csv",
        version: "1",
        size: String(contents.csv.length),
        md5Checksum: createHash("md5").update(contents.csv).digest("hex"),
      },
    ],
    deployment: names.map((name, i) => ({
      id: `image-${i}`,
      name,
      mimeType: "image/png",
      version: "1",
      size: "10",
      md5Checksum: `pixels-${i}`,
      createdTime: "2026-01-01T00:00:00Z",
    })),
  };
  const downloads: string[] = [],
    listed: string[] = [];
  let failure = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "test-only", expires_in: 3600 });
    assert.equal(url.hostname, "www.googleapis.com");
    const id = url.pathname.split("/").at(-1)!;
    if (url.searchParams.get("alt") === "media") {
      downloads.push(id);
      assert.ok(contents[id]);
      return new Response(Uint8Array.from(contents[id]));
    }
    if (id === "root") return Response.json(folder("root", "Semana sintética"));
    const parent = url.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
    if (failure && parent === "deployment") {
      const status = failure;
      failure = 0;
      return Response.json({ error: {} }, { status });
    }
    assert.ok(parent && listings[parent]);
    listed.push(parent);
    return Response.json({ files: listings[parent] });
  });
  return {
    listings,
    contents,
    downloads,
    listed,
    failNext: (status: number) => {
      failure = status;
    },
  };
}
async function importNow(s: Setup, trigger: "manual" | "reprocess" = "manual") {
  const importId = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
    trigger,
  });
  await s.db.action(internal.qaVisual.importJob.run, { importId });
  const campaign = await s.db.run((ctx) => ctx.db.get(s.campaignId));
  assert.equal(campaign!.syncError, undefined);
  assert.equal(campaign!.activeImportId, undefined);
  return (await viewer(s))!;
}

test("the full import action reads 61 synthetic pieces, reuses unchanged sources and changes only one creative version", async (t) => {
  const s = await setup(t),
    drive = await syntheticDrive(t);
  await s.db.run((ctx) => ctx.db.delete(s.sourceId));
  const initial = await importNow(s);
  assert.equal(initial.pieces.length, 61);
  assert.equal(
    initial.pieces[15].requirements.find((r) => r.ruleId === "product")?.basis,
    "client",
  );
  assert.deepEqual(drive.downloads.sort(), ["csv", "excel"]);
  const repeat = await importNow(s);
  assert.equal(repeat.snapshotId, initial.snapshotId);
  assert.equal(drive.downloads.length, 2);
  assert.equal(
    (await s.db.run((ctx) => ctx.db.query("qaVisualImports").collect())).length,
    1,
  );
  const original = drive.listings.deployment[0];
  drive.listings.deployment[0] = {
    ...original,
    id: "replacement",
    md5Checksum: "new-pixels",
    createdTime: "2026-02-01T00:00:00Z",
  };
  const changed = await importNow(s);
  const replaced = changed.pieces.find(
    (p) => p.file.driveId === "replacement",
  )!;
  assert.equal(
    replaced.pieceId,
    initial.pieces.find((p) => p.file.driveId === original.id)!.pieceId,
  );
  assert.equal(replaced.version, 2);
  for (const p of changed.pieces.filter((p) => p !== replaced))
    assert.equal(
      p.pieceVersionId,
      initial.pieces.find((q) => q.file.driveId === p.file.driveId)!
        .pieceVersionId,
    );
  drive.downloads.length = 0;
  drive.listed.length = 0;
  await s.db.run(async (ctx) => {
    for (const source of await ctx.db.query("qaVisualSourceFiles").collect())
      await ctx.db.patch(source._id, { parserVersion: "old" });
  });
  await importNow(s, "reprocess");
  assert.deepEqual(drive.downloads, []);
  assert.deepEqual(drive.listed, ["deployment"]);
  assert.ok(
    (
      await s.db.run((ctx) => ctx.db.query("qaVisualSourceFiles").collect())
    ).every((source) => source.parserVersion === "5"),
  );
});

test("duplicate confirmations merge a three-file chain, persist on refresh and can be revoked without losing decisions", async (t) => {
  const s = await setup(t),
    drive = await syntheticDrive(t, 1);
  await s.db.run((ctx) => ctx.db.delete(s.sourceId));
  const a = drive.listings.deployment[0];
  drive.listings.deployment.push({
    ...a,
    id: "duplicate-b",
    md5Checksum: "b",
    createdTime: "2026-02-01T00:00:00Z",
  });
  const initial = await importNow(s);
  const b = initial.pieces.find((p) => p.file.driveId === "duplicate-b")!;
  await s.db.run(async (ctx) => {
    const decision = await ctx.db.insert("qaVisualDecisions", {
      campaignId: s.campaignId,
      pieceId: b.pieceId!,
      pieceVersionId: b.pieceVersionId!,
      decision: "approved",
      decidedBy: s.userId,
      aiSeen: { inputHash: b.contextKey, stale: false },
    });
    await ctx.db.patch(b.pieceVersionId!, { currentDecisionId: decision });
  });
  const override = await s.user.mutation(
    api.qaVisual.overrides.resolveDuplicate,
    {
      pieceId: b.pieceId!,
      expectedImportId: initial.snapshotId as Id<"qaVisualImports">,
      kind: "mergeAsVersion",
      otherDriveFileId: a.id,
      note: "La segunda entrega corrige la primera",
    },
  );
  async function runQueued() {
    const campaign = await s.db.run((ctx) => ctx.db.get(s.campaignId));
    assert.ok(campaign?.activeImportId);
    await s.db.action(internal.qaVisual.importJob.run, {
      importId: campaign.activeImportId,
    });
    return (await viewer(s))!;
  }
  const merged = await runQueued();
  assert.equal(merged.pieces.length, 1);
  assert.equal(merged.pieces[0].pieceVersionId, b.pieceVersionId);
  assert.equal(merged.pieces[0].version, 2);
  const stable = await importNow(s);
  assert.equal(stable.snapshotId, merged.snapshotId);
  await s.user.mutation(api.qaVisual.overrides.revoke, {
    overrideId: override,
  });
  const split = await runQueued();
  assert.equal(split.pieces.length, 2);
  const restored = split.pieces.find((p) => p.file.driveId === "duplicate-b")!;
  assert.equal(restored.pieceId, b.pieceId);
  assert.equal(restored.pieceVersionId, b.pieceVersionId);
  assert.ok(
    (await s.db.run((ctx) => ctx.db.get(restored.pieceVersionId!)))!
      .currentDecisionId,
  );
  await s.user.mutation(api.qaVisual.overrides.resolveDuplicate, {
    pieceId: restored.pieceId!,
    expectedImportId: split.snapshotId as Id<"qaVisualImports">,
    kind: "mergeAsVersion",
    otherDriveFileId: a.id,
    note: "Unir de nuevo",
  });
  await runQueued();
  drive.listings.deployment.push({
    ...a,
    id: "duplicate-c",
    md5Checksum: "c",
    createdTime: "2026-03-01T00:00:00Z",
  });
  const third = await importNow(s);
  const c = third.pieces.find((p) => p.file.driveId === "duplicate-c")!;
  await s.user.mutation(api.qaVisual.overrides.resolveDuplicate, {
    pieceId: c.pieceId!,
    expectedImportId: third.snapshotId as Id<"qaVisualImports">,
    kind: "mergeAsVersion",
    otherDriveFileId: "duplicate-b",
    note: "La tercera entrega corrige la segunda",
  });
  const chain = await runQueued();
  assert.equal(chain.pieces.length, 1);
  assert.equal(chain.pieces[0].file.driveId, "duplicate-c");
  assert.equal(chain.pieces[0].version, 3);
  const history = await s.user.query(api.qaVisual.editor.piece, {
    pieceId: chain.pieces[0].pieceId!,
  });
  assert.equal(history!.versions.length, 3);
  drive.listings.deployment = drive.listings.deployment.filter(
    (f) => f.id !== a.id,
  );
  const withoutOld = await importNow(s);
  assert.equal(withoutOld.pieces.length, 1);
  assert.equal(withoutOld.pieces[0].version, 3);
});

test("transient Drive failures retry, missing CSV is permanent and an empty inventory publishes resource notices", async (t) => {
  const s = await setup(t),
    drive = await syntheticDrive(t, 2);
  await s.db.run((ctx) => ctx.db.delete(s.sourceId));
  const initial = await importNow(s);
  drive.failNext(503);
  const request = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
  });
  await assert.rejects(
    s.db.action(internal.qaVisual.importJob.run, { importId: request }),
    /503/,
  );
  const failedAttempt = await s.db.run((ctx) => ctx.db.get(request));
  assert.equal(failedAttempt!.error!.code, "drive_unavailable");
  assert.equal((await viewer(s))!.snapshotId, initial.snapshotId);
  await s.db.action(internal.qaVisual.importJob.run, { importId: request });
  assert.equal((await viewer(s))!.snapshotId, initial.snapshotId);
  drive.listings.deployment = [
    { id: "video", name: "video.mp4", mimeType: "video/mp4", version: "1" },
  ];
  const empty = await importNow(s);
  assert.equal(empty.pieces.length, 0);
  assert.equal(empty.ignoredFiles.length, 1);
  assert.equal(empty.missingImages.length, 2);
  drive.listings.editables = [];
  const missing = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
  });
  await s.db.action(internal.qaVisual.importJob.run, { importId: missing });
  const failed = await s.db.run((ctx) => ctx.db.get(missing));
  assert.equal(failed!.status, "failed");
  assert.equal(failed!.error!.code, "csv_missing");
  assert.equal((await viewer(s))!.snapshotId, empty.snapshotId);
});

test("a failed staged version does not prevent an immediate retry on the same active piece", async (t) => {
  const s = await setup(t);
  await publish(s, [item("one")]);
  const current = (await viewer(s))!.pieces[0];
  const changed = item("one", "one.png", "changed", {
    key: "one",
    baseKey: "one",
    pieceId: current.pieceId!,
    disposition: "active",
    duplicate: false,
  });
  const failed = await begin(s, [changed]);
  await write(s, failed, [changed]);
  await s.db.mutation(internal.qaVisual.imports.fail, {
    ...failed,
    error: { code: "test", message: "test", retryable: true },
  });
  await publish(s, [changed]);
  assert.equal((await viewer(s))!.pieces[0].version, 2);
  await s.db.mutation(internal.qaVisual.imports.cleanup, {
    importId: failed.importId,
  });
  assert.equal((await viewer(s))!.pieces[0].version, 2);
});

test("same-name pieces can be individually selected for the existing analysis runner", async (t) => {
  const s = await setup(t);
  // Runs use qaVisualAnalysisPool (stage 4); the component must exist in the test backend.
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../node_modules/@convex-dev/workpool/dist/component/", import.meta.url);
  s.db.registerComponent(
    "qaVisualAnalysisPool",
    (await import(new URL("schema.js", root).href)).default,
    Object.fromEntries(
      (await readdir(root, { recursive: true }))
        .filter((name) => name.endsWith(".js"))
        .map((name) => [`./component/${name}`, () => import(new URL(name, root).href)]),
    ),
  );
  await publish(s, [item("one", "same.png"), item("two", "same.png")]);
  const visible = (await viewer(s))!;
  const started = await s.user.mutation(api.qaVisual.runs.start, {
    campaignId: s.campaignId,
    snapshotId: visible.snapshotId!,
    kind: "piece",
    pieceIds: [visible.pieces[1].pieceId!],
    requestId: crypto.randomUUID(),
  });
  assert.ok("runId" in started);
  const rows = await s.db.run((ctx) =>
    ctx.db.query("qaVisualReviews").collect(),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pieceVersionId, visible.pieces[1].pieceVersionId);
});

test("the real Workpool component accepts an import with its completion callback", async (t) => {
  const s = await setup(t, false),
    drive = await syntheticDrive(t, 0);
  await s.db.run((ctx) => ctx.db.delete(s.sourceId));
  const { readdir } = await import("node:fs/promises");
  const root = new URL(
    "../node_modules/@convex-dev/workpool/dist/component/",
    import.meta.url,
  );
  const componentModules = Object.fromEntries(
    (await readdir(root, { recursive: true }))
      .filter((name) => name.endsWith(".js"))
      .map((name) => [
        `./component/${name}`,
        () => import(new URL(name, root).href),
      ]),
  );
  const componentSchema = (await import(new URL("schema.js", root).href))
    .default;
  s.db.registerComponent(
    "qaVisualImportPool",
    componentSchema,
    componentModules,
  );
  const importId = await s.user.mutation(api.qaVisual.imports.request, {
    campaignId: s.campaignId,
  });
  const row = await s.db.run((ctx) => ctx.db.get(importId));
  assert.equal(row!.status, "queued");
  assert.ok(row!.workId);
  const status = await s.db.run((ctx) =>
    importPool.status(
      ctx,
      row!.workId as import("@convex-dev/workpool").WorkId,
    ),
  );
  assert.equal(status.state, "pending");
});

test("a late-arriving older duplicate is numbered before the already imported newer delivery", async (t) => {
  const s = await setup(t);
  const newer = item("new", "same.png", "new", {
    key: "same",
    baseKey: "same",
    disposition: "active",
    duplicate: false,
  });
  newer.file.createdAt = 20;
  await publish(s, [newer]);
  const older = item("old", "same.png", "old", {
    key: "same#old",
    baseKey: "same",
    duplicateOfKey: "same",
    disposition: "active",
    duplicate: true,
  });
  older.file.createdAt = 10;
  await publish(s, [older, newer]);
  const before = (await viewer(s))!.pieces;
  const target = before.find((p) => p.file.driveId === "new")!,
    source = before.find((p) => p.file.driveId === "old")!;
  const historical = {
    ...older,
    identity: {
      ...newer.identity,
      pieceId: target.pieceId!,
      sourceVersionId: source.pieceVersionId!,
      disposition: "historical" as const,
    },
  };
  const active = {
    ...newer,
    identity: { ...newer.identity, pieceId: target.pieceId! },
  };
  const request = await begin(s, [historical, active], undefined, [
    source.pieceId!,
  ]);
  await write(s, request, [historical, active]);
  await s.db.mutation(internal.qaVisual.imports.publish, request);
  const after = (await viewer(s))!.pieces;
  assert.equal(after.length, 1);
  assert.equal(after[0].version, 2);
  assert.equal(after[0].pieceVersionId, target.pieceVersionId);
  const detail = await s.user.query(api.qaVisual.editor.piece, {
    pieceId: target.pieceId!,
    version: 1,
  });
  assert.equal(detail!.versionId, source.pieceVersionId);
});

test("parser-upgrade rollout queues only outdated active campaigns and never duplicates active imports", async (t) => {
  const s = await setup(t);
  const published = await publish(s, [item("one")]);
  assert.equal(
    (await s.db.mutation(internal.qaVisual.imports.reprocessActive, {})).queued,
    0,
  );
  await s.db.run((ctx) =>
    ctx.db.patch(published.importId, { parserVersion: "old" }),
  );
  assert.equal(
    (await s.db.mutation(internal.qaVisual.imports.reprocessActive, {})).queued,
    1,
  );
  assert.equal(
    (await s.db.mutation(internal.qaVisual.imports.reprocessActive, {})).busy,
    1,
  );
  const campaign = await s.db.run((ctx) => ctx.db.get(s.campaignId));
  assert.equal(
    (await s.db.run((ctx) => ctx.db.get(campaign!.activeImportId!)))!.trigger,
    "parserUpgrade",
  );
});
