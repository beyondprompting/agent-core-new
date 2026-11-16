import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { publishPiece } from "../convex/qaVisual/pieces";
import { ANALYSIS_POLICY_VERSION } from "../convex/qaVisual/model/contracts";
import { buildAnalysisFeed } from "../app/lib/qa-visual/analysis-feed";
import { buildPieceReview } from "../app/lib/qa-visual/piece-review";
import { toReviewPieces } from "../app/lib/qa-visual/piece-inventory";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/qaVisual/threads.ts": () => import("../convex/qaVisual/threads"),
  "../convex/qaVisual/decisions.ts": () =>
    import("../convex/qaVisual/decisions"),
  "../convex/qaVisual/editor.ts": () => import("../convex/qaVisual/editor"),
  "../convex/qaVisual/runs.ts": () => import("../convex/qaVisual/runs"),
  "../convex/qaVisual/campaignSnapshots.ts": () =>
    import("../convex/qaVisual/campaignSnapshots"),
  "../convex/qaVisual/imageCopies.ts": () =>
    import("../convex/qaVisual/imageCopies"),
  "../convex/qaVisual/clientPortal.ts": () =>
    import("../convex/qaVisual/clientPortal"),
  "../convex/qaVisual/clientReview.ts": () =>
    import("../convex/qaVisual/clientReview"),
};
const input = {
  name: "piece.png",
  revision: 1,
  contextKey: "input-1",
  contentHash: "image-1",
  requirementsHash: "request-1",
  policyVersion: ANALYSIS_POLICY_VERSION,
  requirements: [
    {
      ruleId: "product",
      status: "ready" as const,
      basis: "client" as const,
      expected: "FESTIN",
      sources: [],
      issueIds: [],
    },
  ],
  issues: [],
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Revisora",
      email: "reviewer@example.test",
    });
    const otherUser = await ctx.db.insert("users", {
      name: "Otra revisora",
      email: "other@example.test",
    });
    for (const id of [userId, otherUser])
      await ctx.db.insert("userAccessProfiles", {
        userId: id,
        platformRole: "super_admin",
        updatedAt: 1,
        updatedBy: id,
      });
    const campaignId = await ctx.db.insert("qaVisualCampaigns", {
      name: "QA",
      driveFolderId: "folder",
      reviewKey: "campaign",
      status: "active",
      createdBy: userId,
    });
    const storageId = await ctx.storage.store(new Blob(["source"]));
    const source = await ctx.db.insert("qaVisualSourceDocuments", {
      campaign: "campaign",
      name: "source",
      hash: "h",
      storageId,
    });
    const snapshotId = await ctx.db.insert("qaVisualCampaignSnapshots", {
      campaignId,
      fingerprint: "initial",
      excelDocumentId: source,
      csvDocumentId: source,
      deploymentFolderId: "deployment",
      ruleVersion: "rules",
      rules: [],
      notices: [],
      imageWarmupComplete: true,
    });
    await ctx.db.patch(campaignId, { currentSnapshotId: snapshotId });
    const itemId = await ctx.db.insert("qaVisualCampaignPieces", {
      snapshotId,
      order: 0,
      file: {
        name: "piece.png",
        bytes: 1,
        updatedAt: 1,
        driveId: "image",
        driveVersion: "1",
        contentHash: "image-1",
      },
      input,
    });
    const campaign = (await ctx.db.get(campaignId))!;
    const pieceId = await publishPiece(ctx, campaign, itemId, new Set(["image"]));
    const pieceVersionId = (await ctx.db.get(pieceId))!.currentVersionId!;
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
      snapshotId,
    });
    return {
      userId,
      otherUser,
      campaignId,
      pieceId,
      pieceVersionId,
      snapshotId,
      runId,
    };
  });
  return {
    t,
    ...ids,
    user: t.withIdentity({ subject: ids.userId }),
    other: t.withIdentity({ subject: ids.otherUser }),
  };
}

test("comments, replies, geometry and resolution survive independent queries and retries", async () => {
  const s = await setup();
  const args = {
    pieceVersionId: s.pieceVersionId,
    body: "Corregir el precio",
    anchor: { kind: "rect" as const, x: 0.2, y: 0.3, width: 0.2, height: 0.1 },
    requestId: "create-1",
  };
  const id = await s.user.mutation(api.qaVisual.threads.create, args);
  assert.equal(await s.user.mutation(api.qaVisual.threads.create, args), id);
  const reply = {
    pieceVersionId: s.pieceVersionId,
    threadId: id,
    body: "Revisado con cliente",
    requestId: "reply-1",
  };
  await s.other.mutation(api.qaVisual.threads.reply, reply);
  await s.other.mutation(api.qaVisual.threads.reply, reply);
  let data = (await s.other.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.threads.length, 1);
  assert.equal(data.threads[0].comments.length, 2);
  assert.deepEqual(data.threads[0].anchor, args.anchor);
  assert.equal(data.humanStatus, "En revisión");
  await s.user.mutation(api.qaVisual.threads.setResolved, {
    pieceVersionId: s.pieceVersionId,
    threadId: id,
    resolved: true,
  });
  await s.user.mutation(api.qaVisual.threads.setResolved, {
    pieceVersionId: s.pieceVersionId,
    threadId: id,
    resolved: true,
  });
  data = (await s.other.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.threads[0].status, "resolved");
  assert.equal(
    data.threads[0].comments.filter((c) => c.event === "resolved").length,
    1,
  );
  assert.equal(data.decision, null);
  const campaign = await s.other.query(api.qaVisual.campaignSnapshots.viewer, {
    campaignId: s.campaignId,
  });
  assert.equal(campaign?.pieces[0].threadCount, 1);
  assert.equal(campaign?.pieces[0].openThreads, 0);
  await assert.rejects(
    s.other.mutation(api.qaVisual.threads.edit, {
      commentId: data.threads[0].comments[0]._id,
      body: "Cambio ajeno",
    }),
    /Solo el autor/,
  );
  await s.user.mutation(api.qaVisual.threads.edit, {
    commentId: data.threads[0].comments[0]._id,
    body: "Corregir vigencia",
  });
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!
      .threads[0].comments[0].body,
    "Corregir vigencia",
  );
});

test("approval requires an exception without validated AI and rejects conflicting decisions", async () => {
  const s = await setup();
  const args = {
    pieceVersionId: s.pieceVersionId,
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: null,
    decision: "approved" as const,
  };
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, args),
    /justificación/,
  );
  const id = await s.user.mutation(api.qaVisual.decisions.decide, {
    ...args,
    exception: { reason: "other", note: "Revisión manual confirmada" },
  });
  await assert.rejects(
    s.other.mutation(api.qaVisual.decisions.decide, {
      ...args,
      exception: { reason: "other", note: "Otro criterio" },
    }),
    /Otra persona/,
  );
  const data = (await s.other.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.humanStatus, "Aprobada");
  assert.equal(data.threads.length, 0);
  assert.equal(data.decision?.decidedBy, s.userId);
  assert.equal(data.decision?.aiSeen.stale, true);
  assert.equal(data.decision?.aiSeen.inputHash, "input-1");
  assert.equal(data.decision?.outdated, false);
  await s.other.mutation(api.qaVisual.decisions.decide, {
    ...args,
    expectedCurrentDecisionId: id,
    decision: "revoked",
  });
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!
      .humanStatus,
    "En revisión",
  );
});

test("requesting changes always requires an explicit comment, even with existing open threads", async () => {
  const s = await setup();
  await s.user.mutation(api.qaVisual.threads.create, {
    pieceVersionId: s.pieceVersionId,
    body: "Una conversación previa no explica esta solicitud",
    anchor: { kind: "general" },
    requestId: "existing-thread",
  });
  const args = {
    pieceVersionId: s.pieceVersionId,
    decision: "changesRequested" as const,
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: null,
  };
  for (const note of [undefined, "", " \n\t "]) {
    await assert.rejects(
      s.user.mutation(api.qaVisual.decisions.decide, { ...args, note }),
      /comentario que explique qué cambios/,
    );
  }
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, {
      ...args,
      note: "x".repeat(4001),
    }),
    /entre 1 y 4000/,
  );
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.currentDecisionId, null);
  assert.equal(data.decisions.length, 0);
  assert.equal(data.threads.length, 1);
  const version = await s.t.run((ctx) => ctx.db.get(s.pieceVersionId));
  assert.equal(version?.openThreads, 1);
  assert.equal(version?.threadCount, 1);
});

test("a current approval cannot be recorded twice, with or without an exception", async () => {
  for (const manual of [false, true]) {
    const s = await setup();
    const reviewId = manual ? null : await finishPassingReview(s);
    const args = {
      pieceVersionId: s.pieceVersionId,
      decision: "approved" as const,
      expectedCurrentDecisionId: null,
      expectedInputHash: "input-1",
      expectedReviewId: reviewId,
      ...(manual ? { exception: { reason: "other" as const, note: "Verificada manualmente" } } : {}),
    };
    const id = await s.user.mutation(api.qaVisual.decisions.decide, args);
    await assert.rejects(
      s.other.mutation(api.qaVisual.decisions.decide, { ...args, expectedCurrentDecisionId: id }),
      /ya tiene una aprobación vigente/,
    );
    const data = (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!;
    assert.equal(data.decisions.length, 1);
    assert.equal(data.currentDecisionId, id);
    assert.equal(data.decision?.decidedBy, s.userId);

    const revoked = await s.user.mutation(api.qaVisual.decisions.decide, {
      ...args, decision: "revoked", expectedCurrentDecisionId: id,
    });
    const approved = await s.user.mutation(api.qaVisual.decisions.decide, { ...args, expectedCurrentDecisionId: revoked });
    assert.notEqual(approved, id);
  }
});

test("an approved version can receive changes and later be approved again", async () => {
  const s = await setup();
  const reviewId = await finishPassingReview(s);
  const args = {
    pieceVersionId: s.pieceVersionId, decision: "approved" as const,
    expectedCurrentDecisionId: null, expectedInputHash: "input-1", expectedReviewId: reviewId,
  };
  const approved = await s.user.mutation(api.qaVisual.decisions.decide, args);
  const changes = await s.other.mutation(api.qaVisual.decisions.decide, {
    ...args, decision: "changesRequested", expectedCurrentDecisionId: approved, note: "Ajustar el texto legal",
  });
  await s.user.mutation(api.qaVisual.decisions.decide, { ...args, expectedCurrentDecisionId: changes });
  const data = (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!;
  assert.equal(data.humanStatus, "Aprobada");
  assert.equal(data.decisions.length, 3);
  assert.equal(data.threads[0].comments[0].body, "Ajustar el texto legal");
});

test("an approval for an earlier input does not block approving the updated request", async () => {
  const s = await setup();
  const args = {
    pieceVersionId: s.pieceVersionId, decision: "approved" as const,
    expectedCurrentDecisionId: null, expectedInputHash: "input-1", expectedReviewId: null,
    exception: { reason: "other" as const, note: "Revisada manualmente" },
  };
  const previous = await s.user.mutation(api.qaVisual.decisions.decide, args);
  await s.t.run((ctx) => ctx.db.patch(s.pieceVersionId, { currentInputHash: "updated-request" }));
  const updated = await s.user.mutation(api.qaVisual.decisions.decide, {
    ...args, expectedCurrentDecisionId: previous, expectedInputHash: "updated-request",
  });
  assert.notEqual(updated, previous);
  const data = (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!;
  assert.equal(data.decisions.length, 2);
  assert.equal(data.decision?.outdated, false);
});

test("requesting changes atomically saves the explanation as a visible comment on the selected version", async () => {
  const s = await setup();
  const body = "Completar la fecha: debe decir 15 DE OCTUBRE";
  const args = {
    pieceVersionId: s.pieceVersionId,
    decision: "changesRequested" as const,
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: null,
    note: `  ${body}\n`,
  };
  const id = await s.user.mutation(api.qaVisual.decisions.decide, args);
  // A repeated submission with the old decision cannot create another comment.
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, args),
    /Otra persona/,
  );
  const data = (await s.other.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.humanStatus, "Cambios solicitados");
  assert.equal(data.currentDecisionId, id);
  assert.equal(data.decisions.length, 1);
  assert.equal(data.decision?.note, body);
  assert.equal(data.threads.length, 1);
  const thread = data.threads[0];
  assert.equal(thread.pieceVersionId, s.pieceVersionId);
  assert.equal(thread.status, "open");
  assert.equal(thread.audience, "internal");
  assert.equal(thread.commentCount, 1);
  assert.deepEqual(thread.anchor, { kind: "general" });
  assert.equal(thread.comments.length, 1);
  assert.equal(thread.comments[0].authorId, s.userId);
  assert.equal(thread.comments[0].body, body);
  const version = await s.t.run((ctx) => ctx.db.get(s.pieceVersionId));
  assert.equal(version?.openThreads, 1);
  assert.equal(version?.threadCount, 1);

  const pieces = toReviewPieces({
    matrix: null, csv: null, notices: [],
    pieces: [{ ...data.file!, pieceId: s.pieceId, currentVersion: 1 }],
  }, s.campaignId);
  const projection = buildPieceReview({
    pieces, currentPiece: pieces[0], version: 1, data,
    feed: buildAnalysisFeed([]), campaignId: s.campaignId,
    filter: "all", query: "", filters: [],
  });
  assert.equal(projection.visibleComments.length, 1);
  assert.equal(projection.visibleComments[0].body, body);
  assert.equal(projection.visibleComments[0].kind, "human");
  assert.equal(projection.visibleComments[0].threadId, thread._id);
  // The detailed view keeps the client status from the campaign feed (regression: it showed «Sin enviar»).
  const sent = { ...pieces[0], client: { state: "sent", clientVersion: 1, deliveryNumber: 1, internalAhead: false } as unknown as NonNullable<typeof pieces[0]["client"]> };
  const withClient = buildPieceReview({
    pieces: [sent], currentPiece: sent, version: 1, data,
    feed: buildAnalysisFeed([]), campaignId: s.campaignId,
    filter: "all", query: "", filters: [],
  });
  assert.equal(withClient.piece.client?.state, "sent");

  await s.user.mutation(api.qaVisual.decisions.decide, {
    ...args, decision: "revoked", expectedCurrentDecisionId: id, note: undefined,
  });
  const revoked = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(revoked.threads.length, 1);
  assert.equal(revoked.threads[0].comments[0].body, body);
});

test("a new image gets a new version with no inherited approval; renaming preserves identity", async () => {
  const s = await setup();
  await s.user.mutation(api.qaVisual.decisions.decide, {
    pieceVersionId: s.pieceVersionId,
    decision: "approved",
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: null,
    exception: { reason: "other", note: "Aprobada manualmente" },
  });
  const publish = async (
    name: string,
    hash: string,
    version: string,
    driveId = "image",
  ) =>
    s.t.run(async (ctx) => {
      const itemId = await ctx.db.insert("qaVisualCampaignPieces", {
        snapshotId: s.snapshotId,
        order: 1,
        file: {
          name,
          bytes: 2,
          updatedAt: 2,
          driveId,
          driveVersion: version,
          contentHash: hash,
        },
        input: {
          ...input,
          name,
          contentHash: hash,
          contextKey: hash === "image-1" ? "input-1" : "input-2",
        },
      });
      return publishPiece(
        ctx,
        (await ctx.db.get(s.campaignId))!,
        itemId,
        new Set([driveId]),
      );
    });
  assert.equal(await publish("renamed.png", "image-1", "2"), s.pieceId);
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!
      .humanStatus,
    "Aprobada",
  );
  assert.equal(
    await publish("renamed.png", "image-2", "3", "replacement-file"),
    s.pieceId,
  );
  const current = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(current.number, 2);
  assert.equal(current.humanStatus, "Pendiente");
  assert.equal(current.currentDecisionId, null);
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, {
      pieceId: s.pieceId,
      version: 1,
    }))!.humanStatus,
    "Aprobada",
  );
});

test("request changes preserve the old decision visibly but reject a decision based on stale inputs", async () => {
  const s = await setup();
  const args = {
    pieceVersionId: s.pieceVersionId,
    decision: "approved" as const,
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: null,
    exception: { reason: "other" as const, note: "Validado manualmente" },
  };
  const id = await s.user.mutation(api.qaVisual.decisions.decide, args);
  await s.t.run((ctx) =>
    ctx.db.patch(s.pieceVersionId, { currentInputHash: "new-request" }),
  );
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, {
      ...args,
      expectedCurrentDecisionId: id,
    }),
    /pedido o el análisis cambió/,
  );
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!
      .decision?.outdated,
    true,
  );
});

test("finding threads are created lazily and resolution does not change the AI result", async () => {
  const s = await setup();
  const reviewId = await s.t.run((ctx) =>
    ctx.db.insert("qaVisualReviews", {
      runId: s.runId,
      campaign: "campaign",
      campaignId: s.campaignId,
      pieceId: s.pieceId,
      pieceVersionId: s.pieceVersionId,
      input,
      order: 0,
      status: "completed",
      attempts: [],
      verdict: "findings",
      findings: [
        {
          ruleId: "product",
          outcome: "fail",
          expected: "FESTIN",
          observed: "Se ve OTRO",
          source: "K6",
          severity: "warning",
        },
      ],
    }),
  );
  assert.equal(
    (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!
      .threads.length,
    0,
  );
  const args = {
    pieceVersionId: s.pieceVersionId,
    finding: { reviewId, ruleId: "product" },
    resolved: true,
  };
  await s.user.mutation(api.qaVisual.threads.setResolved, args);
  await s.other.mutation(api.qaVisual.threads.setResolved, args);
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.threads.length, 1);
  assert.equal(data.review?.verdict, "findings");
  const dashboard = await s.other.query(api.qaVisual.runs.dashboard, {
    campaignId: s.campaignId,
    inputs: [],
  });
  const feed = buildAnalysisFeed(dashboard!.reviews);
  assert.equal(feed.comments[0].resolved, true);
  assert.equal(feed.comments[0].threadId, data.threads[0]._id);
  assert.equal(feed.results[s.pieceId][1], "findings");
});

test("access, cross-version references and geometry are validated on the server", async () => {
  const s = await setup();
  await assert.rejects(
    s.t.mutation(api.qaVisual.threads.create, {
      pieceVersionId: s.pieceVersionId,
      body: "Texto",
      anchor: { kind: "general" },
      requestId: "unauthorized",
    }),
    /Acceso denegado/,
  );
  await assert.rejects(
    s.user.mutation(api.qaVisual.threads.create, {
      pieceVersionId: s.pieceVersionId,
      body: "Texto",
      anchor: { kind: "rect", x: 0.9, y: 0.5, width: 0.5, height: 0.2 },
      requestId: "bad-geometry",
    }),
    /fuera de la imagen/,
  );
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, {
      pieceVersionId: s.pieceVersionId,
      decision: "changesRequested",
      expectedCurrentDecisionId: null,
      expectedInputHash: "input-1",
      expectedReviewId: null,
    }),
    /comentario que explique qué cambios/,
  );
});

test("a failed reanalysis cannot reuse an older validated result to approve without exception", async () => {
  const s = await setup();
  const reviewId = await s.t.run(async (ctx) => {
    const base = {
      runId: s.runId,
      campaign: "campaign",
      campaignId: s.campaignId,
      pieceId: s.pieceId,
      pieceVersionId: s.pieceVersionId,
      input,
      order: 0,
      attempts: [],
    };
    const id = await ctx.db.insert("qaVisualReviews", {
      ...base,
      status: "completed",
      verdict: "validated",
      findings: [],
      result: {
        verdict: "validated",
        coverage: {
          requested: 1,
          executed: 1,
          pass: 1,
          fail: 0,
          unverifiable: 0,
          notApplicable: 0,
          modelControls: 1,
          productionBasis: 0,
          conflicts: 0,
        },
      },
    });
    await ctx.db.insert("qaVisualReviews", {
      ...base,
      status: "failed",
      error: "Proveedor no disponible",
    });
    return id;
  });
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.latestStatus, "failed");
  assert.equal(data.review?._id, reviewId);
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, {
      pieceVersionId: s.pieceVersionId,
      expectedCurrentDecisionId: null,
      expectedReviewId: reviewId,
      expectedInputHash: "input-1",
      decision: "approved",
    }),
    /justificación/,
  );
});

async function finishPassingReview(
  s: Awaited<ReturnType<typeof setup>>,
  changes: Partial<Doc<"qaVisualReviews">["input"]> = {},
) {
  const reviewId = await s.t.run((ctx) =>
    ctx.db.insert("qaVisualReviews", {
      runId: s.runId,
      campaign: "campaign",
      campaignId: s.campaignId,
      pieceId: s.pieceId,
      pieceVersionId: s.pieceVersionId,
      input: { ...input, ...changes },
      order: 0,
      status: "analyzing",
      attempts: [],
    }),
  );
  await s.t.mutation(internal.qaVisual.runs.update, {
    reviewId,
    status: "completed",
    findings: [
      {
        ruleId: "product",
        outcome: "pass",
        method: "model",
        modelRead: true,
        observed: "FESTIN",
        expected: "FESTIN",
        source: "K6",
        severity: "warning",
      },
    ],
  });
  return reviewId;
}

test("persisted source warnings prevent green in the editor, campaign and approval mutation", async () => {
  const s = await setup();
  const reviewId = await finishPassingReview(s, {
    issues: [
      {
        id: "partial-name",
        code: "offer_name_partial",
        severity: "warning",
        scope: "piece",
        affects: ["product"],
        message: "Confirmar vinculación",
        sources: [],
      },
    ],
  });
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.review?.result?.verdict, "partial");
  assert.equal(data.review?.result?.coverage.blockingNotices, 1);
  assert.equal(data.review?.result?.reason, "Vinculación por confirmar");
  const dashboard = (await s.user.query(api.qaVisual.runs.dashboard, {
    campaignId: s.campaignId,
    inputs: [],
  }))!;
  assert.equal(dashboard.validated, 0);
  assert.equal(dashboard.partial, 1);
  assert.equal(
    buildAnalysisFeed(dashboard.reviews).results[s.pieceId][1],
    "partial",
  );
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, {
      pieceVersionId: s.pieceVersionId,
      decision: "approved",
      expectedCurrentDecisionId: null,
      expectedInputHash: input.contextKey,
      expectedReviewId: reviewId,
    }),
    /justificación/,
  );
});

test("completed results from a previous policy are stale before reimport and require an approval exception", async () => {
  const s = await setup();
  const reviewId = await finishPassingReview(s, {
    policyVersion: "qa-visual-3",
  });
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.latestStatus, "stale");
  assert.equal(data.previousVerdict, "validated");
  const dashboard = (await s.user.query(api.qaVisual.runs.dashboard, {
    campaignId: s.campaignId,
    inputs: [],
  }))!;
  assert.equal(dashboard.validated, 0);
  assert.equal(dashboard.stale, 1);
  const feed = buildAnalysisFeed(dashboard.reviews);
  const pieces = toReviewPieces(
    {
      matrix: null,
      csv: null,
      notices: [],
      pieces: [{ ...data.file!, pieceId: s.pieceId, currentVersion: 1 }],
    },
    s.campaignId,
  );
  const projection = buildPieceReview({
    pieces,
    currentPiece: pieces[0],
    version: 1,
    data,
    feed,
    campaignId: s.campaignId,
    filter: "all",
    query: "",
    filters: [],
  });
  assert.equal(projection.aiReview.status, "stale");
  assert.equal(projection.aiReview.tone, "neutral");
  assert.match(projection.aiReview.detail, /Resultado anterior: validada/);
  assert.equal(projection.requiresException, true);
  const args = {
    pieceVersionId: s.pieceVersionId,
    decision: "approved" as const,
    expectedCurrentDecisionId: null,
    expectedInputHash: input.contextKey,
    expectedReviewId: reviewId,
  };
  await assert.rejects(
    s.user.mutation(api.qaVisual.decisions.decide, args),
    /justificación/,
  );
  await s.user.mutation(api.qaVisual.decisions.decide, {
    ...args,
    exception: { reason: "other", note: "Revisada manualmente" },
  });
  const approved = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(approved.decision?.aiSeen.stale, true);
  assert.equal(approved.decision?.aiSeen.status, "stale");
});

test("changing a piece's input makes its previous green result stale in the campaign and editor", async () => {
  const s = await setup();
  await finishPassingReview(s);
  await s.t.run(async (ctx) => {
    const version = (await ctx.db.get(s.pieceVersionId))!;
    const item = (await ctx.db.get(version.currentImportPieceId))!;
    await ctx.db.patch(version._id, { currentInputHash: "changed-request" });
    await ctx.db.patch(item._id, {
      input: { ...item.input, contextKey: "changed-request" },
    });
  });
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.latestStatus, "stale");
  assert.equal(data.previousVerdict, "validated");
  const dashboard = (await s.user.query(api.qaVisual.runs.dashboard, {
    campaignId: s.campaignId,
    inputs: [],
  }))!;
  assert.equal(dashboard.validated, 0);
  assert.equal(dashboard.stale, 1);
  assert.equal(
    buildAnalysisFeed(dashboard.reviews).results[s.pieceId][1],
    "stale",
  );
});

test("a current completed review with full model coverage still permits normal approval", async () => {
  const s = await setup();
  const reviewId = await finishPassingReview(s);
  const data = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(data.latestStatus, "completed");
  assert.equal(data.review?.result?.verdict, "validated");
  await s.user.mutation(api.qaVisual.decisions.decide, {
    pieceVersionId: s.pieceVersionId,
    decision: "approved",
    expectedCurrentDecisionId: null,
    expectedInputHash: input.contextKey,
    expectedReviewId: reviewId,
  });
  const approved = (await s.user.query(api.qaVisual.editor.piece, {
    pieceId: s.pieceId,
  }))!;
  assert.equal(approved.decision?.exception, undefined);
  assert.equal(approved.decision?.aiSeen.stale, false);
});

test("every client comment or reply is recorded as a change request, even after an approval", async () => {
  const s = await setup();
  const { externalId, itemId } = await s.t.run(async (ctx) => {
    const externalId = await ctx.db.insert("users", { name: "Cliente", email: "client@example.test" });
    const clientId = await ctx.db.insert("corClients", { corClientId: 1, name: "Cliente", syncedAt: 1 });
    await ctx.db.insert("approvedExternalUsers", {
      email: "client@example.test",
      userId: externalId,
      workRole: "pieceApproval",
      createdAt: 1,
    });
    await ctx.db.insert("clientUserAssignments", { clientId, userId: externalId, assignedAt: 1 });
    await ctx.db.patch(s.campaignId, {
      client: { clientId },
      clientReview: { enabled: true, agencyLabel: "PTO99", briefFields: [] },
    });
    const deliveryId = await ctx.db.insert("qaVisualDeliveries", {
      campaignId: s.campaignId,
      number: 1,
      status: "published",
      createdBy: s.userId,
      publishedAt: 1,
      itemCount: 1,
      requestId: "round-1",
    });
    const itemId = await ctx.db.insert("qaVisualDeliveryItems", {
      deliveryId,
      campaignId: s.campaignId,
      pieceId: s.pieceId,
      pieceVersionId: s.pieceVersionId,
      order: 0,
      clientVersion: 1,
      status: "active",
      brief: { title: "Pieza", format: "Post", fields: [] },
      clientState: "sent",
      publishedAt: 1,
    });
    return { externalId, itemId };
  });
  const client = s.t.withIdentity({ subject: externalId });
  const state = () => s.t.run(async (ctx) => (await ctx.db.get(itemId))!);

  const threadId = await client.mutation(api.qaVisual.clientPortal.createComment, {
    itemId,
    anchor: { kind: "rect", x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    body: "Cambiar el precio",
    requestId: "c1",
  });
  const afterComment = await state();
  assert.equal(afterComment.clientState, "changesRequested");
  assert.ok(afterComment.currentDecisionId);

  // A second comment does not stack another decision.
  await client.mutation(api.qaVisual.clientPortal.createComment, {
    itemId, anchor: { kind: "general" }, body: "Y el logo", requestId: "c2",
  });
  assert.equal((await state()).currentDecisionId, afterComment.currentDecisionId);

  await client.mutation(api.qaVisual.clientPortal.decide, {
    itemId, decision: "approved", expectedDecisionId: afterComment.currentDecisionId!,
  });
  assert.equal((await state()).clientState, "approved");

  // Replying after approving reopens the piece as a change request.
  await client.mutation(api.qaVisual.clientPortal.reply, { threadId, body: "Falta esto", requestId: "r1" });
  const afterReply = await state();
  assert.equal(afterReply.clientState, "changesRequested");
  const decisions = await s.t.run((ctx) =>
    ctx.db.query("qaVisualClientDecisions").withIndex("by_item", (q) => q.eq("deliveryItemId", itemId)).collect(),
  );
  assert.deepEqual(decisions.map((d) => d.decision), ["changesRequested", "approved", "changesRequested"]);
});

test("a piece with AI, team and client approval cannot be sent again until one of them changes", async () => {
  const s = await setup();
  const reviewId = await finishPassingReview(s);
  await s.user.mutation(api.qaVisual.decisions.decide, {
    pieceVersionId: s.pieceVersionId,
    decision: "approved",
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-1",
    expectedReviewId: reviewId,
  });
  const externalId = await s.t.run(async (ctx) => {
    const externalId = await ctx.db.insert("users", { name: "Cliente", email: "client@example.test" });
    const clientId = await ctx.db.insert("corClients", { corClientId: 1, name: "Cliente", syncedAt: 1 });
    await ctx.db.insert("approvedExternalUsers", {
      email: "client@example.test", userId: externalId, workRole: "pieceApproval", createdAt: 1,
    });
    await ctx.db.insert("clientUserAssignments", { clientId, userId: externalId, assignedAt: 1 });
    await ctx.db.patch(s.campaignId, {
      client: { clientId },
      clientReview: { enabled: true, agencyLabel: "PTO99", briefFields: [] },
    });
    return externalId;
  });
  const client = s.t.withIdentity({ subject: externalId });
  const preview = () => s.user.query(api.qaVisual.clientReview.deliveryPreview, { campaignId: s.campaignId });
  const send = (requestId: string) =>
    s.user.mutation(api.qaVisual.clientReview.publishDelivery, {
      campaignId: s.campaignId, pieceVersionIds: [s.pieceVersionId], requestId,
    });
  const item = () =>
    s.t.run(async (ctx) =>
      (await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_version", (q) => q.eq("pieceVersionId", s.pieceVersionId))
        .collect()).find((i) => i.status === "active")!,
    );

  assert.equal((await preview()).eligible.length, 1);
  await send("round-1");
  // While the client reviews it, it is neither eligible nor listed as blocked.
  assert.equal((await preview()).eligible.length, 0);
  assert.equal((await preview()).blocked.length, 0);
  await assert.rejects(send("round-1b"), /ya no se puede enviar/);

  const sent = await item();
  await client.mutation(api.qaVisual.clientPortal.decide, {
    itemId: sent._id, decision: "approved", expectedDecisionId: null,
  });
  const full = await preview();
  assert.equal(full.eligible.length, 0);
  assert.match(full.blocked[0].reason, /3 aprobaciones/);
  await assert.rejects(send("round-2"), /ya no se puede enviar/);

  // The client asks for a change: this version can't go back nor be approved again.
  await client.mutation(api.qaVisual.clientPortal.createComment, {
    itemId: sent._id, anchor: { kind: "general" }, body: "Cambiar el precio a 6,99", requestId: "c1",
  });
  const rejected = await preview();
  assert.equal(rejected.eligible.length, 0);
  assert.match(rejected.blocked[0].reason, /pidió cambios en esta versión/);
  await assert.rejects(send("round-3"), /ya no se puede enviar/);

  // A new image in Drive is version 2, with its own AI, team and client approvals.
  const v2PieceId = await s.t.run(async (ctx) => {
    const itemId = await ctx.db.insert("qaVisualCampaignPieces", {
      snapshotId: s.snapshotId,
      order: 0,
      file: { name: "piece.png", bytes: 2, updatedAt: 2, driveId: "image", driveVersion: "2", contentHash: "image-2" },
      input: { ...input, contentHash: "image-2", contextKey: "input-2" },
    });
    return publishPiece(ctx, (await ctx.db.get(s.campaignId))!, itemId, new Set(["image"]));
  });
  assert.equal(v2PieceId, s.pieceId);
  const v2 = (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!;
  assert.notEqual(v2.versionId, s.pieceVersionId);
  assert.equal(v2.humanStatus, "Pendiente");
  // The client's ask travels with version 2 (and to its AI analysis).
  assert.deepEqual(v2.clientAsks?.asks, ["Cambiar el precio a 6,99"]);
  const v1 = v2.versions.find((v) => v.number === 1)!;
  assert.equal(v1.humanStatus, "Aprobada");
  assert.equal(v1.client?.state, "changesRequested");
  assert.match((await preview()).blocked[0].reason, /Sin aprobación interna/);

  await s.user.mutation(api.qaVisual.decisions.decide, {
    pieceVersionId: v2.versionId,
    decision: "approved",
    expectedCurrentDecisionId: null,
    expectedInputHash: "input-2",
    expectedReviewId: null,
    exception: { reason: "other", note: "Revisada a mano" },
  });
  assert.equal((await preview()).eligible.length, 1);
  await s.user.mutation(api.qaVisual.clientReview.publishDelivery, {
    campaignId: s.campaignId, pieceVersionIds: [v2.versionId], requestId: "round-4",
  });
  const second = await s.t.run(async (ctx) =>
    (await ctx.db
      .query("qaVisualDeliveryItems")
      .withIndex("by_version", (q) => q.eq("pieceVersionId", v2.versionId))
      .collect())[0],
  );
  assert.equal(second.clientVersion, 2);
  // Version 1 keeps its own history.
  assert.equal((await s.t.run((ctx) => ctx.db.get(sent._id)))!.clientState, "changesRequested");
});

test("several pieces can be approved at once without overwriting decisions", async () => {
  const s = await setup();
  const approveMany = (exception?: { reason: "other"; note: string }) =>
    s.user.mutation(api.qaVisual.decisions.approveMany, {
      campaignId: s.campaignId,
      pieceVersionIds: [s.pieceVersionId],
      ...(exception ? { exception } : {}),
    });
  // Not validated by the AI: needs a shared justification.
  const first = await approveMany();
  assert.equal(first.approved, 0);
  assert.match(first.skipped[0].reason, /justificación/);
  const second = await approveMany({ reason: "other", note: "Revisadas en conjunto" });
  assert.equal(second.approved, 1);
  const third = await approveMany({ reason: "other", note: "Otra vez" });
  assert.equal(third.approved, 0);
  assert.match(third.skipped[0].reason, /Ya estaba aprobada/);
  const data = (await s.user.query(api.qaVisual.editor.piece, { pieceId: s.pieceId }))!;
  assert.equal(data.humanStatus, "Aprobada");
  assert.equal(data.decision?.exception?.note, "Revisadas en conjunto");
});
