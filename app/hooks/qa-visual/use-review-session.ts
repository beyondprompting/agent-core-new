import { useEffect, useRef, useState } from "react";

import { type Comment, type PieceStatus } from "@/app/lib/qa-visual/review-model";

import { getAiReviewState, getHumanReviewState } from "@/app/lib/qa-visual/review-state";
import type { ReviewFeed } from "@/app/lib/qa-visual/review-model";
import { useReviewDecisions } from "./use-review-decisions";
import type { Piece } from "@/app/lib/qa-visual/review-model";
import { useCanvasAnnotations, type Tool } from "./use-canvas-annotations";
import type { QaInventory } from "@/app/lib/qa-visual/source";
type LeftTab = "Archivos" | "Resumen" | "Recursos";
type RightTab = "Comentarios" | "Detalles" | "Versiones" | "Historial";

export function useReviewSession(
  pieces: Piece[],
  inventory: QaInventory,
  feed: ReviewFeed,
  reviewer: string,
) {
  const [activeId, setActiveId] = useState(pieces[0].id);
  const [version, setVersion] = useState(1);
  const [leftTab, setLeftTab] = useState<LeftTab>("Archivos");
  const [rightTab, setRightTab] = useState<RightTab>("Comentarios");
  const [localComments, setLocalComments] = useState<Comment[]>([]);
  const [resolvedOverrides, setResolvedOverrides] = useState<
    Record<Comment["id"], boolean>
  >({});
  const comments = [...feed.comments, ...localComments].map((comment) => ({
    ...comment,
    resolved: resolvedOverrides[comment.id] ?? comment.resolved,
  }));
  const [selected, setSelected] = useState<Comment["id"] | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment["id"] | null>(null);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(100);
  const [tool, setTool] = useState<Tool>("select");
  const [showPins, setShowPins] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"share" | "approval" | "help" | null>(
    null,
  );
  const { exception, setException, statuses, approvals, recordDecision } =
    useReviewDecisions(reviewer);
  const {
    drawing,
    pieceMarks,
    setMarks,
    pan,
    setPan,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useCanvasAnnotations(activeId, version, tool, (pin) => {
    setPendingPin(pin);
    setShowPins(true);
    setToast("");
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const pinToolRef = useRef<HTMLButtonElement>(null);
  const activePieces = pieces;
  const piece = activePieces.find((p) => p.id === activeId) ?? activePieces[0];
  const currentStatus = statuses[`${activeId}-${version}`] ?? piece.status;
  const pieceComments = comments.filter(
    (c) => c.pieceId === activeId && c.version === version,
  );
  const visibleComments = pieceComments.filter(
    (c) =>
      filter === "all" ||
      (filter === "agent" && c.kind === "agent") ||
      (filter === "human" && c.kind === "human") ||
      (filter === "open" && !c.resolved),
  );
  const aiReview = getAiReviewState(
    feed.results[piece.id]?.[version],
    pieceComments,
  );
  const latestDecision = approvals
    .slice()
    .reverse()
    .find(
      (a) =>
        a.pieceId === activeId &&
        a.version === version &&
        a.status === currentStatus,
    );
  const humanReview = getHumanReviewState(currentStatus, latestDecision);
  const requiresException = Boolean(
    aiReview.status &&
    ["findings", "partial", "failed"].includes(aiReview.status),
  );
  const filteredPieces = activePieces.filter(
    (p) =>
      `${p.name} ${p.phase} ${p.format} ${p.filename}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (statusFilter === "all" ||
        (statusFilter.startsWith("ai:")
          ? feed.results[p.id]?.[1] === statusFilter.slice(3)
          : (statuses[`${p.id}-1`] ?? p.status) === statusFilter)),
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setTool("select");
        setPendingPin(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choosePiece = (id: string) => {
    setActiveId(id);
    setVersion(1);
    setSelected(
      comments.find(
        (c) => c.pieceId === id && c.severity === "warning" && !c.resolved,
      )?.id ?? null,
    );
    setPendingPin(null);
    setPan({ x: 0, y: 0 });
    setZoom(100);
    setReplyTo(null);
    setDraft("");
    setException("");
  };
  const selectComment = (id: Comment["id"]) => {
    setSelected(id);
    setRightTab("Comentarios");
    setRightOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById(`comment-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };
  const changeVersion = (v: number) => {
    setVersion(v);
    setSelected(null);
    setPendingPin(null);
    setPan({ x: 0, y: 0 });
    setReplyTo(null);
    setDraft("");
    setException("");
  };
  const toggleResolved = (id: Comment["id"]) =>
    setResolvedOverrides((prev) => ({
      ...prev,
      [id]: !(comments.find((c) => c.id === id)?.resolved ?? false),
    }));
  const addComment = (
    text: string,
    pin?: { x: number; y: number },
    response?: Comment["id"] | null,
  ) => {
    if (!text.trim()) return;
    const id = Math.max(0, ...localComments.map((c) => Number(c.id))) + 1;
    setLocalComments((prev) => [
      ...prev,
      {
        id,
        pieceId: activeId,
        version,
        author: reviewer,
        role: "Revisora",
        kind: "human",
        time: "Ahora",
        body: `${response ? `En respuesta a ${comments.find((c) => c.id === response)?.author}: ` : ""}${text.trim()}`,
        pin,
        resolved: false,
      },
    ]);
    setSelected(id);
    setFilter("all");
    setRightTab("Comentarios");
    setToast("Comentario agregado a esta versión");
  };
  const publish = () => {
    if (!draft.trim()) return;
    addComment(draft, undefined, replyTo);
    setDraft("");
    setReplyTo(null);
  };
  const cancelImageComment = () => {
    setPendingPin(null);
    setTool("select");
    pinToolRef.current?.focus({ preventScroll: true });
  };
  const publishImageComment = (text: string) => {
    if (!pendingPin) return;
    addComment(text, pendingPin);
    setShowPins(true);
    cancelImageComment();
  };
  const setDecision = (status: PieceStatus) => {
    if (!recordDecision(activeId, version, status, requiresException)) return;
    setModal(null);
    setException("");
    setToast(`${status} · decisión humana registrada`);
  };
  const openAiReview = () => {
    setFilter("agent");
    setRightTab("Comentarios");
    setRightOpen(true);
    setShowPins(true);
    const finding =
      pieceComments.find(
        (c) => c.kind === "agent" && c.severity === "warning" && !c.resolved,
      ) ?? pieceComments.find((c) => c.kind === "agent");
    if (finding) selectComment(finding.id);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = piece.image;
    a.download = piece.filename;
    a.click();
    setToast("Descargando el archivo original de esta pieza");
  };
  return {
    activeId,
    activePieces,
    results: feed.results,
    reviewer,
    aiReview,
    approvals,
    artboardRef,
    cancelImageComment,
    changeVersion,
    choosePiece,
    comments,
    currentStatus,
    download,
    draft,
    drawing,
    exception,
    filter,
    filteredPieces,
    humanReview,
    inputRef,
    inventory,
    latestDecision,
    leftOpen,
    leftTab,
    modal,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    openAiReview,
    pan,
    pendingPin,
    piece,
    pieceComments,
    pieceMarks,
    pieces,
    pinToolRef,
    publish,
    publishImageComment,
    query,
    replyTo,
    requiresException,
    rightOpen,
    rightTab,
    selectComment,
    selected,
    setDecision,
    setDraft,
    setException,
    setFilter,
    setLeftOpen,
    setLeftTab,
    setMarks,
    setModal,
    setPan,
    setPendingPin,
    setQuery,
    setReplyTo,
    setRightOpen,
    setRightTab,
    setSelected,
    setShowPins,
    setStatusFilter,
    setToast,
    setTool,
    setZoom,
    showPins,
    statusFilter,
    statuses,
    toast,
    toggleResolved,
    tool,
    version,
    visibleComments,
    zoom,
  };
}
export type ReviewSession = ReturnType<typeof useReviewSession>;
