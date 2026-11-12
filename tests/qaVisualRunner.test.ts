import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir } from "node:fs/promises";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { fillSlots } from "../convex/qaVisual/runner";
import { nextAttempt } from "../convex/qaVisual/model/retryPolicy";
import { ANALYSIS_POLICY_VERSION } from "../convex/qaVisual/model/contracts";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/qaVisual/runner.ts": () => import("../convex/qaVisual/runner"),
};

test("retry policy: Gemini 3 times, then the fallback twice, fatal input stops", () => {
  const g = (code: string) => ({ provider: "gemini" as const, code });
  const o = (code: string) => ({ provider: "openai" as const, code });
  assert.deepEqual(nextAttempt([g("timeout")]), { provider: "gemini", delayMs: 2000 });
  assert.deepEqual(nextAttempt([g("timeout"), g("timeout"), g("timeout")]), {
    provider: "openai",
    delayMs: 0,
  });
  assert.equal(nextAttempt([g("timeout"), g("timeout"), g("timeout"), o("timeout"), o("timeout")]), null);
  assert.equal(nextAttempt([g("http_400")]), null);
  assert.deepEqual(nextAttempt([g("http_429")], 7000), { provider: "gemini", delayMs: 7000 });
});

test("a pool run starts at most 4 pieces and keeps the rest queued", async () => {
  const t = convexTest(schema, modules);
  const root = new URL("../node_modules/@convex-dev/workpool/dist/component/", import.meta.url);
  const componentModules = Object.fromEntries(
    (await readdir(root, { recursive: true }))
      .filter((name) => name.endsWith(".js"))
      .map((name) => [`./component/${name}`, () => import(new URL(name, root).href)]),
  );
  const componentSchema = (await import(new URL("schema.js", root).href)).default;
  t.registerComponent("qaVisualAnalysisPool", componentSchema, componentModules);
  const runId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "QA" });
    const ruleSetId = await ctx.db.insert("qaVisualRuleSets", {
      campaign: "c",
      version: "r",
      rules: [],
    });
    const runId = await ctx.db.insert("qaVisualRuns", {
      campaign: "c",
      requestedBy: userId,
      ruleSetId,
      kind: "batch",
      state: "running",
      runner: "pool",
      requestId: "req",
    });
    for (let order = 0; order < 6; order++)
      await ctx.db.insert("qaVisualReviews", {
        runId,
        campaign: "c",
        input: {
          name: `p${order}.png`,
          revision: 1,
          contextKey: `k${order}`,
          policyVersion: ANALYSIS_POLICY_VERSION,
        },
        order,
        status: "queued",
        attempts: [],
      });
    await fillSlots(ctx, runId);
    return runId;
  });
  const rows = await t.run((ctx) =>
    ctx.db
      .query("qaVisualReviews")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect(),
  );
  assert.equal(rows.filter((r) => r.status === "preparing" && r.workId).length, 4);
  assert.deepEqual(
    rows.filter((r) => r.status === "queued").map((r) => r.order),
    [4, 5],
  );
});
