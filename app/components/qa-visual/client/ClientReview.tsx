"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  MapPin,
  MessageSquare,
  MessageSquarePlus,
  MousePointer2,
  RotateCcw,
  Eye,
  FileText,
  Square,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GalleryGrid } from "@/app/components/qa-visual/gallery/GalleryGrid";
import { CarouselShell } from "@/app/components/qa-visual/carousel/CarouselShell";
import { AudioMessage } from "@/app/components/qa-visual/voice/AudioMessage";
import { VoiceRecorder } from "@/app/components/qa-visual/voice/VoiceRecorder";
import { uploadRecording, useVoiceRecorder } from "@/app/hooks/qa-visual/use-voice-recorder";
import { portalClientState, type ClientState } from "@/app/lib/qa-visual/client-state";
import { carouselOrder } from "@/app/lib/qa-visual/piece-filters";
import { ProgressSummary } from "./ProgressSummary";

type Tab = "pending" | "changes" | "approved";
type PieceData = FunctionReturnType<typeof api.qaVisual.clientPortal.piece>;

const media = (params: Record<string, string>) =>
  `/workspace/reviews/media?${new URLSearchParams(params)}`;
const errorText = (error: unknown, fallback: string) => {
  const data = error instanceof ConvexError ? error.data : null;
  return typeof data === "string" ? data : (data?.message ?? fallback);
};
const inTab = (state: ClientState, tab: Tab) =>
  (tab === "approved" && state === "approved") ||
  (tab === "changes" && state === "changesRequested") ||
  (tab === "pending" && (state === "sent" || state === "viewed"));

/** Client portal for one campaign (scenes 9–11): gallery, carousel, brief, comments and decision. */
export function ClientReview({ campaignId }: { campaignId: string }) {
  const id = campaignId as Id<"qaVisualCampaigns">;
  const data = useQuery(api.qaVisual.clientPortal.gallery, { campaignId: id });
  // Checkbox filters: states add up; «Con comentarios» and «Nuevas versiones» narrow the result.
  const [states, setStates] = useState<Tab[]>(["pending"]);
  const [withComments, setWithComments] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pieza"),
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openId) url.searchParams.set("pieza", openId);
    else url.searchParams.delete("pieza");
    window.history.replaceState(window.history.state, "", url);
  }, [openId]);
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          (!states.length || states.some((t) => inTab(item.state, t))) &&
          (!withComments || item.comments > 0) &&
          (!onlyNew || item.isNew),
      ),
    [data, states, withComments, onlyNew],
  );
  // Show everything when nothing is pending, so the client never lands on an empty gallery.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!data || !firstLoad.current) return;
    firstLoad.current = false;
    if (!data.items.some((i) => inTab(i.state, "pending"))) setStates([]);
  }, [data]);
  if (data === undefined)
    return (
      <div className="qa-portal-empty">
        <LoaderCircle size={20} className="animate-spin" />
      </div>
    );
  // The carousel keeps the gallery filter: a piece just approved stays open, but «next» skips approved ones.
  const order = openId
    ? carouselOrder(
        items.map((i) => i.id),
        data.items.map((i) => i.id),
        openId,
      )
    : [];
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Por revisar", count: data.counts.pending },
    { key: "changes", label: "Cambios solicitados", count: data.counts.changes },
    { key: "approved", label: "Aprobadas", count: data.counts.approved },
  ];
  const filtered = states.length > 0 || withComments || onlyNew;
  return (
    <>
      <section className="qa-portal-hero">
        <div>
          <Link href="/workspace/reviews" className="qa-link">
            <ArrowLeft size={13} /> Todas las revisiones
          </Link>
          {data.delivery && (
            <div className="qa-portal-eyebrow" style={{ marginTop: 10 }}>
              <Send size={13} /> Ronda {data.delivery.number} · enviada el{" "}
              {new Date(data.delivery.publishedAt).toLocaleDateString()}
            </div>
          )}
          <h1>{data.campaign.name}</h1>
          <p>Revisá cada pieza: cada comentario le llega a la agencia como un cambio a realizar. Aprobala cuando esté lista.</p>
          {data.delivery?.message && (
            <div className="qa-portal-message">
              <b>{data.campaign.agencyLabel}</b>
              <span>{data.delivery.message}</span>
            </div>
          )}
        </div>
        <ProgressSummary counts={data.counts} />
      </section>
      <div className="qa-portal-tabs qa-filters" role="group" aria-label="Filtrar piezas">
        {tabs.map((t) => (
          <label key={t.key} className={`qa-filter-check ${states.includes(t.key) ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={states.includes(t.key)}
              onChange={() =>
                setStates((prev) => (prev.includes(t.key) ? prev.filter((k) => k !== t.key) : [...prev, t.key]))
              }
            />
            <span>{t.label}</span>
            <em>{t.count}</em>
          </label>
        ))}
        <span className="qa-filter-divider" />
        <label className={`qa-filter-check ${withComments ? "on" : ""}`}>
          <input type="checkbox" checked={withComments} onChange={() => setWithComments((v) => !v)} />
          <span>Con comentarios</span>
        </label>
        <label className={`qa-filter-check ${onlyNew ? "on" : ""}`}>
          <input type="checkbox" checked={onlyNew} onChange={() => setOnlyNew((v) => !v)} />
          <span>Nuevas versiones</span>
        </label>
        <span className="qa-gallery-count">
          {filtered ? `${items.length} de ${data.counts.total} piezas` : `${data.counts.total} piezas`}
        </span>
        {filtered && (
          <button
            type="button"
            className="qa-filter-clear"
            onClick={() => {
              setStates([]);
              setWithComments(false);
              setOnlyNew(false);
            }}
          >
            <X size={12} /> Ver todas
          </button>
        )}
      </div>
      <GalleryGrid
        onOpen={setOpenId}
        empty={<p>No hay piezas con estos filtros.</p>}
        items={items.map((item) => {
          const label = portalClientState(item.state);
          return {
            id: item.id,
            accent:
              item.state === "changesRequested"
                ? ("danger" as const)
                : item.state === "approved"
                  ? ("success" as const)
                  : item.isNew
                    ? ("client" as const)
                    : undefined,
            title: item.title,
            meta: item.format,
            src: media({ item: item.id, variant: "preview" }),
            width: item.image?.width,
            height: item.image?.height,
            badge: (
              <span className={`qa-version-badge ${item.isNew ? "new" : ""}`}>
                V{item.clientVersion}
                {item.isNew ? " · Nueva versión" : ""}
              </span>
            ),
            footer: (
              <>
                <span className={`qa-chip tone-${label.tone}`}>{label.label}</span>
                {item.comments > 0 && (
                  <span className="qa-muted">
                    <MessageSquare size={11} /> {item.comments}
                  </span>
                )}
              </>
            ),
          };
        })}
      />
      {openId && order.length > 0 && (
        <ClientCarousel
          order={order}
          currentId={openId}
          onChange={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

type Mark =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number };
type Tool = "select" | "pin" | "rect";
const TOOLS: { key: Tool; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { key: "select", label: "Ver y moverse", shortcut: "V", icon: <MousePointer2 size={15} /> },
  { key: "pin", label: "Comentar en un punto", shortcut: "C", icon: <MessageSquarePlus size={15} /> },
  { key: "rect", label: "Marcar un área", shortcut: "R", icon: <Square size={15} /> },
];

function ClientCarousel({
  order,
  currentId,
  onChange,
  onClose,
}: {
  order: string[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  // The version selector can show a previous version (read-only) of the same piece.
  const [viewing, setViewing] = useState(currentId);
  useEffect(() => setViewing(currentId), [currentId]);
  const data = useQuery(api.qaVisual.clientPortal.piece, {
    itemId: viewing as Id<"qaVisualDeliveryItems">,
  });
  const markViewed = useMutation(api.qaVisual.clientPortal.markViewed);
  useEffect(() => {
    void markViewed({ itemId: currentId as Id<"qaVisualDeliveryItems"> }).catch(() => undefined);
  }, [currentId, markViewed]);
  const index = Math.max(0, order.indexOf(currentId));
  const go = (delta: number) => {
    if (order.length < 2) return;
    onChange(order[(index + delta + order.length) % order.length]);
  };
  const [tool, setTool] = useState<Tool>("select");
  const [mark, setMark] = useState<Mark | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const canMark = Boolean(data?.canComment);
  useEffect(() => {
    setTool("select");
    setMark(null);
    setDrag(null);
  }, [viewing]);
  // V / C / R switch tools like the internal viewer; typing in the composer is never intercepted.
  useEffect(() => {
    if (!canMark) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "v") setTool("select");
      else if (key === "r") setTool("rect");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canMark]);
  const at = (event: React.PointerEvent) => {
    const box = artRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };
  const placed = (next: Mark) => {
    setMark(next);
    setTool("select");
    setTimeout(() => composerRef.current?.focus(), 0);
  };
  const marking = canMark && tool !== "select";
  const pins = (data?.threads ?? []).flatMap((t, i) =>
    t.anchor.kind === "point" || t.anchor.kind === "rect" ? [{ id: t.id, n: i + 1, anchor: t.anchor }] : [],
  );
  const dimensions = data?.item.image;
  const ratio = dimensions?.width && dimensions.height ? dimensions.width / dimensions.height : 1;
  const box = (m: { x: number; y: number; width: number; height: number }) => ({
    left: `${m.x * 100}%`,
    top: `${m.y * 100}%`,
    width: `${m.width * 100}%`,
    height: `${m.height * 100}%`,
  });
  return (
    <CarouselShell
      title={data?.item.title ?? "Pieza"}
      subtitle={
        data
          ? `${data.item.format} · Versión ${data.item.clientVersion} · Ronda ${data.item.deliveryNumber}`
          : undefined
      }
      position={index}
      total={order.length}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
      onClose={() => {
        // Esc first cancels an active tool or an unsent mark, then closes.
        if (tool !== "select" || mark) {
          setTool("select");
          setMark(null);
          setDrag(null);
        } else onClose();
      }}
      closeLabel="Volver a la galería"
      closeIcon={<ArrowLeft size={18} />}
      panelClassName="qa-client-panel"
      onComment={canMark ? () => setTool("pin") : undefined}
      toolbar={
        canMark ? (
          <div className="qa-client-tools" role="toolbar" aria-label="Herramientas de comentario">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tool === t.key ? "on" : ""}
                aria-pressed={tool === t.key}
                aria-label={`${t.label} (${t.shortcut})`}
                title={`${t.label} · ${t.shortcut}`}
                onClick={() => {
                  setTool(t.key);
                  if (t.key !== "select") setMark(null);
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>
        ) : undefined
      }
      stage={
        <div
          ref={artRef}
          className={`qa-carousel-art ${marking ? "picking" : ""}`}
          style={{
            aspectRatio: ratio,
            width: `min(100cqw, calc(100cqh * ${ratio}))`,
          }}
          onPointerDown={(e) => {
            if (!marking) return;
            // Keep the gesture out of the swipe navigation.
            e.stopPropagation();
            e.preventDefault();
            const p = at(e);
            if (tool === "pin") return placed({ kind: "point", ...p });
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = at(e);
            setDrag({ ...drag, x: p.x, y: p.y });
          }}
          onPointerUp={(e) => {
            if (!drag) return;
            e.stopPropagation();
            const width = Math.abs(drag.x - drag.x0);
            const height = Math.abs(drag.y - drag.y0);
            setDrag(null);
            // A click with the area tool becomes a point.
            if (width < 0.02 && height < 0.02) placed({ kind: "point", x: drag.x0, y: drag.y0 });
            else
              placed({
                kind: "rect",
                x: Math.min(drag.x, drag.x0),
                y: Math.min(drag.y, drag.y0),
                width,
                height,
              });
          }}
        >
          <img
            key={viewing}
            src={media({ item: viewing, variant: "analysis" })}
            alt={data?.item.title ?? ""}
            draggable={false}
          />
          {pins.map((p) =>
            p.anchor.kind === "rect" ? (
              <span key={p.id} className="qa-mark-rect" style={box(p.anchor)}>
                <span className="qa-pin client">{p.n}</span>
              </span>
            ) : (
              <span
                key={p.id}
                className="qa-pin client"
                style={{ left: `${p.anchor.x * 100}%`, top: `${p.anchor.y * 100}%` }}
              >
                {p.n}
              </span>
            ),
          )}
          {drag && (
            <span
              className="qa-mark-rect draft"
              style={box({
                x: Math.min(drag.x, drag.x0),
                y: Math.min(drag.y, drag.y0),
                width: Math.abs(drag.x - drag.x0),
                height: Math.abs(drag.y - drag.y0),
              })}
            />
          )}
          {mark?.kind === "rect" && (
            <span className="qa-mark-rect draft" style={box(mark)}>
              <span className="qa-pin draft">+</span>
            </span>
          )}
          {mark?.kind === "point" && (
            <span className="qa-pin draft" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}>
              +
            </span>
          )}
          {marking && (
            <span className="qa-tool-hint">
              {tool === "pin" ? "Tocá donde querés el cambio" : "Arrastrá para marcar el área"}
            </span>
          )}
        </div>
      }
      panel={
        data ? (
          <PiecePanel
            data={data}
            onSelectVersion={setViewing}
            mark={mark}
            clearMark={() => setMark(null)}
            composerRef={composerRef}
          />
        ) : (
          <div className="qa-panel-section">
            <LoaderCircle size={16} className="animate-spin" />
          </div>
        )
      }
    />
  );
}

function PiecePanel({
  data,
  onSelectVersion,
  mark,
  clearMark,
  composerRef,
}: {
  data: PieceData;
  onSelectVersion: (id: string) => void;
  mark: Mark | null;
  clearMark: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const decide = useMutation(api.qaVisual.clientPortal.decide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = portalClientState(data.item.state);
  const approved = data.item.state === "approved";
  const openRequests = data.threads.filter((t) => !t.resolved).length;
  async function approve() {
    setBusy(true);
    setError("");
    try {
      await decide({
        itemId: data.item.id,
        decision: "approved",
        expectedDecisionId: data.decision?.id ?? null,
      });
    } catch (e) {
      setError(errorText(e, "No se pudo guardar tu aprobación. Intentá de nuevo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={`qa-cp-head tone-${state.tone}`}>
        <div className="qa-cp-state">
          <span className="qa-cp-state-icon">
            {approved ? <Check size={16} /> : data.item.state === "changesRequested" ? <MessageSquare size={15} /> : <Eye size={15} />}
          </span>
          <div>
            <small>Estado de la pieza</small>
            <b>{state.label}</b>
          </div>
        </div>
        {data.versions.length > 1 ? (
          <div className="qa-versions" role="tablist" aria-label="Versiones">
            {data.versions.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={v.id === data.item.id}
                className={v.id === data.item.id ? "on" : ""}
                onClick={() => onSelectVersion(v.id)}
              >
                V{v.clientVersion}
                {v.current ? " · actual" : ""}
              </button>
            ))}
          </div>
        ) : (
          <span className="qa-cp-version">V{data.item.clientVersion}</span>
        )}
      </div>
      <div className="qa-panel-scroll">
        {data.readOnly && (
          <div className="qa-panel-section">
            <p className="qa-muted">Esta versión fue reemplazada. Podés verla, pero los comentarios y la decisión van en la versión actual.</p>
          </div>
        )}
        {data.previousAsks.length > 0 && (
          <div className="qa-panel-section">
            <h4><RotateCcw size={12} /> Lo que pediste en la versión anterior</h4>
            <ul className="qa-prev-asks">
              {data.previousAsks.map((ask, i) => (
                <li key={i}>{ask.text}</li>
              ))}
            </ul>
          </div>
        )}
        {data.item.fields.length > 0 && (
          <div className="qa-panel-section">
            <h4><FileText size={12} /> Lo que pediste</h4>
            <dl className="qa-brief qa-cp-brief">
              {data.item.fields.map((f) => (
                <div key={f.key} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="qa-panel-section">
          <h4>
            <MessageSquare size={12} /> Cambios pedidos
            <span className="qa-cp-count">{data.threads.length}</span>
          </h4>
          {!data.threads.length && (
            <p className="qa-cp-empty">
              {data.canComment
                ? "¿Hay algo para cambiar? Escribilo abajo o usá las herramientas de arriba para marcar un punto o un área de la imagen."
                : "No hay comentarios en esta versión."}
            </p>
          )}
          {data.threads.map((thread, i) => (
            <ThreadView
              key={thread.id}
              thread={thread}
              n={thread.anchor.kind === "point" || thread.anchor.kind === "rect" ? i + 1 : undefined}
              canReply={data.canComment}
            />
          ))}
        </div>
      </div>
      {data.canComment && (
        <Composer itemId={data.item.id} mark={mark} clearMark={clearMark} textareaRef={composerRef} />
      )}
      {error && (
        <div className="qa-panel-section">
          <p className="qa-error" role="alert">{error}</p>
        </div>
      )}
      {!data.readOnly && data.mode === "client" && (
        <div className="qa-panel-actions qa-decision-bar">
          {approved ? (
            <div className="qa-decided tone-success">
              <Check size={14} />
              Aprobada{data.decision ? ` por ${data.decision.author} · ${new Date(data.decision.at).toLocaleDateString()}` : ""}
            </div>
          ) : data.canApprove ? (
            <>
              <p className="qa-decision-hint">
                {openRequests
                  ? `Pediste ${openRequests} ${openRequests === 1 ? "cambio" : "cambios"}. Si igual está lista, podés aprobarla.`
                  : "Si no hay nada para cambiar, aprobala. Tu aprobación es la final."}
              </p>
              <button className="button primary qa-approve" onClick={() => void approve()} disabled={busy}>
                <span className="qa-approve-icon" aria-hidden>
                  {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                </span>
                {busy ? "Aprobando…" : "Aprobar pieza"}
              </button>
            </>
          ) : (
            <p className="qa-decision-hint">
              {openRequests
                ? "Tus comentarios ya le llegaron a la agencia como cambios a realizar."
                : "Dejá tus comentarios; la aprobación la realiza otra persona de tu equipo."}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function ThreadView({
  thread,
  n,
  canReply,
}: {
  thread: PieceData["threads"][number];
  n?: number;
  canReply: boolean;
}) {
  const remove = useMutation(api.qaVisual.clientPortal.removeComment);
  const [first, ...replies] = thread.comments;
  const [replying, setReplying] = useState(false);
  if (!first) return null;
  const when = (at: number) =>
    new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const entry = (c: typeof first) => (
    <div className={`qa-cp-entry ${c.authorKind === "agency" ? "agency" : "client"}`}>
      <span className="qa-cp-avatar" aria-hidden>
        {c.author.replace(/^.*·\s*/, "").slice(0, 1).toUpperCase() || "?"}
      </span>
      <div className="qa-cp-entry-body">
        <header>
          <b>{c.author}</b>
          {c.authorKind === "agency" && <span className="qa-cp-tag">Agencia</span>}
          <small>{when(c.at)}</small>
          {c.canDelete && (
            <button
              className="qa-cp-delete"
              aria-label="Borrar comentario"
              title="Borrar comentario"
              onClick={() => void remove({ commentId: c.id })}
            >
              <Trash2 size={12} />
            </button>
          )}
        </header>
        {c.body && <p>{c.body}</p>}
        {c.audio && (
          <AudioMessage src={media({ audio: c.id })} durationMs={c.audio.durationMs} transcript={c.transcript} />
        )}
      </div>
    </div>
  );
  return (
    <article className={`qa-cp-thread ${thread.resolved ? "resolved" : ""}`}>
      <div className="qa-cp-thread-head">
        {n ? <span className="qa-cp-num">{n}</span> : <span className="qa-cp-num general"><MessageSquare size={11} /></span>}
        <span>
          {thread.anchor.kind === "rect" ? "Área de la imagen" : thread.anchor.kind === "point" ? "Punto de la imagen" : "Comentario general"}
        </span>
        <span className={`qa-cp-status ${thread.resolved ? "done" : ""}`}>
          {thread.resolved ? <><Check size={11} /> Resuelto</> : "Cambio pedido"}
        </span>
      </div>
      {entry(first)}
      {replies.length > 0 && (
        <div className="qa-cp-replies">
          {replies.map((r) => (
            <div key={r.id}>{entry(r)}</div>
          ))}
        </div>
      )}
      {canReply &&
        (replying ? (
          <Composer threadId={thread.id} onDone={() => setReplying(false)} />
        ) : (
          <button className="qa-cp-reply" onClick={() => setReplying(true)}>
            Responder
          </button>
        ))}
    </article>
  );
}

/**
 * Text or voice comment. Every client comment is a change request for the agency. New threads
 * may carry a point or an area of the image; replies go to a thread.
 */
function Composer({
  itemId,
  threadId,
  mark,
  clearMark,
  textareaRef,
  onDone,
}: {
  itemId?: Id<"qaVisualDeliveryItems">;
  threadId?: Id<"qaVisualThreads">;
  mark?: Mark | null;
  clearMark?: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onDone?: () => void;
}) {
  const create = useMutation(api.qaVisual.clientPortal.createComment);
  const reply = useMutation(api.qaVisual.clientPortal.reply);
  const uploadUrl = useMutation(api.qaVisual.audio.generateUploadUrl);
  const recorder = useVoiceRecorder();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ storageId: string; durationMs: number } | null>(null);
  const ready = recorder.state === "ready" && recorder.recording;
  async function send() {
    if (!text.trim() && !ready) return;
    setBusy(true);
    setError("");
    try {
      // The uploaded audio is kept if the comment fails, so «Reintentar» does not upload twice.
      if (ready && !pending.current)
        pending.current = await uploadRecording(() => uploadUrl({}), recorder.recording!);
      const audio = pending.current
        ? { storageId: pending.current.storageId as Id<"_storage">, durationMs: pending.current.durationMs }
        : undefined;
      const body = text.trim() || undefined;
      if (threadId) await reply({ threadId, body, audio, requestId: crypto.randomUUID() });
      else if (itemId)
        await create({
          itemId,
          anchor: mark ?? { kind: "general" },
          body,
          audio,
          requestId: crypto.randomUUID(),
        });
      pending.current = null;
      recorder.discard();
      setText("");
      clearMark?.();
      onDone?.();
    } catch (e) {
      setError(errorText(e, "No se pudo enviar. Revisá la conexión y tocá «Enviar» de nuevo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="qa-composer">
      {!threadId && (
        <div className="qa-composer-context">
          <span>
            {mark ? <MapPin size={11} /> : <MessageSquarePlus size={11} />}
            {mark?.kind === "rect"
              ? "Cambio en el área marcada"
              : mark
                ? "Cambio en el punto marcado"
                : "Cada comentario se envía a la agencia como un cambio a realizar"}
          </span>
          {mark && (
          <button className="icon-button" aria-label="Quitar marca" onClick={clearMark} style={{ width: 22, height: 22 }}>
            <X size={12} />
          </button>
          )}
        </div>
      )}
      {recorder.state === "idle" ? (
        <textarea
          ref={textareaRef}
          value={text}
          maxLength={4000}
          placeholder={threadId ? "Escribí una respuesta…" : "Contá qué hay que cambiar o grabá un audio…"}
          aria-label={threadId ? "Respuesta" : "Comentario"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
      ) : (
        <div style={{ padding: 8 }}>
          <VoiceRecorder recorder={recorder} />
        </div>
      )}
      {(error || recorder.error) && <p className="qa-error" style={{ padding: "0 10px" }}>{error || recorder.error}</p>}
      <div className="qa-composer-bar">
        {recorder.state === "idle" && <VoiceRecorder recorder={recorder} disabled={busy} />}
        {recorder.state === "idle" && recorder.supported && <span className="qa-muted">Audio de hasta 3 min</span>}
        <span className="qa-grow" />
        {onDone && (
          <button className="button secondary" onClick={onDone} disabled={busy} style={{ height: 30 }}>
            Cancelar
          </button>
        )}
        <button
          className="button primary"
          style={{ height: 30 }}
          disabled={busy || recorder.state === "recording" || (!text.trim() && !ready)}
          onClick={() => void send()}
          aria-label="Enviar comentario"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
          {error ? "Reintentar" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
