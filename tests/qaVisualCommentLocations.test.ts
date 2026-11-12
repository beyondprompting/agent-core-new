import assert from "node:assert/strict";
import { test } from "node:test";
import { completeCommentLocations, hasValidCommentRegion, imageBoxToRegion } from "../convex/qaVisual/commentLocations";
import { saveCommentLocations } from "../convex/qaVisual/runs";
import type { MutationCtx } from "../convex/_generated/server";

const control = {
  ruleId: "date", outcome: "fail" as const, observed: "Se observa JUEVES 22",
  visibleAnchor: null, region: null,
};
const dateBox = { x: 0.34, y: 0.08, width: 0.31, height: 0.08 };
const located = {
  ruleId: "date", status: "located" as const,
  visibleAnchor: "JUEVES 22", region: dateBox,
};

test("requests a focused location when the review omits coordinates", async () => {
  const [result] = await completeCommentLocations([control], async (targets) => {
    assert.deepEqual(targets, [{ ruleId: "date", observed: control.observed }]);
    return [located];
  });
  assert.deepEqual(result.region, dateBox);
  assert.equal(result.visibleAnchor, "JUEVES 22");
  assert.equal(result.locationStatus, "located");
  assert.equal(control.region, null);
});

test("reuses a valid location and repairs an out-of-bounds region", async () => {
  const [existing] = await completeCommentLocations([
    { ...control, region: dateBox, visibleAnchor: "JUEVES 22" },
  ], async () => assert.fail("A valid position needs no second request"));
  assert.equal(existing.locationStatus, "located");
  const [repaired] = await completeCommentLocations([
    { ...control, region: { ...dateBox, x: 5 }, visibleAnchor: "JUEVES 22" },
  ], async () => [located]);
  assert.deepEqual(repaired.region, dateBox);
  assert.equal(hasValidCommentRegion({ region: { ...dateBox, x: NaN }, visibleAnchor: "JUEVES 22" }), false);
});

test("rejects uncertain, mismatched or invalid positions so the existing retry policy can run", async () => {
  for (const locations of [
    [], [located, located], [{ ...located, ruleId: "unknown" }],
    [{ ...located, status: "uncertain" as const }],
    [{ ...located, region: { ...dateBox, height: 1 } }],
    [{ ...located, visibleAnchor: "" }],
  ]) {
    await assert.rejects(completeCommentLocations([control], async () => locations), /invalid_locations/);
  }
});

test("keeps an explicitly absent or unreadable element as a general comment", async () => {
  for (const status of ["absent", "unreadable"] as const) {
    const [result] = await completeCommentLocations([control], async () => [{
      ruleId: "date", status, region: null, visibleAnchor: null,
    }]);
    assert.equal(result.region, null);
    assert.equal(result.locationStatus, status);
  }
});

test("repairs an existing comment without replacing its observed text or the review verdict", async () => {
  const review = {
    status: "completed", verdict: "findings",
    findings: [{ ...control, expected: "22 de Octubre", source: "PRODUCCION!K16", severity: "warning" }],
  };
  const patches: Record<string, unknown>[] = [];
  const ctx = { db: {
    async get() { return review; },
    async patch(_id: unknown, values: Record<string, unknown>) { patches.push(values); },
  } } as unknown as MutationCtx;
  const handler = saveCommentLocations as unknown as {
    _handler(ctx: MutationCtx, args: unknown): Promise<number>;
  };
  const location = {
    ruleId: "date", observed: control.observed, region: dateBox,
    visibleAnchor: "JUEVES 22", locationStatus: "located",
  };
  assert.equal(await handler._handler(ctx, { reviewId: "test", locations: [location] }), 1);
  assert.deepEqual(Object.keys(patches[0]), ["findings"]);
  const findings = patches[0].findings as typeof review.findings;
  assert.equal(findings[0].observed, review.findings[0].observed);
  assert.equal(findings[0].expected, review.findings[0].expected);
  assert.equal(review.verdict, "findings");
  await assert.rejects(handler._handler(ctx, {
    reviewId: "test", locations: [{ ...location, observed: "Un comentario distinto" }],
  }), /invalid_locations/);
});


test("converts Gemini box_2d corners to viewer coordinates with the correct axis order", () => {
  assert.deepEqual(imageBoxToRegion([80, 340, 160, 650]), {
    x: 0.34, y: 0.08, width: 0.31, height: 0.08,
  });
  for (const box of [null, [], [80, 340, 80, 650], [80, 650, 160, 340],
    [-1, 340, 160, 650], [80, 340, 1001, 650], [0.08, 0.34, 0.16, 0.65]]) {
    assert.equal(imageBoxToRegion(box), null);
  }
});
