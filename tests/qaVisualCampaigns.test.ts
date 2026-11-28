import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { ActionCtx } from "../convex/_generated/server";
import { folderMime, type DriveFile } from "../convex/qaVisual/driveClient";
import { inspectDriveFolder } from "../convex/qaVisual/driveSource.node";
import {
  add,
  inspect,
  startDraft,
} from "../convex/qaVisual/campaignRegistration";
import { ANALYSIS_POLICY_VERSION } from "../convex/qaVisual/model/contracts";
import { summarizeCampaignPieces } from "../app/lib/qa-visual/campaign-model";

const folder = (id: string, name: string): DriveFile => ({
  id,
  name,
  mimeType: folderMime,
  capabilities: { canListChildren: true },
});
const root = folder("root", "Campaña de prueba");
const url = "https://drive.google.com/drive/folders/root";
const excel = {
  id: "excel",
  name: "MATRIZ.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  version: "1",
};
const csv = {
  id: "csv",
  name: "PEDIDO_CONVERTED.csv",
  mimeType: "text/csv",
  version: "1",
};
const image = {
  id: "image",
  name: "pieza.png",
  mimeType: "image/png",
  version: "1",
};
const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs8", format: "pem" });

function drive(t: TestContext) {
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
  const listings: Record<string, DriveFile[]> = {
    root: [
      folder("resources", "recursos"),
      folder("editables", "Editables"),
      folder("deployment", "DESPLIEGUE "),
    ],
    resources: [excel],
    editables: [csv],
    deployment: [image],
  };
  const calls: string[] = [];
  const metadata: Record<string, DriveFile> = { root };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL, init?: RequestInit) => {
      const request = new URL(String(input));
      if (request.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "test-only", expires_in: 3600 });
      assert.equal(request.hostname, "www.googleapis.com");
      assert.equal(
        init?.method ?? "GET",
        "GET",
        "inspecting folders must not write to Drive",
      );
      assert.notEqual(
        request.searchParams.get("alt"),
        "media",
        "inspection must not download file contents",
      );
      calls.push(request.pathname);
      const id = request.pathname.split("/").at(-1)!;
      if (metadata[id]) return Response.json(metadata[id]);
      const parent = request.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
      assert.ok(parent && parent in listings, "unexpected Drive request");
      return Response.json({ files: listings[parent] });
    },
  );
  return { listings, calls, metadata };
}

test("folder inspection is read-only, accepts normalized names and pins the selected sources", async (t) => {
  drive(t);
  let mutations = 0;
  const ctx = {
    runQuery: async () => true,
    runMutation: async () => {
      mutations++;
    },
  } as unknown as ActionCtx;
  const action = inspect as unknown as {
    _handler(
      ctx: ActionCtx,
      args: { folderUrl: string },
    ): ReturnType<typeof inspectDriveFolder>;
  };
  const result = await action._handler(ctx, { folderUrl: url });
  assert.ok("folder" in result && result.ok);
  assert.deepEqual(result.selection, {
    excelFileId: "excel",
    csvFileId: "csv",
  });
  assert.equal(result.images, 1);
  assert.equal(mutations, 0);
});

test("ambiguous sources and missing folders stay visible until the user resolves them", async (t) => {
  const d = drive(t);
  d.listings.resources.push({
    ...excel,
    id: "excel-2",
    name: "MATRIZ_v2.xlsx",
  });
  d.listings.root = d.listings.root.filter((file) => file.id !== "deployment");
  const result = await inspectDriveFolder(url);
  assert.ok("folder" in result);
  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.key === "RECURSOS")?.status,
    "choose",
  );
  // A missing folder is not a dead end: the user can pick another folder of the campaign.
  assert.equal(
    result.checks.find((check) => check.key === "DESPLIEGUE")?.status,
    "choose",
  );
  d.listings.root.push(folder("deployment", "Despliegue"));
  const fixed = await inspectDriveFolder(url, { excelFileId: "excel-2" });
  assert.ok("folder" in fixed && fixed.ok);
  assert.equal(fixed.selection.excelFileId, "excel-2");
});

/** Answers of the Convex functions an action calls, by function name. */
function actionCtx(
  answers: Record<string, (args: Record<string, unknown>) => unknown>,
  calls: string[] = [],
) {
  const answer = (fn: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(fn as Parameters<typeof getFunctionName>[0]);
    calls.push(name);
    const handler = answers[name];
    if (!handler) assert.fail(`unexpected call to ${name}`);
    return handler(args ?? {});
  };
  return {
    runQuery: async (fn: unknown, args: Record<string, unknown>) =>
      answer(fn, args),
    runMutation: async (fn: unknown, args: Record<string, unknown>) =>
      answer(fn, args),
  } as unknown as ActionCtx;
}
type Handler<A, R> = { _handler(ctx: ActionCtx, args: A): Promise<R> };
const draftAction = startDraft as unknown as Handler<
  { folderUrl: string; excelFileId?: string; csvFileId?: string },
  { campaignId?: string; error?: string; inspection?: { ok: boolean } }
>;
const addAction = add as unknown as Handler<
  { campaignId: string },
  { name?: string; error?: string; inspection?: { ok: boolean } }
>;
const noLinks = {
  "qaVisual/overrides:excludedKeys": () => [],
  "qaVisual/equivalences:forCampaign": () => [],
};

test("a source disappearing after inspection prevents saving the draft instead of silently switching files", async (t) => {
  const d = drive(t);
  const preview = await inspectDriveFolder(url);
  assert.ok("folder" in preview && preview.ok);
  d.listings.resources = [{ ...excel, id: "replacement" }];
  const result = await draftAction._handler(
    actionCtx({ "qaVisual/access:viewerIsQaAdmin": () => true }),
    { folderUrl: url, ...preview.selection },
  );
  assert.ok(result.error);
  assert.equal(result.inspection?.ok, false);
});

test("going to the pieces saves a draft with the inspected files, and «Crear campaña» activates it only if the folder still matches", async (t) => {
  const d = drive(t);
  const calls: string[] = [];
  const ctx = actionCtx(
    {
      "qaVisual/access:viewerIsQaAdmin": () => true,
      "qaVisual/campaigns:saveDraft": (args) => {
        assert.equal(args.driveFolderId, "root");
        assert.deepEqual(args.sourceSelection, {
          excelFileId: "excel",
          csvFileId: "csv",
        });
        return { status: "draft", campaignId: "campaign" };
      },
      "qaVisual/campaigns:getEditable": () => ({
        _id: "campaign",
        name: root.name,
        status: "draft",
        driveFolderId: "root",
      }),
      "qaVisual/campaigns:activate": (args) => {
        assert.deepEqual(args.sourceSelection, {
          excelFileId: "excel",
          csvFileId: "csv",
        });
        return { status: "created" };
      },
      ...noLinks,
    },
    calls,
  );
  const draft = await draftAction._handler(ctx, { folderUrl: url });
  assert.equal(draft.campaignId, "campaign");
  assert.ok(!calls.includes("qaVisual/campaigns:activate"));
  assert.equal(
    (await addAction._handler(ctx, { campaignId: "campaign" })).name,
    root.name,
  );
  assert.equal(
    calls.filter((name) => name === "qaVisual/campaigns:activate").length,
    1,
  );
  d.listings.editables = [];
  assert.ok((await addAction._handler(ctx, { campaignId: "campaign" })).error);
  assert.equal(
    calls.filter((name) => name === "qaVisual/campaigns:activate").length,
    1,
  );
});

test("an empty deployment can be registered, while more than 1000 images is a visible blocking check", async (t) => {
  const d = drive(t);
  d.listings.deployment = [];
  assert.equal((await inspectDriveFolder(url)).ok, true);
  d.listings.deployment = Array.from({ length: 1001 }, (_, i) => ({
    ...image,
    id: `image-${i}`,
  }));
  const result = await inspectDriveFolder(url);
  assert.ok("folder" in result);
  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.key === "DESPLIEGUE")?.status,
    "missing",
  );
});

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/qaVisual/campaigns.ts": () =>
    import("../convex/qaVisual/campaigns"),
  "../convex/qaVisual/campaignSnapshots.ts": () =>
    import("../convex/qaVisual/campaignSnapshots"),
  "../convex/qaVisual/overrides.ts": () =>
    import("../convex/qaVisual/overrides"),
  "../convex/qaVisual/equivalences.ts": () =>
    import("../convex/qaVisual/equivalences"),
  "../convex/qaVisual/mappingChoices.ts": () =>
    import("../convex/qaVisual/mappingChoices"),
};
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Revisora" });
    await ctx.db.insert("userAccessProfiles", {
      userId,
      platformRole: "super_admin",
      updatedAt: 1,
      updatedBy: userId,
    });
    const campaignId = await ctx.db.insert("qaVisualCampaigns", {
      name: "Actual",
      driveFolderId: "root",
      reviewKey: "campaign",
      status: "active",
      createdBy: userId,
    });
    const archivedId = await ctx.db.insert("qaVisualCampaigns", {
      name: "Archivada",
      driveFolderId: "archive",
      reviewKey: "archive",
      status: "archived",
      createdBy: userId,
    });
    const source = await ctx.db.insert("qaVisualSourceDocuments", {
      campaign: "campaign",
      name: "source",
      hash: "hash",
      storageId: await ctx.storage.store(new Blob(["source"])),
    });
    const snapshotId = await ctx.db.insert("qaVisualCampaignSnapshots", {
      campaignId,
      fingerprint: "snapshot",
      excelDocumentId: source,
      csvDocumentId: source,
      deploymentFolderId: "deployment",
      ruleVersion: "rules",
      rules: [],
      notices: ["Aviso común"],
    });
    await ctx.db.patch(campaignId, { currentSnapshotId: snapshotId });
    const ruleSetId = await ctx.db.insert("qaVisualRuleSets", {
      campaign: "campaign",
      version: "rules",
      rules: [],
    });
    const runId = await ctx.db.insert("qaVisualRuns", {
      campaign: "campaign",
      requestedBy: userId,
      ruleSetId,
      kind: "batch",
      state: "finished",
      requestId: "run",
    });
    return { userId, campaignId, archivedId, snapshotId, runId };
  });
  return { t, user: t.withIdentity({ subject: ids.userId }), ...ids };
}

test("campaign queries separate active and archived rows and reject unauthenticated access", async () => {
  const s = await setup();
  const args = {
    status: "active" as const,
    paginationOpts: { cursor: null, numItems: 12 },
  };
  await assert.rejects(s.t.query(api.qaVisual.campaigns.list, args));
  const active = await s.user.query(api.qaVisual.campaigns.list, args);
  const archived = await s.user.query(api.qaVisual.campaigns.list, {
    ...args,
    status: "archived",
  });
  assert.deepEqual(
    active.page.map((row) => row.name),
    ["Actual"],
  );
  assert.deepEqual(
    archived.page.map((row) => row.name),
    ["Archivada"],
  );
  assert.deepEqual(await s.user.query(api.qaVisual.campaigns.counts, {}), {
    active: { value: 1, more: false },
    archived: { value: 1, more: false },
  });
  await assert.rejects(
    s.user.mutation(api.qaVisual.campaignSnapshots.refresh, {
      campaignId: s.archivedId,
    }),
  );
});

test("a draft keeps what is decided about its pieces, stays out of the lists and the import, and can be discarded", async () => {
  const s = await setup();
  const draft = {
    name: "Borrador",
    driveFolderId: "draft-folder",
    reviewKey: "draft",
    sourceSelection: { excelFileId: "excel", csvFileId: "csv" },
  };
  const saved = await s.user.mutation(
    internal.qaVisual.campaigns.saveDraft,
    draft,
  );
  assert.equal(saved.status, "draft");
  const campaignId = saved.campaignId;
  // The same folder resumes its draft with the new sources; a registered folder is refused.
  const again = await s.user.mutation(internal.qaVisual.campaigns.saveDraft, {
    ...draft,
    sourceSelection: { excelFileId: "excel", csvFileId: "other" },
  });
  assert.equal(again.campaignId, campaignId);
  assert.equal(
    (
      await s.user.mutation(internal.qaVisual.campaigns.saveDraft, {
        ...draft,
        driveFolderId: "root",
      })
    ).status,
    "existing",
  );
  assert.deepEqual(
    (await s.user.query(api.qaVisual.campaigns.drafts, {})).map((d) => [
      d.name,
      d.sourceSelection.csvFileId,
    ]),
    [["Borrador", "other"]],
  );
  const listed = await s.user.query(api.qaVisual.campaigns.list, {
    status: "active",
    paginationOpts: { cursor: null, numItems: 12 },
  });
  assert.deepEqual(
    listed.page.map((row) => row.name),
    ["Actual"],
  );
  assert.equal(
    (await s.user.query(api.qaVisual.campaigns.counts, {})).active.value,
    1,
  );
  // Only the mapping functions accept a draft.
  await assert.rejects(
    s.user.query(api.qaVisual.campaigns.analysisInstructions, { campaignId }),
  );

  // Exclusions and equivalences are saved at once, without importing anything.
  await s.user.mutation(api.qaVisual.overrides.excludePieces, {
    campaignId,
    fileNames: ["logo.png"],
    note: "Es el logo",
  });
  await s.user.mutation(internal.qaVisual.equivalences.record, {
    campaignId,
    scope: "campaign",
    piece: "pieza.png",
    items: [{ column: "FORMATO_TIPO", csvValue: "POST", matrixValue: "Post" }],
  });
  assert.deepEqual(
    (await s.user.query(api.qaVisual.overrides.exclusions, { campaignId })).map(
      (row) => row.name,
    ),
    ["logo.png"],
  );
  assert.equal(
    (await s.user.query(api.qaVisual.equivalences.list, { campaignId })).items
      .length,
    1,
  );

  // Choices come back only on the CSV version they were made on.
  const file = { csvFileId: "csv", csvVersion: "7" };
  await s.user.mutation(api.qaVisual.mappingChoices.save, {
    campaignId,
    ...file,
    choices: [
      { piece: "pieza.png", csvLine: 4 },
      { piece: "otra.png", order: "12", mode: "csv" },
    ],
  });
  assert.equal(
    (
      await s.user.query(api.qaVisual.mappingChoices.get, {
        campaignId,
        ...file,
      })
    ).length,
    2,
  );
  assert.deepEqual(
    await s.user.query(api.qaVisual.mappingChoices.get, {
      campaignId,
      ...file,
      csvVersion: "8",
    }),
    [],
  );

  const stored = await s.t.run(async (ctx) => ({
    campaign: await ctx.db.get(campaignId),
    imports: await ctx.db.query("qaVisualImports").collect(),
  }));
  assert.equal(stored.campaign?.status, "draft");
  assert.equal(stored.campaign?.activeImportId, undefined);
  assert.equal(stored.imports.length, 0);

  // An active campaign is never discarded as a draft.
  await assert.rejects(
    s.user.mutation(api.qaVisual.campaigns.discardDraft, {
      campaignId: s.campaignId,
    }),
  );
  await s.user.mutation(api.qaVisual.campaigns.discardDraft, { campaignId });
  const left = await s.t.run(async (ctx) => ({
    campaign: await ctx.db.get(campaignId),
    overrides: await ctx.db.query("qaVisualLinkOverrides").collect(),
    equivalences: await ctx.db.query("qaVisualEquivalences").collect(),
    choices: await ctx.db.query("qaVisualMappingChoices").collect(),
  }));
  assert.deepEqual(left, {
    campaign: null,
    overrides: [],
    equivalences: [],
    choices: [],
  });
  assert.deepEqual(await s.user.query(api.qaVisual.campaigns.drafts, {}), []);
});

test("card totals include every current piece, excluding old hashes, old policies and superseded results", async () => {
  const s = await setup();
  const pieceIds = await s.t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const input = {
        name: `piece-${i}.png`,
        revision: 1,
        contextKey: "current",
        policyVersion: ANALYSIS_POLICY_VERSION,
        issues: [
          {
            id: "shared",
            code: "shared",
            severity: "info" as const,
            scope: "campaign" as const,
            affects: [],
            message: "Aviso común",
            sources: [],
          },
        ],
      };
      const importId = await ctx.db.insert("qaVisualCampaignPieces", {
        snapshotId: s.snapshotId,
        order: i,
        file: {
          name: input.name,
          bytes: 1,
          updatedAt: 1,
          driveId: `image-${i}`,
          driveVersion: "1",
          contentHash: "content",
        },
        input,
      });
      const pieceId = await ctx.db.insert("qaVisualPieces", {
        campaignId: s.campaignId,
        key: input.name,
        fileKey: input.name,
        driveFileId: `image-${i}`,
        status: "active",
        versionCount: 1,
      });
      const versionId = await ctx.db.insert("qaVisualPieceVersions", {
        campaignId: s.campaignId,
        pieceId,
        number: 1,
        contentHash: "content",
        driveFileId: `image-${i}`,
        driveVersion: "1",
        fileName: input.name,
        currentInputHash: "current",
        currentImportPieceId: importId,
      });
      const decisionId = await ctx.db.insert("qaVisualDecisions", {
        campaignId: s.campaignId,
        pieceId,
        pieceVersionId: versionId,
        decision: "approved",
        decidedBy: s.userId,
        aiSeen: { inputHash: i === 1 ? "old" : "current", stale: false },
      });
      await ctx.db.patch(versionId, { currentDecisionId: decisionId });
      await ctx.db.patch(pieceId, {
        currentVersionId: versionId,
        currentImportPieceId: importId,
      });
      await ctx.db.insert("qaVisualReviews", {
        runId: s.runId,
        campaign: "campaign",
        campaignId: s.campaignId,
        pieceId,
        pieceVersionId: versionId,
        input: {
          ...input,
          ...(i === 1 ? { contextKey: "old" } : {}),
          ...(i === 2 ? { policyVersion: "old" } : {}),
        },
        order: i,
        status: "completed",
        attempts: [],
        verdict: i === 3 ? "findings" : "validated",
      });
      if (i === 4)
        await ctx.db.insert("qaVisualReviews", {
          runId: s.runId,
          campaign: "campaign",
          pieceVersionId: versionId,
          input,
          order: i,
          status: "analyzing",
          attempts: [],
        });
      ids.push(pieceId);
    }
    return ids;
  });
  const first = await s.user.query(api.qaVisual.campaigns.pieceSummaries, {
    campaignId: s.campaignId,
    paginationOpts: { cursor: null, numItems: 2 },
  });
  assert.equal(first.isDone, false);
  const second = await s.user.query(api.qaVisual.campaigns.pieceSummaries, {
    campaignId: s.campaignId,
    paginationOpts: { cursor: first.continueCursor, numItems: 50 },
  });
  const totals = summarizeCampaignPieces(
    [...first.page, ...second.page],
    ["campaign:Aviso común"],
  );
  assert.deepEqual(totals, {
    pieces: 5,
    validated: 1,
    findings: 1,
    partial: 0,
    failed: 0,
    approved: 4,
    done: 2,
    notices: 1,
    // Approved by the team but not sent: none has the client's final approval yet.
    stages: {
      internal: 1,
      ready: 4,
      sent: 0,
      viewed: 0,
      clientChanges: 0,
      final: 0,
    },
  });
  await s.t.run((ctx) => ctx.db.patch(pieceIds[0], { status: "removed" }));
  const removed = await s.user.query(api.qaVisual.campaigns.pieceSummaries, {
    campaignId: s.campaignId,
    paginationOpts: { cursor: null, numItems: 50 },
  });
  assert.equal(removed.page.length, 4);
  assert.equal(summarizeCampaignPieces(removed.page, []).validated, 0);
});

test("a failed import preserves the published snapshot and stale callbacks are ignored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const before = await s.t.run((ctx) => ctx.db.get(s.campaignId));
  await s.t.mutation(internal.qaVisual.campaignSnapshots.fail, {
    campaignId: s.campaignId,
    startedAt: -1,
    error: "stale",
  });
  assert.equal(
    await s.t.mutation(internal.qaVisual.campaignSnapshots.progress, {
      campaignId: s.campaignId,
      startedAt: -1,
      stage: "publishing",
    }),
    false,
  );
  const after = await s.t.run((ctx) => ctx.db.get(s.campaignId));
  assert.deepEqual(after, before);
  const startedAt = await s.t.run(async (ctx) => {
    // A future scheduled job lets us inspect progress without running Drive.
    const jobId = await ctx.scheduler.runAfter(
      3_600_000,
      internal.qaVisual.campaignSync.run,
      { campaignId: s.campaignId, startedAt: 123 },
    );
    await ctx.db.patch(s.campaignId, {
      sync: { startedAt: 123, jobId, stage: "listing" },
    });
    return 123;
  });
  try {
    assert.equal(
      await s.t.mutation(internal.qaVisual.campaignSnapshots.progress, {
        campaignId: s.campaignId,
        startedAt,
        stage: "linking",
        images: 12,
      }),
      true,
    );
    const listing = await s.user.query(api.qaVisual.campaigns.list, {
      status: "active",
      paginationOpts: { cursor: null, numItems: 12 },
    });
    assert.equal(listing.page[0].syncing, true);
    assert.equal(listing.page[0].importStage, "linking");
    assert.equal(listing.page[0].importImages, 12);
    await s.t.mutation(internal.qaVisual.campaignSnapshots.fail, {
      campaignId: s.campaignId,
      startedAt,
      error: "Elegí una matriz",
      needsSources: true,
    });
    const failed = await s.user.query(api.qaVisual.campaigns.list, {
      status: "active",
      paginationOpts: { cursor: null, numItems: 12 },
    });
    assert.equal(failed.page[0].syncing, false);
    assert.equal(failed.page[0].needsSources, true);
    assert.equal(failed.page[0].imported, true);
    assert.equal(failed.page[0].snapshotId, s.snapshotId);
  } finally {
    await s.t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      for (const job of jobs) await ctx.scheduler.cancel(job._id);
    });
  }
});

test("every CSV of the production folder is a candidate and several ask for a choice", async (t) => {
  const d = drive(t);
  // Any name is accepted when the CSV is alone; Office lock files are not CSVs to choose.
  d.listings.editables = [
    { ...csv, id: "plain", name: "pedido final.csv" },
    { ...csv, id: "lock", name: "~$pedido final.csv" },
  ];
  let inspected = await inspectDriveFolder(url);
  assert.ok("selection" in inspected);
  assert.equal(inspected.selection.csvFileId, "plain");
  assert.equal(
    inspected.checks.find((c) => c.key === "EDITABLES")?.status,
    "ok",
  );

  // A _CONVERTED name no longer hides the other CSVs nor is preferred over them.
  d.listings.editables = [
    csv,
    { ...csv, id: "tests", name: "PEDIDO_CONVERTED_v1_PRUEBAS.csv" },
    { ...csv, id: "v10", name: "PEDIDO_CONVERTED_v10.csv" },
    {
      id: "sheet",
      name: "PEDIDO_CONVERTED_v1",
      mimeType: "application/vnd.google-apps.spreadsheet",
      version: "1",
    },
  ];
  inspected = await inspectDriveFolder(url);
  assert.ok("csvs" in inspected);
  assert.deepEqual(inspected.csvs.map((file) => file.id).sort(), [
    "csv",
    "tests",
    "v10",
  ]);
  assert.equal(inspected.selection.csvFileId, undefined);
  assert.equal(
    inspected.checks.find((c) => c.key === "EDITABLES")?.status,
    "choose",
  );

  inspected = await inspectDriveFolder(url, { csvFileId: "tests" });
  assert.ok("selection" in inspected);
  assert.equal(inspected.selection.csvFileId, "tests");
  assert.equal(
    inspected.checks.find((c) => c.key === "EDITABLES")?.status,
    "ok",
  );

  inspected = await inspectDriveFolder(url, { csvFileId: "gone" });
  assert.ok("checks" in inspected);
  assert.match(
    inspected.checks.find((c) => c.key === "EDITABLES")!.title,
    /ya no está disponible/,
  );
});

test("root and subfolder shortcuts resolve to readable folders and unsupported matrices give a conversion instruction", async (t) => {
  const d = drive(t);
  d.metadata.alias = {
    id: "alias",
    name: "Acceso",
    mimeType: "application/vnd.google-apps.shortcut",
    shortcutDetails: { targetId: "root", targetMimeType: folderMime },
  };
  d.metadata.target = folder("target", "Recursos reales");
  d.listings.root[0] = {
    id: "resources-shortcut",
    name: "RECURSOS",
    mimeType: "application/vnd.google-apps.shortcut",
    shortcutDetails: { targetId: "target", targetMimeType: folderMime },
  };
  d.listings.target = [excel];
  const resolved = await inspectDriveFolder(
    "https://drive.google.com/drive/folders/alias",
  );
  assert.ok("folder" in resolved && resolved.ok);
  assert.equal(resolved.folder.id, "root");
  d.listings.target = [
    {
      id: "sheet",
      name: "Matriz",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
  ];
  const unsupported = await inspectDriveFolder(url);
  assert.ok("checks" in unsupported && !unsupported.ok);
  assert.match(
    unsupported.checks.find((c) => c.key === "RECURSOS")!.detail!,
    /convertí.*xlsx/,
  );
  d.metadata.target = { ...d.metadata.target, trashed: true };
  const trashed = await inspectDriveFolder(url);
  assert.ok("checks" in trashed && !trashed.ok);
  assert.equal(
    trashed.checks.find((c) => c.key === "RECURSOS")!.status,
    "missing",
  );
});
