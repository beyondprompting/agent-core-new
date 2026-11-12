import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionCtx } from "../convex/_generated/server";
import { driveMedia } from "../convex/qaVisual/mediaHttp";
import { toReviewPieces } from "../app/lib/qa-visual/piece-inventory";
import type { Comment } from "../app/lib/qa-visual/review-model";
import { CanvasCommentMarkers } from "../app/components/qa-visual/viewer/CanvasCommentMarkers";

const imageFile = {
  name: "pieza_1080X1080px.png", bytes: 100, updatedAt: 1,
  driveId: "drive-file", driveVersion: "1",
};

test("uses the saved analysis image for the canvas and the small thumbnail for the sidebar", () => {
  const [piece] = toReviewPieces({
    matrix: null, csv: null, notices: [], pieces: [{ ...imageFile, thumbnailReady: true }],
  }, "campaign");
  assert.equal(new URL(piece.image, "http://localhost").searchParams.get("variant"), "analysis");
  assert.equal(new URL(piece.thumbnail!, "http://localhost").searchParams.get("variant"), "thumbnail");
  assert.equal(new URL(piece.originalImage!, "http://localhost").searchParams.get("variant"), null);
  const [preparing] = toReviewPieces({
    matrix: null, csv: null, notices: [], pieces: [imageFile],
  }, "campaign");
  assert.equal(preparing.image, "");
});

const handleMedia = driveMedia as unknown as {
  _handler(ctx: ActionCtx, request: Request): Promise<Response>;
};

test("serves the analysis JPEG from storage without reading the original from Drive", async () => {
  const data = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  const queries: { variant: string }[] = [];
  const ctx = {
    async runQuery(_ref: unknown, args: { variant: string }) {
      queries.push(args);
      return "analysis-storage";
    },
    async runAction() { assert.fail("A cached image must not request the original from Drive"); },
    storage: { async get(id: string) { assert.equal(id, "analysis-storage"); return data; } },
  } as unknown as ActionCtx;
  const response = await handleMedia._handler(ctx, new Request(
    "https://example.convex.site/qa-visual/media?campaign=test&id=drive-file&v=1&variant=analysis",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(queries[0].variant, "analysis");
});

test("returns 404 for an unavailable or unauthorized cached image", async () => {
  const ctx = {
    async runQuery() { throw new Error("Acceso denegado"); },
    storage: { async get() { assert.fail("Unauthorized images must not be read"); } },
  } as unknown as ActionCtx;
  const response = await handleMedia._handler(ctx, new Request(
    "https://example.convex.site/qa-visual/media?campaign=test&id=drive-file&v=1&variant=analysis",
  ));
  assert.equal(response.status, 404);
});

const comment = (id: string, changes: Partial<Comment> = {}): Comment => ({
  id, marker: 5, pieceId: "test", version: 1,
  author: "Agente QA Visual", role: "Hallazgo", kind: "agent", time: "",
  body: "Se lee JUEVES 22", resolved: false, ...changes,
});

test("shows unlocated comments as general references and preserves known image positions", () => {
  const html = renderToStaticMarkup(createElement(CanvasCommentMarkers, {
    comments: [
      comment("date"), comment("cta", { marker: 6 }),
      comment("located", { marker: 7, pin: { x: 25, y: 40 }, region: { x: 20, y: 35, width: 10, height: 10 } }),
      comment("notice", { marker: undefined, role: "Aviso del Excel" }),
      comment("resolved", { marker: 8, resolved: true }),
    ],
    selected: "located", visible: true, onSelect() {},
  }));
  assert.match(html, /Comentarios generales de la imagen/);
  assert.match(html, /Abrir comentario general 5/);
  assert.match(html, /Abrir comentario general 6/);
  assert.match(html, /Abrir comentario 7 en la imagen/);
  assert.match(html, /left:25%;top:40%/);
  assert.match(html, /class="selected-region"/);
  assert.doesNotMatch(html, /Aviso del Excel|general 8/);
});

test("the marker toggle hides both general references and located pins", () => {
  const html = renderToStaticMarkup(createElement(CanvasCommentMarkers, {
    comments: [comment("date"), comment("located", { pin: { x: 25, y: 40 } })],
    selected: null, visible: false, onSelect() {},
  }));
  assert.equal(html, "");
});
