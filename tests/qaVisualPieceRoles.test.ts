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

test("a whole-client campaign is visible to people assigned to one of its brands", async () => {
  const { assignmentCoversCampaign } = await import("../convex/qaVisual/clientAccess");
  const brand = "brand-a" as never;
  const other = "brand-b" as never;
  const wholeClient = { client: { clientId: "client" as never } };
  const brandCampaign = { client: { clientId: "client" as never, brandId: brand } };
  assert.equal(assignmentCoversCampaign({ brandId: brand }, wholeClient), true);
  assert.equal(assignmentCoversCampaign({}, wholeClient), true);
  assert.equal(assignmentCoversCampaign({}, brandCampaign), true);
  assert.equal(assignmentCoversCampaign({ brandId: brand }, brandCampaign), true);
  assert.equal(assignmentCoversCampaign({ brandId: other }, brandCampaign), false);
});
