import assert from "node:assert/strict";
import { test } from "node:test";
import {
  carouselOrder,
  clientFilterState,
  hasFinalApproval,
  matchesPieceFilters,
  needsAttention,
  type PieceFilterFacts,
} from "../app/lib/qa-visual/piece-filters";
import { finalApprovalState } from "../app/lib/qa-visual/client-state";
import type { PieceClientStatus } from "../convex/qaVisual/clientReview";

const client = (state: PieceClientStatus["state"], internalAhead = false) =>
  ({
    itemId: "item",
    state,
    clientVersion: 1,
    deliveryNumber: 1,
    at: 0,
    pieceVersionId: "version",
    internalAhead,
    changedAfterApproval: state === "approved" && internalAhead,
  }) as unknown as PieceClientStatus;

const facts = (over: Partial<PieceFilterFacts> = {}): PieceFilterFacts => ({
  ai: "validated",
  human: "Pendiente",
  client: null,
  ...over,
});

test("final approval requires the client to approve the current version", () => {
  assert.equal(hasFinalApproval(client("approved")), true);
  assert.equal(hasFinalApproval(client("approved", true)), false);
  assert.equal(hasFinalApproval(client("sent")), false);
  assert.equal(hasFinalApproval(null), false);
  assert.equal(clientFilterState(client("approved", true)), "outdated");
  assert.equal(clientFilterState(client("viewed")), "sent");
});

test("attention covers AI findings, incomplete reviews and requested changes", () => {
  assert.equal(needsAttention(facts({ ai: "findings" })), true);
  assert.equal(needsAttention(facts({ ai: "failed" })), true);
  assert.equal(needsAttention(facts({ human: "Cambios solicitados" })), true);
  assert.equal(needsAttention(facts({ client: client("changesRequested") })), true);
  assert.equal(needsAttention(facts()), false);
  // The client's final approval closes the piece even with an old AI finding.
  assert.equal(needsAttention(facts({ ai: "findings", client: client("approved") })), false);
});

test("filters OR inside a group and AND across groups", () => {
  const piece = facts({ ai: "findings", human: "Aprobada", client: client("sent") });
  assert.equal(matchesPieceFilters(piece, []), true);
  assert.equal(matchesPieceFilters(piece, ["ai:findings", "ai:failed"]), true);
  assert.equal(matchesPieceFilters(piece, ["ai:validated"]), false);
  assert.equal(matchesPieceFilters(piece, ["ai:findings", "human:Pendiente"]), false);
  assert.equal(matchesPieceFilters(piece, ["ai:findings", "client:sent"]), true);
  assert.equal(matchesPieceFilters(piece, ["attention"]), true);
  assert.equal(matchesPieceFilters(facts({ client: client("approved") }), ["hideFinal"]), false);
  assert.equal(matchesPieceFilters(facts({ client: client("approved", true) }), ["hideFinal"]), true);
});

test("carousel keeps the filter and the open piece in place", () => {
  const all = ["a", "b", "c", "d", "e"];
  assert.deepEqual(carouselOrder(["b", "d"], all, "b"), ["b", "d"]);
  // «c» was just approved and left the filter: it stays open and «next» goes to «d».
  assert.deepEqual(carouselOrder(["b", "d"], all, "c"), ["b", "c", "d"]);
  assert.deepEqual(carouselOrder(["b", "d"], all, "e"), ["b", "d", "e"]);
  assert.deepEqual(carouselOrder([], all, "c"), ["c"]);
});

test("internal approval alone is not shown as final", () => {
  assert.equal(finalApprovalState(null, false), null);
  assert.equal(finalApprovalState(null, true)?.final, false);
  assert.match(finalApprovalState(client("sent"), true)!.title, /esperando al cliente/);
  assert.equal(finalApprovalState(client("approved"), true)?.final, true);
  assert.equal(finalApprovalState(client("approved", true), true)?.final, false);
});

test("each piece is in exactly one stage on its way to the client's final approval", async () => {
  const { pieceStage, countStages } = await import("../app/lib/qa-visual/piece-filters");
  assert.equal(pieceStage({ human: "Pendiente", client: null }), "internal");
  assert.equal(pieceStage({ human: "Aprobada", client: null }), "ready");
  assert.equal(pieceStage({ human: "Aprobada", client: client("sent") }), "sent");
  assert.equal(pieceStage({ human: "Aprobada", client: client("viewed") }), "viewed");
  assert.equal(pieceStage({ human: "Aprobada", client: client("changesRequested") }), "clientChanges");
  assert.equal(pieceStage({ human: "Aprobada", client: client("approved") }), "final");
  // A new internal version goes back to the internal stages until it is sent.
  assert.equal(pieceStage({ human: "Aprobada", client: client("approved", true) }), "ready");
  assert.equal(pieceStage({ human: "En revisión", client: client("approved", true) }), "internal");
  const counts = countStages([
    { human: "Aprobada", client: client("approved") },
    { human: "Aprobada", client: client("viewed") },
    { human: "Pendiente", client: null },
  ]);
  assert.deepEqual(counts, { internal: 1, ready: 0, sent: 0, viewed: 1, clientChanges: 0, final: 1 });
  assert.equal(matchesPieceFilters(facts({ human: "Aprobada", client: client("viewed") }), ["stage:viewed"]), true);
  assert.equal(matchesPieceFilters(facts({ human: "Aprobada", client: client("viewed") }), ["stage:final"]), false);
});
