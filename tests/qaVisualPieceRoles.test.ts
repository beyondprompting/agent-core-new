import assert from "node:assert/strict";
import { test } from "node:test";
import { externalPieceRole, normalizeExternalWorkRole } from "../convex/lib/externalPieceRoles";

test("only pieceReview and pieceApproval are piece roles", () => {
  assert.equal(externalPieceRole("pieceReview"), "pieceReview");
  assert.equal(externalPieceRole(" pieceApproval "), "pieceApproval");
  assert.equal(externalPieceRole(undefined), null);
  assert.equal(externalPieceRole(""), null);
  assert.equal(externalPieceRole("Coordinación"), null);
  assert.equal(normalizeExternalWorkRole(""), undefined);
  assert.equal(normalizeExternalWorkRole("pieceReview"), "pieceReview");
  assert.throws(() => normalizeExternalWorkRole("admin"), /no válido/);
});
