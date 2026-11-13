import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Mark } from "@/app/hooks/qa-visual/use-canvas-annotations";
import type { Comment, Piece, PieceStatus, ReviewFeed } from "./review-model";
import {
  getAiReviewState,
  getHumanReviewState,
  type ReviewDecision,
} from "./review-state";
import { buildAnalysisFeed } from "./analysis-feed";
import { toReviewPieces } from "./piece-inventory";
import { pieceKey } from "@/convex/qaVisual/model/normalize";
import { matchesPieceFilters, type PieceFilters } from "./piece-filters";

/** Projects persisted review data without changing the AI result or stored threads. */
export function buildPieceReview({
  pieces,
  currentPiece,
  version,
  data,
  feed,
  campaignId,
  filter,
  query,
  filters,
}: {
  pieces: Piece[];
  currentPiece: Piece;
  version: number;
  data: FunctionReturnType<typeof api.qaVisual.editor.piece> | undefined;
  feed: ReviewFeed;
  campaignId: string;
  filter: string;
  query: string;
  filters: PieceFilters;
}) {
  const snapshotPiece = data?.file
    ? toReviewPieces(
        {
          matrix: null,
          csv: null,
          notices: [],
          pieces: [data.file],
          production: data.production
            ? { [pieceKey(data.file.name)]: data.production }
            : undefined,
        },
        campaignId,
      )[0]
    : currentPiece;
  const media = data
    ? "/workspace/qa-visual/media?" +
      new URLSearchParams({ campaign: campaignId, version: data.versionId })
    : "";
  const piece: Piece = data
    ? {
        ...currentPiece,
        ...snapshotPiece,
        id: currentPiece.id,
        pieceId: data.pieceId,
        pieceVersionId: data.versionId,
        currentVersion: currentPiece.currentVersion,
        versions: currentPiece.versions,
        status: data.humanStatus,
        filename: data.file?.name ?? currentPiece.filename,
        image: data.imageReady ? media + "&variant=analysis" : "",
        thumbnail: data.imageReady ? media + "&variant=thumbnail" : undefined,
        originalImage: data.file
          ? "/workspace/qa-visual/media?" +
            new URLSearchParams({
              campaign: campaignId,
              id: data.file.driveId,
              v: data.file.driveVersion,
            })
          : undefined,
        width: data.imageSnapshot?.width ?? currentPiece.width,
        height: data.imageSnapshot?.height ?? currentPiece.height,
        clientRequirements: data.requirements,
      }
    : {
        ...currentPiece,
        ...(version !== (currentPiece.currentVersion ?? 1)
          ? { image: "", thumbnail: undefined }
          : {}),
      };
  const detailFeed = data
    ? buildAnalysisFeed([
        {
          name: piece.filename,
          pieceId: data.pieceId,
          version,
          status: data.latestStatus ?? "pending",
          verdict: data.review?.verdict,
          result: data.review?.result,
          findings: data.review?.findings,
          resultId: data.review?._id,
          resultAt: data.review?._creationTime,
          issues: data.issues,
        },
      ])
    : null;
  const detailComments: Comment[] = [...(detailFeed?.comments ?? [])];
  for (const thread of data?.threads ?? []) {
    const origin = thread.origin;
    let comment =
      origin.kind === "finding"
        ? detailComments.find(
            (c) =>
              c.finding?.reviewId === origin.reviewId &&
              c.finding?.ruleId === origin.ruleId,
          )
        : undefined;
    const entries = thread.comments.filter((c) => !c.event);
    if (!comment) {
      const first = entries[0];
      const finding = thread.finding;
      comment = {
        id: thread._id,
        pieceId: piece.id,
        version,
        author: finding ? "Agente QA Visual" : thread.author,
        historical: Boolean(finding),
        role: finding ? "Hallazgo de un análisis anterior" : "Revisor",
        kind: finding ? "agent" : "human",
        body: finding?.observed ?? first?.body ?? "Hilo de revisión",
        time: new Date(thread._creationTime).toLocaleString(),
        resolved: false,
        ...(finding
          ? {
              observed: finding.observed,
              expected: finding.expected,
              source: finding.source,
              severity:
                finding.outcome === "fail" ? finding.severity : undefined,
            }
          : {}),
      };
      detailComments.push(comment);
    }
    comment.threadId = thread._id;
    comment.anchor = thread.anchor;
    comment.audience = thread.audience ?? "internal";
    const audioOf = (entry: (typeof entries)[number]) =>
      entry.audio && !entry.deletedAt
        ? {
            url: `/workspace/qa-visual/media?${new URLSearchParams({ audio: entry._id })}`,
            durationMs: entry.audio.durationMs,
            transcript: entry.transcript ?? null,
          }
        : undefined;
    if (thread.origin.kind === "human" && entries[0]) {
      comment.audio = audioOf(entries[0]);
      if (thread.audience === "client" && entries[0].authorKind === "client")
        comment.role = "Cliente";
    }
    comment.resolved = thread.status === "resolved";
    comment.replies = entries.map((entry) => ({
      id: entry._id,
      author: entry.author,
      body: entry.body,
      time: new Date(entry._creationTime).toLocaleString(),
      canEdit: Boolean(entry.canEdit),
      visibility: entry.visibility ?? "internal",
      fromClient: entry.authorKind === "client",
      audio: audioOf(entry),
    }));
    if (thread.origin.kind === "human")
      comment.replies = comment.replies.slice(1);
    if (thread.anchor.kind === "point")
      comment.pin = { x: thread.anchor.x * 100, y: thread.anchor.y * 100 };
    if (thread.anchor.kind === "rect") {
      comment.region = {
        x: thread.anchor.x * 100,
        y: thread.anchor.y * 100,
        width: thread.anchor.width * 100,
        height: thread.anchor.height * 100,
      };
      comment.pin = {
        x: comment.region.x + comment.region.width / 2,
        y: comment.region.y + comment.region.height / 2,
      };
    }
    if (thread.anchor.kind === "path")
      comment.pin = {
        x: thread.anchor.points[0].x * 100,
        y: thread.anchor.points[0].y * 100,
      };
  }
  let marker = 0;
  for (const comment of detailComments)
    if (comment.pin) comment.marker = ++marker;
  const comments = data
    ? [
        ...feed.comments.filter(
          (c) => c.pieceId !== piece.id || c.version !== version,
        ),
        ...detailComments,
      ]
    : [...feed.comments];
  const pieceComments = comments.filter(
    (c) => c.pieceId === piece.id && c.version === version,
  );
  const visibleComments = pieceComments.filter(
    (c) =>
      filter === "all" ||
      (filter === "client" && c.audience === "client") ||
      (filter !== "client" && filter === c.kind) ||
      (filter === "open" && !c.resolved),
  );
  const results = data
    ? {
        ...feed.results,
        [piece.id]: {
          ...feed.results[piece.id],
          ...detailFeed?.results[piece.id],
        },
      }
    : feed.results;
  const statuses: Record<string, PieceStatus> = Object.fromEntries(
    pieces.map((p) => [`${p.id}-${p.currentVersion ?? 1}`, p.status]),
  );
  if (data) statuses[`${piece.id}-${version}`] = data.humanStatus;
  const currentStatus =
    data?.humanStatus ??
    (version === currentPiece.currentVersion
      ? currentPiece.status
      : "Pendiente");
  const approvals: ReviewDecision[] = (data?.decisions ?? [])
    .slice()
    .reverse()
    .map((d) => ({
      pieceId: piece.id,
      version,
      status:
        d.decision === "approved"
          ? "Aprobada"
          : d.decision === "changesRequested"
            ? "Cambios solicitados"
            : "Pendiente",
      author: d.author,
      exception: d.exception?.note ?? "",
      message: `${d.decision === "approved" ? "Aprobada" : d.decision === "changesRequested" ? "Cambios solicitados" : "Decisión revocada"}${d.note || d.exception?.note ? ` · ${d.note ?? d.exception?.note}` : ""}`,
      at: d._creationTime,
    }));
  const latestDecision = approvals.at(-1);
  const aiReview = getAiReviewState(
    results[piece.id]?.[version],
    pieceComments,
  );
  if (aiReview.status === "stale") {
    const previous = data?.previousVerdict;
    if (previous)
      aiReview.detail += ` · Resultado anterior: ${{ validated: "validada", findings: "con hallazgos", partial: "revisión incompleta" }[previous]}`;
  } else if (data?.review?.result) {
    const { coverage, reason } = data.review.result;
    aiReview.detail = `${coverage.executed}/${coverage.requested} controles verificados${coverage.unverifiable ? ` · ${coverage.unverifiable} sin verificar` : ""}${reason ? ` · ${reason}` : ""}${data.latestStatus !== "completed" ? " · Resultado anterior" : ""}`;
    if (data.latestStatus === "completed")
      aiReview.reasons = data.review.result.reasons ?? (reason ? [reason] : []);
  }
  const humanReview = getHumanReviewState(currentStatus, latestDecision);
  if (data?.decision?.outdated && currentStatus === "Aprobada")
    humanReview.detail += " · Aprobada con un pedido anterior";
  const requiresException = aiReview.status !== "validated";
  const filteredPieces = pieces.filter(
    (p) =>
      `${p.name} ${p.phase} ${p.format} ${p.filename}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      matchesPieceFilters(
        {
          ai: results[p.id]?.[p.currentVersion ?? 1],
          human: statuses[`${p.id}-${p.currentVersion ?? 1}`] ?? p.status,
          client: p.client,
        },
        filters,
      ),
  );
  const pieceMarks: Mark[] = (data?.threads ?? []).flatMap((thread): Mark[] => {
    const a = thread.anchor;
    return a.kind === "rect"
      ? [
          {
            id: thread._id,
            pieceId: piece.id,
            version,
            type: "rectangle",
            points: [
              { x: a.x * 100, y: a.y * 100 },
              { x: (a.x + a.width) * 100, y: (a.y + a.height) * 100 },
            ],
          },
        ]
      : a.kind === "path"
        ? [
            {
              id: thread._id,
              pieceId: piece.id,
              version,
              type: "draw",
              points: a.points.map((p) => ({ x: p.x * 100, y: p.y * 100 })),
            },
          ]
        : [];
  });

  return {
    piece,
    comments,
    pieceComments,
    visibleComments,
    results,
    statuses,
    currentStatus,
    approvals,
    latestDecision,
    aiReview,
    humanReview,
    requiresException,
    filteredPieces,
    pieceMarks,
  };
}
