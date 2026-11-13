import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { useReviewSession } from "../app/hooks/qa-visual/use-review-session";
import { FilesPanel } from "../app/components/qa-visual/campaign/FilesPanel";
import { ViewerToolbar } from "../app/components/qa-visual/viewer/ViewerToolbar";
import { toReviewPieces } from "../app/lib/qa-visual/piece-inventory";
import { emptyReviewFeed } from "../app/lib/qa-visual/review-model";
import { parseReviewLocation, type ReviewLocation } from "../app/lib/qa-visual/review-location";

const inventory = {
  matrix: null,
  csv: null,
  notices: [],
  pieces: Array.from({ length: 12 }, (_, index) => ({
    name: `pieza_${index + 1}.png`,
    driveId: `drive-${index + 1}`,
    driveVersion: "1",
    bytes: 100,
    updatedAt: 1,
    pieceId: `piece-${index + 1}` as Id<"qaVisualPieces">,
    currentVersion: index === 11 ? 3 : 1,
    versions: index === 11 ? 3 : 1,
  })),
};
const pieces = toReviewPieces(inventory, "campaign");

function Editor({ location }: { location: ReviewLocation }) {
  const session = useReviewSession(
    pieces, inventory, emptyReviewFeed, "Revisor", "campaign", location,
  );
  return createElement(Fragment, null,
    createElement(FilesPanel, { session }),
    createElement(ViewerToolbar, { session }),
  );
}

function renderEditor(params: Parameters<typeof parseReviewLocation>[0]) {
  // Server rendering does not subscribe to Convex or make network requests.
  const client = new ConvexReactClient("https://qa-selection-test.convex.cloud");
  return renderToString(createElement(ConvexProvider, { client },
    createElement(Editor, { location: parseReviewLocation(params) }),
  ));
}

test("reload renders the linked piece and version identically with and without window", () => {
  const params = { pieza: "piece-12", v: "2" };
  const serverHtml = renderEditor(params);
  assert.match(serverHtml, /data-piece-id="piece-12" aria-current="true"/);
  assert.doesNotMatch(serverHtml, /data-piece-id="piece-1" aria-current="true"/);
  assert.match(serverHtml, /<option value="2" selected="">/);

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "?pieza=piece-12&v=2" } },
  });
  try {
    assert.equal(renderEditor(params), serverHtml);
    // Entering from the campaign uses the route's empty selection, even if a
    // previous browser URL still references another piece during navigation.
    assert.match(renderEditor({}), /data-piece-id="piece-1" aria-current="true"/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("campaign entry and unavailable links fall back to a valid piece and version", () => {
  const entry = renderEditor({});
  assert.match(entry, /data-piece-id="piece-1" aria-current="true"/);
  assert.match(entry, /<span class="viewer-version single">v<!-- -->1<\/span>/);
  assert.equal(renderEditor({ pieza: "removed-piece", v: "2" }), entry);
  for (const v of ["0", "-1", "1.5", "NaN", "Infinity", "999"]) {
    const html = renderEditor({ pieza: "piece-12", v });
    assert.match(html, /data-piece-id="piece-12" aria-current="true"/);
    assert.match(html, /<option value="3" selected="">/);
  }
});
