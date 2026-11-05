import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../convex/_generated/dataModel";
import { processPiece } from "../convex/qaVisual/pipeline";

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
