import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import http from "../convex/http";
import { pullProjectFromCORWorker } from "../convex/data/corInboundSync";

test("COR webhook authenticates Zap events and distinguishes queued and unmatched IDs", async () => {
  const previous = process.env.COR_ZAPIER_WEBHOOK_SECRET;
  const handler = (http.lookup("/cor/webhook", "POST")![0] as any)._handler;
  const calls: unknown[] = [];
  const ctx = {
    runMutation: async (ref: any, args: { event: string; corId: number }) => {
      assert.equal(getFunctionName(ref), "data/corWebhook:enqueue");
      calls.push(args);
      return args.event === "task.updated" ? 1 : 0;
    },
  };
  const post = (body: string, auth = "Bearer unit-test") => handler(ctx, new Request("https://example.convex.site/cor/webhook", {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body,
  }));
  try {
    delete process.env.COR_ZAPIER_WEBHOOK_SECRET;
    assert.equal((await post("{}")).status, 503);
    process.env.COR_ZAPIER_WEBHOOK_SECRET = "unit-test";
    assert.equal((await post("{}", "Bearer wrong")).status, 401);
    for (const invalid of ["{", "null", "[]", '{"event":"project.updated.","corId":1}', '{"event":"task.updated","corId":"12bad"}', '{"event":"task.updated","corId":0}']) {
      assert.equal((await post(invalid)).status, 400);
    }
    assert.equal(calls.length, 0);
    const task = await post(JSON.stringify({ event: "task.updated", corId: "12864020" }));
    assert.equal(task.status, 202);
    assert.deepEqual(await task.json(), { event: "task.updated", corId: 12864020, status: "queued", queued: 1 });
    const project = await post(JSON.stringify({ event: "project.updated", corId: 974202 }));
    assert.equal(project.status, 200);
    assert.equal((await project.json()).status, "no_local_match");
    const deletion = await post(JSON.stringify({ event: "project.deleted", corId: "974202" }));
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { event: "project.deleted", corId: 974202, status: "no_local_match", queued: 0 });
    assert.deepEqual(calls, [
      { event: "task.updated", corId: 12864020 }, { event: "project.updated", corId: 974202 },
      { event: "project.deleted", corId: 974202 },
    ]);
  } finally {
    if (previous === undefined) delete process.env.COR_ZAPIER_WEBHOOK_SECRET;
    else process.env.COR_ZAPIER_WEBHOOK_SECRET = previous;
  }
});

test("project deletion writes only for COR 204/404, ignores active samples and retries inconclusive reads", async t => {
  const old = { COR_API_KEY: process.env.COR_API_KEY, COR_CLIENT_SECRET: process.env.COR_CLIENT_SECRET };
  process.env.COR_API_KEY = "test";
  process.env.COR_CLIENT_SECRET = "test";
  let response = Response.json({ id: 22, name: "Active project", client_id: 1 });
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    if (String(input).includes("/oauth/token")) return Response.json({ access_token: "test" });
    assert.ok(String(input).endsWith("/projects/22"));
    reads++;
    return response;
  });
  const mutations: unknown[] = [];
  const ctx = {
    runQuery: async () => ({ corProjectId: 22, convexStatus: "active", corSyncStatus: "synced" }),
    runMutation: async (ref: any, args: any) => mutations.push([getFunctionName(ref), args]),
  };
  const run = (webhookCorId = 22) => (pullProjectFromCORWorker as any)._handler(ctx, {
    projectId: "local", webhookCorId, verifyDeletion: true,
  });
  try {
    await run(100);
    assert.equal(reads, 0);
    await run();
    for (const ambiguous of [new Response(""), new Response(null, { status: 403 }),
      new Response(null, { status: 503 }), Response.json({ id: 55 })]) {
      response = ambiguous;
      await assert.rejects(run());
    }
    assert.deepEqual(mutations, []);
    for (const status of [204, 404]) {
      response = new Response(null, { status });
      await run();
    }
    assert.deepEqual(mutations, [204, 404].map(() => [
      "data/corInboundSync:setProjectNotFoundInCOR", { projectId: "local", webhookCorId: 22, missing: true },
    ]));
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
