import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReviewDialogs } from "../app/components/qa-visual/piece/ReviewDialogs";
import { useReviewSession } from "../app/hooks/qa-visual/use-review-session";
import type { ReviewSession } from "../app/hooks/qa-visual/use-review-session";
import { getAiReviewState, getHumanReviewState } from "../app/lib/qa-visual/review-state";
import { toReviewPieces } from "../app/lib/qa-visual/piece-inventory";
import { emptyReviewFeed } from "../app/lib/qa-visual/review-model";

const inventory = {
  matrix: null, csv: null, notices: [],
  pieces: [{ name: "piece.png", driveId: "image", driveVersion: "1", bytes: 1, updatedAt: 1 }],
};
const pieces = toReviewPieces(inventory, "campaign");

function Dialog({ note, requiresException, mode, overrides }: {
  note: string; requiresException: boolean;
  mode: "approve" | "changes";
  overrides?: Partial<ReviewSession>;
}) {
  const session = useReviewSession(pieces, inventory, emptyReviewFeed, "Revisor", "campaign", {});
  return createElement(ReviewDialogs, {
    session: {
      ...session,
      modal: "approval",
      canReview: true,
      decisionMode: mode,
      changeRequest: note,
      exception: note,
      requiresException,
      aiReview: getAiReviewState(requiresException ? "findings" : "validated", []),
      ...overrides,
    },
  });
}

function dialog(note: string, requiresException: boolean, mode: "approve" | "changes" = "approve", overrides?: Partial<ReviewSession>) {
  // Server rendering uses the real session without subscribing or making requests.
  const client = new ConvexReactClient("https://qa-approval-test.convex.cloud");
  return renderToStaticMarkup(createElement(ConvexProvider, { client },
    createElement(Dialog, { note, requiresException, mode, overrides }),
  ));
}

function button(html: string, label: string) {
  const found = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
    ?.find((markup) => markup.includes(label));
  assert.ok(found, `Missing button: ${label}`);
  return found;
}

test("request changes is disabled without an explanation regardless of the AI result", () => {
  for (const requiresException of [false, true]) {
    for (const note of ["", " \n\t "]) {
      const html = dialog(note, requiresException, "changes");
      assert.match(button(html, "Enviar solicitud"), /disabled=""/);
      assert.match(html, /¿Qué debe corregirse\?/);
      assert.match(html, /<textarea[^>]*required=""/);
      assert.doesNotMatch(html, /Motivo de la excepción/);
      assert.doesNotMatch(html, /Aprobar con excepción/);
    }
    assert.doesNotMatch(
      button(dialog("Completar el mes de la fecha", requiresException, "changes"), "Enviar solicitud"),
      /disabled=""/,
    );
  }
});

test("normal approval remains available without a comment; exceptions still require one", () => {
  assert.doesNotMatch(button(dialog("", false), "Aprobar versión"), /disabled=""/);
  assert.doesNotMatch(dialog("", false), /<textarea/);
  assert.doesNotMatch(dialog("", false), /Enviar solicitud/);
  assert.match(button(dialog("", true), "Aprobar con excepción"), /disabled=""/);
  assert.doesNotMatch(
    button(dialog("Confirmado con el cliente", true), "Aprobar con excepción"),
    /disabled=""/,
  );
});

test("the selected intent uses its own comment instead of reusing the other draft", () => {
  const changes = dialog("", true, "changes", { exception: "Aprobación manual confirmada" });
  assert.match(button(changes, "Enviar solicitud"), /disabled=""/);
  assert.doesNotMatch(changes, /Aprobación manual confirmada/);
  const approval = dialog("", true, "approve", { changeRequest: "Completar la fecha" });
  assert.match(button(approval, "Aprobar con excepción"), /disabled=""/);
  assert.doesNotMatch(approval, /Completar la fecha/);
});

test("revoke belongs to the previous decision card, outside the new decision form", () => {
  // Only the fields read by this view are needed for the persisted decision fixture.
  const detail = {
    currentDecisionId: "decision-1",
    decision: { decision: "changesRequested", note: "Completar el mes" },
  } as unknown as ReviewSession["detail"];
  const latestDecision = {
    pieceId: "piece-1", version: 1, status: "Cambios solicitados" as const,
    author: "Revisora", exception: "", message: "Cambios solicitados",
  };
  const html = dialog("", false, "approve", { detail, latestDecision });
  const card = html.match(/<section class="approval-current[\s\S]*?<\/section>/)?.[0];
  assert.ok(card);
  assert.match(card, /Revocar decisión/);
  assert.match(card, /Completar el mes/);
  assert.ok(html.indexOf("Revocar decisión") < html.indexOf("<form"));
  assert.equal(html.match(/Revocar decisión/g)?.length, 1);
  const revoked = dialog("", false, "approve", {
    detail: { ...detail!, decision: { ...detail!.decision!, decision: "revoked" } }, latestDecision,
  });
  assert.doesNotMatch(revoked, /Revocar decisión/);
});

function approvedSession(outdated = false): Partial<ReviewSession> {
  const latestDecision = {
    pieceId: "piece-1", version: 1, status: "Aprobada" as const,
    author: "Revisora", exception: "", message: "Aprobada",
  };
  return {
    detail: {
      currentDecisionId: "decision-1",
      decision: { decision: "approved", outdated },
    } as unknown as ReviewSession["detail"],
    latestDecision,
    humanReview: getHumanReviewState("Aprobada", latestDecision),
  };
}

test("an approved version displays its decision without offering approval again", () => {
  for (const requiresException of [false, true]) {
    const html = dialog("", requiresException, "approve", approvedSession());
    assert.doesNotMatch(html, /<form|<textarea|type="radio"|Aprobar versión|Aprobar con excepción|Lista para tu aprobación/);
    assert.doesNotMatch(button(html, "Cerrar</button>"), /disabled=""/);
    assert.doesNotMatch(button(html, "Revocar decisión"), /disabled=""/);
    assert.doesNotMatch(button(html, "Solicitar cambios"), /disabled=""/);
  }
});

test("requesting changes to an approved version requires a comment and offers a way back", () => {
  const html = dialog("", false, "changes", approvedSession());
  assert.match(html, /¿Qué debe corregirse\?/);
  assert.match(button(html, "Enviar solicitud"), /disabled=""/);
  assert.doesNotMatch(html, /type="radio"|Aprobar versión|Lista para tu aprobación/);
  assert.ok(button(html, "Volver"));
  assert.doesNotMatch(
    button(dialog("Completar la fecha", false, "changes", approvedSession()), "Enviar solicitud"),
    /disabled=""/,
  );
});

test("an approval based on an older request can be updated", () => {
  const html = dialog("", false, "approve", approvedSession(true));
  assert.doesNotMatch(button(html, "Aprobar versión"), /disabled=""/);
});

test("errors revoking an approved decision remain visible in the decision view", () => {
  const html = dialog("", false, "approve", {
    ...approvedSession(), saveError: "Otra persona cambió la decisión.",
  });
  assert.match(html, /role="alert">Otra persona cambió la decisión\./);
});
