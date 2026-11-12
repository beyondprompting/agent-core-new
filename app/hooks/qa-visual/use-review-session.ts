import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Comment,
  type Piece,
  type PieceStatus,
  type ReviewFeed,
} from "@/app/lib/qa-visual/review-model";
import { buildPieceReview } from "@/app/lib/qa-visual/piece-review";
import { focusCommentElement } from "@/app/lib/qa-visual/comment-navigation";
import {
  useCanvasAnnotations,
  type Tool,
  type Mark,
} from "./use-canvas-annotations";
import { usePieceReview } from "./use-piece-review";
import type { QaInventory } from "@/app/lib/qa-visual/source";
import type { Anchor } from "@/convex/qaVisual/model/collaboration";
import type { Id } from "@/convex/_generated/dataModel";
type LeftTab = "Archivos" | "Resumen" | "Recursos";
type RightTab = "Comentarios" | "Detalles" | "Versiones" | "Historial";

export function useReviewSession(
  pieces: Piece[],
  inventory: QaInventory,
  feed: ReviewFeed,
  reviewer: string,
  campaignId: string,
) {
  const [activeId, setActiveId] = useState(pieces[0].id);
  const [selectedVersion, setVersion] = useState<number>();
  const currentPiece = pieces.find((p) => p.id === activeId) ?? pieces[0];
  const version = selectedVersion ?? currentPiece.currentVersion ?? 1;
  const persisted = usePieceReview(currentPiece.pieceId, version);
  const data = persisted.data;
  const [leftTab, setLeftTab] = useState<LeftTab>("Archivos");
  const [rightTab, setRightTab] = useState<RightTab>("Comentarios");
  const [selected, setSelected] = useState<Comment["id"] | null>(null);
  const [commentFocus, setCommentFocus] = useState<{
    id: Comment["id"];
    highlight: boolean;
  } | null>(null);
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment["id"] | null>(null);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pendingMark, setPendingMark] = useState<Mark | null>(null);
  const [zoom, setZoom] = useState(100),
    [tool, setTool] = useState<Tool>("select"),
    [showPins, setShowPins] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true),
    [toast, setToast] = useState("");
  const [modal, setModal] = useState<"share" | "approval" | "help" | null>(
    null,
  );
  const [exception, setException] = useState("");
  const [exceptionReason, setExceptionReason] = useState<
    "acceptedFinding" | "falsePositive" | "notApplicable" | "other"
  >("other");
  const { drawing, pan, setPan, onPointerDown, onPointerMove, onPointerUp } =
    useCanvasAnnotations(
      currentPiece.id,
      version,
      tool,
      (point) => {
        if (!data || persisted.busy) return;
        setPendingMark(null);
        setPendingPin(point);
        setShowPins(true);
      },
      (mark) => {
        if (!data || persisted.busy) return;
        setPendingMark(mark);
        setPendingPin(mark.points.at(-1)!);
        setShowPins(true);
      },
    );
  const inputRef = useRef<HTMLTextAreaElement>(null),
    artboardRef = useRef<HTMLDivElement>(null),
    pinToolRef = useRef<HTMLButtonElement>(null);
  const selectedKey = `${currentPiece.id}:${version}`;
  const selectionRef = useRef(selectedKey);
  selectionRef.current = selectedKey;
  const {
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
  } = buildPieceReview({
    pieces,
    currentPiece,
    version,
    data,
    feed,
    campaignId,
    filter,
    query,
    statusFilter,
  });
  const activePieces = pieces;
  if (pendingMark) pieceMarks.push(pendingMark);

  useLayoutEffect(() => {
    if (!commentFocus) return;
    const element = document.getElementById(`comment-${commentFocus.id}`);
    if (element) {
      const animation = focusCommentElement(element, commentFocus.highlight);
      return () => animation?.cancel();
    }
  }, [commentFocus]);
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
        setPendingMark(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const resetSelection = () => {
    setCommentFocus(null);
    setSelected(null);
    setPendingPin(null);
    setPendingMark(null);
    setPan({ x: 0, y: 0 });
    setReplyTo(null);
    setDraft("");
    setException("");
    persisted.setError("");
  };
  const choosePiece = (id: string) => {
    resetSelection();
    setActiveId(id);
    setVersion(undefined);
    setZoom(100);
  };
  const changeVersion = (v: number) => {
    resetSelection();
    setVersion(v === currentPiece.currentVersion ? undefined : v);
  };
  const selectComment = (
    id: Comment["id"],
    options?: { highlight?: boolean },
  ) => {
    setSelected(id);
    setFilter("all");
    setRightTab("Comentarios");
    setRightOpen(true);
    setCommentFocus({ id, highlight: Boolean(options?.highlight) });
  };
  const target = (comment: Comment) =>
    comment.threadId
      ? { threadId: comment.threadId }
      : comment.finding
        ? { finding: comment.finding }
        : null;
  const toggleResolved = async (id: Comment["id"]) => {
    const comment = comments.find((c) => c.id === id),
      ref = comment && target(comment);
    if (data && comment && ref)
      await persisted.save(() =>
        persisted.resolve({
          pieceVersionId: data.versionId,
          ...ref,
          resolved: !comment.resolved,
        }),
      );
  };
  const addComment = async (
    text: string,
    anchor: Anchor,
    response?: Comment["id"] | null,
  ) => {
    if (!data || !text.trim()) return false;
    const comment = response
      ? comments.find((c) => c.id === response)
      : undefined;
    const ref = comment && target(comment),
      requestId = crypto.randomUUID();
    if (response && !ref) return false;
    const saved = await persisted.save(() =>
      ref
        ? persisted.reply({
            pieceVersionId: data.versionId,
            ...ref,
            body: text,
            requestId,
          })
        : persisted.create({
            pieceVersionId: data.versionId,
            anchor,
            body: text,
            requestId,
          }),
    );
    if (!saved) return false;
    if (selectionRef.current === selectedKey) {
      setSelected(saved.value);
      setFilter("all");
      setRightTab("Comentarios");
      setToast("Comentario guardado en esta versión");
    }
    return true;
  };
  const publish = async () => {
    if (
      (await addComment(draft, { kind: "general" }, replyTo)) &&
      selectionRef.current === selectedKey
    ) {
      setDraft("");
      setReplyTo(null);
    }
  };
  const cancelImageComment = () => {
    setPendingPin(null);
    setPendingMark(null);
    setTool("select");
    pinToolRef.current?.focus({ preventScroll: true });
  };
  const publishImageComment = async (text: string) => {
    if (!pendingPin) return;
    let anchor: Anchor = {
      kind: "point",
      x: pendingPin.x / 100,
      y: pendingPin.y / 100,
    };
    if (pendingMark?.type === "draw")
      anchor = {
        kind: "path",
        points: pendingMark.points.map((p) => ({ x: p.x / 100, y: p.y / 100 })),
      };
    if (pendingMark?.type === "rectangle") {
      const [a, b] = pendingMark.points;
      anchor = {
        kind: "rect",
        x: Math.min(a.x, b.x) / 100,
        y: Math.min(a.y, b.y) / 100,
        width: Math.abs(a.x - b.x) / 100,
        height: Math.abs(a.y - b.y) / 100,
      };
    }
    if (
      (await addComment(text, anchor)) &&
      selectionRef.current === selectedKey
    ) {
      setShowPins(true);
      cancelImageComment();
    }
  };
  const setDecision = async (status: PieceStatus) => {
    if (!data) return;
    const decision =
      status === "Aprobada"
        ? "approved"
        : status === "Cambios solicitados"
          ? "changesRequested"
          : "revoked";
    const saved = await persisted.save(() =>
      persisted.decide({
        pieceVersionId: data.versionId,
        decision,
        expectedCurrentDecisionId: data.currentDecisionId,
        expectedInputHash: data.inputHash,
        expectedReviewId: data.review?._id ?? null,
        ...(decision === "approved" && requiresException
          ? { exception: { reason: exceptionReason, note: exception } }
          : {}),
        ...(decision === "changesRequested" && exception.trim()
          ? { note: exception.trim() }
          : {}),
      }),
    );
    if (saved && selectionRef.current === selectedKey) {
      setModal(null);
      setException("");
      setToast("Decisión humana guardada");
    }
  };
  const openAiReview = () => {
    setFilter("agent");
    setRightTab("Comentarios");
    setRightOpen(true);
    setShowPins(true);
    const finding =
      pieceComments.find((c) => c.kind === "agent" && !c.resolved) ??
      pieceComments.find((c) => c.kind === "agent");
    if (finding) selectComment(finding.id);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = piece.originalImage ?? piece.image;
    a.download = piece.filename;
    a.click();
  };
  const editComment = async (id: string, body: string) =>
    Boolean(
      await persisted.save(() =>
        persisted.edit({ commentId: id as Id<"qaVisualComments">, body }),
      ),
    );
  const removeComment = async (id: string) => {
    await persisted.save(() =>
      persisted.remove({ commentId: id as Id<"qaVisualComments"> }),
    );
  };
  const linkOffer = async (row: string, ordinal: string, note: string) => {
    if (!currentPiece.pieceId) return;
    const saved = await persisted.save(() =>
      persisted.linkOffer({
        campaignId: campaignId as Id<"qaVisualCampaigns">,
        pieceId: currentPiece.pieceId!,
        row,
        ordinal,
        note,
      }),
    );
    if (saved) setToast("Vínculo guardado. Se está actualizando el pedido.");
  };
  return {
    activeId: currentPiece.id,
    activePieces,
    results,
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
    exceptionReason,
    setExceptionReason,
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
    pendingMark,
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
    detail: data,
    saving: persisted.busy,
    saveError: persisted.error,
    canReview: Boolean(data),
    editComment,
    removeComment,
    linkOffer,
  };
}
export type ReviewSession = ReturnType<typeof useReviewSession>;
