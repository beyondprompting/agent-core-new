import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const MAX_ASKS = 20;
const MAX_LENGTH = 600;

/**
 * What the client asked to change on an earlier version of the piece. A new version is
 * analyzed and reviewed against the original request plus these asks: the client's request
 * prevails over the matrix (e.g. a price changed from 5,99 to 6,99).
 */
export async function clientChangeRequests(
  ctx: QueryCtx,
  pieceId: Id<"qaVisualPieces">,
  pieceVersionId: Id<"qaVisualPieceVersions">,
) {
  const history = await ctx.db
    .query("qaVisualDeliveryItems")
    .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
    .order("desc")
    .take(20);
  const current = await ctx.db.get(pieceVersionId);
  if (!current) return null;
  // The latest delivery of an earlier version where the client asked for changes.
  let item: Doc<"qaVisualDeliveryItems"> | undefined;
  let version: Doc<"qaVisualPieceVersions"> | null = null;
  for (const candidate of history) {
    if (candidate.status === "withdrawn" || candidate.clientState !== "changesRequested") continue;
    const candidateVersion = await ctx.db.get(candidate.pieceVersionId);
    if (!candidateVersion || candidateVersion.number >= current.number) continue;
    item = candidate;
    version = candidateVersion;
    break;
  }
  if (!item) return null;
  const asks: string[] = [];
  const add = (text: string | undefined) => {
    const value = text?.trim();
    if (value && asks.length < MAX_ASKS) asks.push(value.slice(0, MAX_LENGTH));
  };
  const decision = item.currentDecisionId ? await ctx.db.get(item.currentDecisionId) : null;
  if (decision?.decision === "changesRequested") add(decision.note);
  for (const status of ["open", "resolved"] as const) {
    const threads = await ctx.db
      .query("qaVisualThreads")
      .withIndex("by_item", (q) => q.eq("deliveryItemId", item._id).eq("status", status))
      .take(50);
    for (const thread of threads.filter((t) => t.audience === "client")) {
      const comments = await ctx.db
        .query("qaVisualComments")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(50);
      for (const comment of comments) {
        if (comment.authorKind !== "client" || comment.deletedAt) continue;
        add(comment.body || (comment.transcript?.status === "done" ? comment.transcript.text : undefined));
      }
    }
  }
  if (!asks.length) return null;
  return {
    clientVersion: item.clientVersion,
    internalVersion: version?.number ?? null,
    asks,
  } satisfies { clientVersion: number; internalVersion: number | null; asks: string[] };
}

export type ClientChangeRequests = NonNullable<Awaited<ReturnType<typeof clientChangeRequests>>>;

/** The client asked for changes on this very version: it needs a new version to go back. */
export function changesRequestedOn(
  items: Pick<Doc<"qaVisualDeliveryItems">, "status" | "clientState">[],
) {
  return items.some((i) => i.status === "active" && i.clientState === "changesRequested");
}

/**
 * What the team said about the previous version of the piece: the latest "pidió cambios"
 * note and every internal comment (also internal replies in client threads). Not all of them
 * ask for a change; the model decides which ones do.
 */
export async function internalChangeRequests(
  ctx: QueryCtx,
  pieceId: Id<"qaVisualPieces">,
  pieceVersionId: Id<"qaVisualPieceVersions">,
) {
  const current = await ctx.db.get(pieceVersionId);
  if (!current) return [];
  const previous = await ctx.db
    .query("qaVisualPieceVersions")
    .withIndex("by_piece", (q) => q.eq("pieceId", pieceId).lt("number", current.number))
    .order("desc")
    .first();
  if (!previous) return [];
  const asks: string[] = [];
  const add = (text: string | undefined) => {
    const value = text?.trim().slice(0, MAX_LENGTH);
    if (value && asks.length < MAX_ASKS && !asks.includes(value)) asks.push(value);
  };
  const decision = await ctx.db
    .query("qaVisualDecisions")
    .withIndex("by_version", (q) => q.eq("pieceVersionId", previous._id))
    .order("desc")
    .first();
  if (decision?.decision === "changesRequested") add(decision.note);
  const comments = await ctx.db
    .query("qaVisualComments")
    .withIndex("by_version", (q) => q.eq("pieceVersionId", previous._id))
    .take(200);
  for (const comment of comments) {
    if (comment.authorKind === "client" || comment.event || comment.deletedAt) continue;
    add(comment.body || (comment.transcript?.status === "done" ? comment.transcript.text : undefined));
  }
  return asks;
}

/** Everything the analysis of a new version receives about changes asked on earlier versions. */
export async function analysisChangeRequests(
  ctx: QueryCtx,
  pieceId: Id<"qaVisualPieces">,
  pieceVersionId: Id<"qaVisualPieceVersions">,
) {
  const client = (await clientChangeRequests(ctx, pieceId, pieceVersionId))?.asks ?? [];
  const internal = await internalChangeRequests(ctx, pieceId, pieceVersionId);
  return [
    ...client.map((text) => ({ from: "client" as const, text })),
    ...internal.map((text) => ({ from: "internal" as const, text })),
  ];
}
