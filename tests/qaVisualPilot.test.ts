import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../convex/_generated/dataModel";
import { finishPiece, processPiece } from "../convex/qaVisual/pipeline";
import { attach } from "../convex/qaVisual/runs";
import type { MutationCtx } from "../convex/_generated/server";
import { workflow } from "../convex/workflows";

const reviewId = "review-test" as Id<"qaVisualReviews">;
const success = {
  kind: "success",
  findings: [],
  attempt: { provider: "openai", model: "test", code: "ok", elapsedMs: 1 },
};

function simulate(outcomes: Record<string, unknown>[]) {
  const providers: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const step = {
    async runMutation(_: unknown, args: Record<string, unknown>) {
      updates.push(args);
    },
    async runAction(_: unknown, args: { provider: string }) {
      providers.push(args.provider);
      return outcomes.shift();
    },
  } as unknown as Pick<WorkflowCtx, "runMutation" | "runAction">;
  return { step, providers, updates };
}

const temporaryFailure = {
  kind: "provider",
  retryable: true,
  attempt: {
    provider: "gemini",
    model: "test",
    code: "http_503",
    elapsedMs: 1,
  },
};

test("publishes the piece after Gemini retries and OpenAI succeeds", async () => {
  const { step, providers, updates } = simulate([
    temporaryFailure,
    temporaryFailure,
    temporaryFailure,
    success,
  ]);
  await processPiece(step, reviewId);
  assert.deepEqual(providers, ["gemini", "gemini", "gemini", "openai"]);
  assert.equal(updates.at(-1)?.status, "completed");
  assert.equal(updates.filter((update) => update.attempt).length, 4);
});

test("does not send missing inputs to another provider", async () => {
  const { step, providers, updates } = simulate([
    { kind: "input", message: "Falta imagen" },
  ]);
  await processPiece(step, reviewId);
  assert.deepEqual(providers, ["gemini"]);
  assert.equal(updates.at(-1)?.error, "Falta imagen");
});

test("records a terminal error when neither provider can finish", async () => {
  const permanentFailure = { ...temporaryFailure, retryable: false };
  const { step, providers, updates } = simulate([
    permanentFailure,
    permanentFailure,
  ]);
  await processPiece(step, reviewId);
  assert.deepEqual(providers, ["gemini", "openai"]);
  assert.equal(updates.at(-1)?.status, "failed");
});

test("keeps four review slots full without waiting for a batch or unprepared images", async (t) => {
  const runId = "run-test";
  const ids = Array.from({ length: 6 }, (_, i) => `review-${i + 1}`);
  const copyId = "image-copy";
  const rows = new Map<string, Record<string, unknown>>([
    [runId, { campaign: "test", state: "preparing", activeBatch: [], rollingQueue: true }],
    ...ids.map((id): [string, Record<string, unknown>] =>
      [id, { _id: id, campaign: "test", runId, status: "preparing" }]),
    [copyId, { campaign: "test", files: {} }],
  ]);
  const started: string[][] = [];
  t.mock.method(workflow, "start", async (_ctx: unknown, _definition: unknown, { ids }: { ids: string[] }) => {
    started.push(ids);
    return "workflow-test";
  });

  const ctx = {
    db: {
      async get(id: string) { return rows.get(id) ?? null; },
      async patch(id: string, changes: Record<string, unknown>) {
        Object.assign(rows.get(id)!, changes);
      },
      query() {
        return {
          withIndex(_index: string, filter: (q: unknown) => void) {
            const fields: [string, string][] = [];
            const range = { eq(key: string, value: string) { fields.push([key, value]); return range; } };
            filter(range);
            const selected = [...rows.values()].filter((row) => fields.every(([key, value]) => row[key] === value));
            return {
              async take(limit: number) { return selected.slice(0, limit); },
              async first() { return selected[0] ?? null; },
            };
          },
        };
      },
    },
  } as unknown as MutationCtx;
  const attachCopy = attach as unknown as {
    _handler(ctx: MutationCtx, args: { reviewId: string; copyId: string }): Promise<void>;
  };
  const finishReview = finishPiece as unknown as {
    _handler(ctx: MutationCtx, args: { context: { runId: string; reviewId: string } }): Promise<void>;
  };
  const attachImage = (reviewId: string) => attachCopy._handler(ctx, { reviewId, copyId });
  const finish = (reviewId: string) => finishReview._handler(ctx, { context: { runId, reviewId } });
  const [first, second, third, fourth, fifth, sixth] = ids;

  await attachImage(first);
  assert.deepEqual(started, [[first]]);
  for (const id of [second, third, fourth, fifth]) await attachImage(id);
  assert.deepEqual(started, [[first], [second], [third], [fourth]]);
  assert.deepEqual(rows.get(runId)?.activeBatch, [first, second, third, fourth]);
  assert.equal(rows.get(fifth)?.status, "queued");
  assert.equal(rows.get(sixth)?.status, "preparing");

  rows.get(second)!.status = "completed";
  await finish(second);
  assert.deepEqual(started, [[first], [second], [third], [fourth], [fifth]]);
  await finish(second);
  assert.deepEqual(rows.get(runId)?.activeBatch, [first, third, fourth, fifth]);

  await finish(fifth);
  assert.equal(rows.get(fifth)?.status, "failed");
  for (const id of [first, third, fourth]) {
    rows.get(id)!.status = "completed";
    await finish(id);
  }
  assert.equal(rows.get(runId)?.state, "running");
  assert.deepEqual(rows.get(runId)?.activeBatch, []);

  await attachImage(sixth);
  assert.deepEqual(started.at(-1), [sixth]);
  rows.get(sixth)!.status = "completed";
  await finish(sixth);
  assert.equal(rows.get(runId)?.state, "finished");
  assert.deepEqual(rows.get(runId)?.activeBatch, []);
});
