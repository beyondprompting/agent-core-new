import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { ActionCtx } from "../convex/_generated/server";
import { folderMime, type DriveFile } from "../convex/qaVisual/driveClient";
import { inspectDriveFolder } from "../convex/qaVisual/driveSource.node";
import { add, inspect } from "../convex/qaVisual/campaignRegistration";
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
      if (request.pathname.endsWith("/root")) return Response.json(root);
      const parent = request.searchParams.get("q")?.match(/^'([^']+)'/)?.[1];
      assert.ok(parent && parent in listings, "unexpected Drive request");
      return Response.json({ files: listings[parent] });
    },
  );
  return { listings, calls };
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
  assert.equal(
    result.checks.find((check) => check.key === "DESPLIEGUE")?.status,
    "missing",
  );
  d.listings.root.push(folder("deployment", "Despliegue"));
  const fixed = await inspectDriveFolder(url, { excelFileId: "excel-2" });
  assert.ok("folder" in fixed && fixed.ok);
  assert.equal(fixed.selection.excelFileId, "excel-2");
});

test("a source disappearing after inspection prevents registration instead of silently switching files", async (t) => {
  const d = drive(t);
  const preview = await inspectDriveFolder(url);
  assert.ok("folder" in preview && preview.ok);
  d.listings.resources = [{ ...excel, id: "replacement" }];
  const ctx = {
    runQuery: async () => true,
    runMutation: async () =>
      assert.fail("an unverified folder must not be registered"),
  } as unknown as ActionCtx;
  const action = add as unknown as {
    _handler(
      ctx: ActionCtx,
      args: { folderUrl: string; excelFileId?: string; csvFileId?: string },
    ): Promise<{ error?: string; inspection?: { ok: boolean } }>;
  };
  const result = await action._handler(ctx, {
    folderUrl: url,
    ...preview.selection,
  });
  assert.ok(result.error);
  assert.equal(result.inspection?.ok, false);
});

test("confirmed registration sends the inspected files to Convex and rejects a folder changed before confirmation", async (t) => {
  const d = drive(t);
  let writes = 0;
  const ctx = {
    runQuery: async () => true,
    runMutation: async (
      _fn: unknown,
      args: { driveFolderId: string; sourceSelection: unknown },
    ) => {
      writes++;
      assert.equal(args.driveFolderId, "root");
      assert.deepEqual(args.sourceSelection, {
        excelFileId: "excel",
        csvFileId: "csv",
      });
      return { status: "created", campaignId: "campaign" };
    },
  } as unknown as ActionCtx;
  const action = add as unknown as {
    _handler(
      ctx: ActionCtx,
      args: { folderUrl: string },
    ): Promise<{ name?: string; error?: string }>;
  };
  assert.equal(
    (await action._handler(ctx, { folderUrl: url })).name,
    root.name,
  );
  assert.equal(writes, 1);
  d.listings.editables = [];
  assert.ok((await action._handler(ctx, { folderUrl: url })).error);
  assert.equal(writes, 1);
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
