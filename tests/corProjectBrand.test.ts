import test from "node:test";
import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import { applyInboundProjectUpdate, reconcileProjectTaskBrands } from "../convex/data/corInboundSync";
import { markTrelloOutboundSyncSuccess, syncTaskBrandToTrello } from "../convex/data/trello";
import { trelloProvider } from "../convex/integrations/trelloProvider";

const category = { _id: "category", corClientId: 10, name: "Category" };
const brandB = { _id: "brandB", name: "Marca B", clientBrandId: category._id };
const after = {
  clientBrandId: category._id, brandId: 3, brandName: category.name,
  productId: 42, subBrandId: brandB._id, subBrandName: brandB.name,
};
const project = { _id: "project", corClientId: 10, corSyncStatus: "synced", name: "Project", ...after };
const old = { ...after, subBrandId: "brandA", subBrandName: "Marca A", productId: 41 };

test("a COR product change schedules inheritance, a repeated identical webhook does not", async () => {
  const current = { ...project, ...old };
  const scheduled: string[] = [];
  const ctx = {
    db: {
      get: async () => current,
      patch: async (_id: string, patch: any) => Object.assign(current, patch),
      query: (table: string) => ({ withIndex: () => ({ unique: () => table === "clientBrands" ? category : brandB }) }),
    },
    scheduler: { runAfter: async (_delay: number, ref: any) => scheduled.push(getFunctionName(ref)) },
  };
  const args = { projectId: project._id, corName: project.name, corBrandId: 3, corProductId: 42 };
  await (applyInboundProjectUpdate as any)._handler(ctx, args);
  await (applyInboundProjectUpdate as any)._handler(ctx, args);
  assert.deepEqual(scheduled, ["data/corInboundSync:reconcileProjectTaskBrands"]);
});

test("fan-out updates linked tasks once, retains prior brand for Trello and continues with the next page", async () => {
  const rows = [
    { _id: "one", ...old }, { _id: "two", ...old }, { _id: "already", ...after },
    { _id: "deleted", ...old, convexStatus: "deleted" }, { _id: "other", ...old, corClientId: 77 },
  ];
  const queued: any[] = [], pages: any[] = [], analytics: any[] = [];
  const ctx = {
    db: {
      get: async () => project,
      query: () => ({ withIndex: (_index: string, f: any) => {
        f({ eq: (field: string, id: string) => { assert.equal(field, "projectId"); assert.equal(id, project._id); } });
        return { paginate: () => ({ page: rows, isDone: false, continueCursor: "next" }) };
      } }),
      patch: (id: string, patch: any) => Object.assign(rows.find(t => t._id === id)!, patch),
    },
    runMutation: async (ref: any, args: any) => {
      if (getFunctionName(ref) === "analytics/jobs:record") { analytics.push(...args.sourceIds); return []; }
      queued.push(args);
    },
    scheduler: { runAfter: async (_delay: number, _ref: any, args: any) => pages.push(args) },
  };
  const run = () => (reconcileProjectTaskBrands as any)._handler(ctx, { projectId: project._id });
  await run();
  await run();
  assert.deepEqual(rows.map(t => t.subBrandId), ["brandB", "brandB", "brandB", "brandA", "brandA"]);
  assert.deepEqual(queued, ["one", "two"].map(taskId => ({ taskId, kind: "brand", previousSubBrandId: "brandA" })));
  assert.deepEqual(analytics, ["one", "two"]);
  assert.deepEqual(pages[0], { projectId: project._id, cursor: "next" });
});

test("brand replacement survives a partial failure and preserves unrelated card labels", async t => {
  const labels = new Set(["A", "urgent"]);
  const writes: string[] = [];
  t.mock.method(trelloProvider, "getCardLabels", async () => ({
    idBoard: "board", labels: [...labels].map(id => ({ id, name: id, idBoard: "board", color: null })),
  }));
  t.mock.method(trelloProvider, "addCardLabel", async (_card: string, id: string) => { writes.push("+" + id); labels.add(id); });
  let fail = true;
  t.mock.method(trelloProvider, "removeCardLabel", async (_card: string, id: string) => {
    if (fail) { fail = false; throw new Error("retry"); }
    writes.push("-" + id); labels.delete(id);
  });
  const context = { cardId: "card", desired: brandB as typeof brandB | null,
    categoryBoardId: "board", previous: [{ labelId: "A", name: "Marca A" }] };
  const ctx = { runQuery: () => context, runMutation: () => ({ status: "synced", labelId: "B" }) };
  const run = () => (syncTaskBrandToTrello as any)._handler(ctx, { taskId: "one", previousSubBrandIds: ["brandA"] });
  await assert.rejects(run(), /retry/);
  await run();
  await run();
  assert.deepEqual(writes, ["+B", "-A"]);
  assert.deepEqual([...labels], ["urgent", "B"]);
  context.desired = null;
  context.previous = [{ labelId: "B", name: "Marca B" }];
  await run();
  assert.deepEqual([...labels], ["urgent"]);
});

test("a newer project change received during Trello sync keeps its replacement queued", async () => {
  const item = { kind: "brand", brandRevision: 2, previousSubBrandIds: ["A", "B"], nextRunAt: 0 };
  let patch: any;
  const ctx = { db: { get: () => item, patch: (_id: string, fields: any) => { patch = fields; },
    query: () => ({ withIndex: () => ({ unique: () => null }) }) } };
  await (markTrelloOutboundSyncSuccess as any)._handler(ctx, { queueId: "queue", brandRevision: 1 });
  assert.equal(patch.status, "pending");
  assert.deepEqual(patch.previousSubBrandIds, ["A", "B"]);
  await (markTrelloOutboundSyncSuccess as any)._handler(ctx, { queueId: "queue", brandRevision: 2 });
  assert.equal(patch.status, "synced");
  assert.equal(patch.previousSubBrandIds, undefined);
});
