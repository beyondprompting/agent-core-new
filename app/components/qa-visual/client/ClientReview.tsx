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
  RotateCcw,
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
import { ProgressSummary } from "./ProgressSummary";

type Tab = "pending" | "changes" | "approved" | "all";
type PieceData = FunctionReturnType<typeof api.qaVisual.clientPortal.piece>;

const media = (params: Record<string, string>) =>
  `/workspace/reviews/media?${new URLSearchParams(params)}`;
const errorText = (error: unknown, fallback: string) => {
  const data = error instanceof ConvexError ? error.data : null;
  return typeof data === "string" ? data : (data?.message ?? fallback);
};
const inTab = (state: ClientState, tab: Tab) =>
  tab === "all" ||
  (tab === "approved" && state === "approved") ||
  (tab === "changes" && state === "changesRequested") ||
  (tab === "pending" && (state === "sent" || state === "viewed"));

/** Client portal for one campaign (scenes 9–11): gallery, carousel, brief, comments and decision. */
export function ClientReview({ campaignId }: { campaignId: string }) {
  const id = campaignId as Id<"qaVisualCampaigns">;
  const data = useQuery(api.qaVisual.clientPortal.gallery, { campaignId: id });
  const [tab, setTab] = useState<Tab>("pending");
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
    () => (data?.items ?? []).filter((item) => inTab(item.state, tab)),
    [data, tab],
  );
  // Default to «Todas» when nothing is pending, so the client never lands on an empty tab.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!data || !firstLoad.current) return;
    firstLoad.current = false;
    if (!data.items.some((i) => inTab(i.state, "pending"))) setTab("all");
  }, [data]);
  if (data === undefined)
    return (
      <div className="qa-portal-empty">
        <LoaderCircle size={20} className="animate-spin" />
      </div>
    );
  const order = items.length && openId && items.some((i) => i.id === openId) ? items : (data.items ?? []);
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Por revisar", count: data.counts.pending },
    { key: "changes", label: "Cambios solicitados", count: data.counts.changes },
    { key: "approved", label: "Aprobadas", count: data.counts.approved },
    { key: "all", label: "Todas", count: data.counts.total },
  ];
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
          <p>Revisá cada pieza, dejá tus comentarios y aprobala cuando esté lista.</p>
          {data.delivery?.message && (
            <div className="qa-portal-message">
              <b>{data.campaign.agencyLabel}</b>
              <span>{data.delivery.message}</span>
            </div>
          )}
        </div>
        <ProgressSummary counts={data.counts} />
      </section>
      <nav className="qa-portal-tabs" aria-label="Filtrar piezas">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label} <span>{t.count}</span>
          </button>
        ))}
      </nav>
      <GalleryGrid
        onOpen={setOpenId}
        empty={<p>No hay piezas en esta pestaña.</p>}
        items={items.map((item) => {
          const label = portalClientState(item.state);
          return {
            id: item.id,
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
          order={order.map((i) => i.id)}
          currentId={openId}
          onChange={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

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
  const [picking, setPicking] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setPicking(false);
    setPoint(null);
  }, [viewing]);
  const pins = (data?.threads ?? []).flatMap((t, i) =>
    t.anchor.kind === "point" ? [{ id: t.id, n: i + 1, x: t.anchor.x, y: t.anchor.y }] : [],
  );
  const dimensions = data?.item.image;
  const ratio = dimensions?.width && dimensions.height ? dimensions.width / dimensions.height : 1;
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
      onClose={onClose}
      closeLabel="Volver a la galería"
      closeIcon={<ArrowLeft size={18} />}
      onComment={data?.canComment ? () => composerRef.current?.focus() : undefined}
      toolbar={
        data?.canComment ? (
          <button
            className={`qa-carousel-btn ${picking ? "on" : ""}`}
            onClick={() => {
              setPicking((p) => !p);
              setPoint(null);
            }}
            aria-pressed={picking}
          >
            <MapPin size={14} />
            <span>{picking ? "Tocá la imagen" : "Comentar en la imagen"}</span>
          </button>
        ) : undefined
      }
      stage={
        <div
          className={`qa-carousel-art ${picking ? "picking" : ""}`}
          style={{
            aspectRatio: ratio,
            width: `min(100cqw, calc(100cqh * ${ratio}))`,
          }}
          onClick={(e) => {
            if (!picking) return;
            const box = e.currentTarget.getBoundingClientRect();
            const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
            const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
            setPoint({ x, y });
            setPicking(false);
            setTimeout(() => composerRef.current?.focus(), 0);
          }}
        >
          <img
            key={viewing}
            src={media({ item: viewing, variant: "analysis" })}
            alt={data?.item.title ?? ""}
            draggable={false}
          />
          {pins.map((p) => (
            <span
              key={p.id}
              className="qa-pin client"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {p.n}
            </span>
          ))}
          {point && (
            <span className="qa-pin draft" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>
              +
            </span>
          )}
        </div>
      }
      panel={
        data ? (
          <PiecePanel
            data={data}
            onSelectVersion={setViewing}
            point={point}
            clearPoint={() => setPoint(null)}
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
  point,
  clearPoint,
  composerRef,
}: {
  data: PieceData;
  onSelectVersion: (id: string) => void;
  point: { x: number; y: number } | null;
  clearPoint: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const decide = useMutation(api.qaVisual.clientPortal.decide);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = portalClientState(data.item.state);
  async function submit(decision: "approved" | "changesRequested") {
    setBusy(true);
    setError("");
    try {
      await decide({
        itemId: data.item.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        expectedDecisionId: data.decision?.id ?? null,
      });
      setAsking(false);
      setNote("");
    } catch (e) {
      setError(errorText(e, "No se pudo guardar tu decisión. Intentá de nuevo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="qa-panel-section" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <span className={`qa-chip tone-${state.tone}`}>{state.label}</span>
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
      </div>
      <div className="qa-panel-scroll">
        {data.readOnly && (
          <div className="qa-panel-section">
            <p className="qa-muted">Esta versión fue reemplazada. Podés verla, pero los comentarios y la decisión van en la versión actual.</p>
          </div>
        )}
        {data.previousAsks.length > 0 && (
          <div className="qa-panel-section">
            <h4>Lo que pediste en la versión anterior</h4>
            <ul className="qa-prev-asks">
              {data.previousAsks.map((ask, i) => (
                <li key={i}>{ask.text}</li>
              ))}
            </ul>
          </div>
        )}
        {data.item.fields.length > 0 && (
          <div className="qa-panel-section">
            <h4>Lo que pediste</h4>
            <dl className="qa-brief">
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
            <MessageSquare size={12} /> Comentarios · {data.threads.length}
          </h4>
          {!data.threads.length && (
            <p className="qa-muted">
              {data.canComment
                ? "Todavía no hay comentarios. Escribí abajo o tocá «Comentar en la imagen»."
                : "No hay comentarios en esta versión."}
            </p>
          )}
          {data.threads.map((thread, i) => (
            <ThreadView key={thread.id} thread={thread} n={thread.anchor.kind === "point" ? i + 1 : undefined} canReply={data.canComment} />
          ))}
        </div>
      </div>
      {data.canComment && (
        <Composer itemId={data.item.id} point={point} clearPoint={clearPoint} textareaRef={composerRef} />
      )}
      {data.decision && (
        <div className="qa-panel-section">
          <div className={`qa-decided tone-${data.decision.decision === "approved" ? "success" : "danger"}`}>
            {data.decision.decision === "approved" ? <Check size={14} /> : <RotateCcw size={14} />}
            {data.decision.decision === "approved" ? "Aprobada" : "Pediste cambios"} por {data.decision.author} ·{" "}
            {new Date(data.decision.at).toLocaleString()}
          </div>
        </div>
      )}
      {asking && (
        <div className="qa-panel-section">
          <label className="qa-field">
            <span>¿Qué hay que cambiar? <small>(opcional si ya dejaste comentarios)</small></span>
            <textarea value={note} rows={3} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      )}
      {error && (
        <div className="qa-panel-section">
          <p className="qa-error" role="alert">{error}</p>
        </div>
      )}
      {!data.readOnly && data.mode === "client" && (
        <div className="qa-panel-actions">
          {asking ? (
            <>
              <button className="button secondary" onClick={() => setAsking(false)} disabled={busy}>
                <X size={14} /> Cancelar
              </button>
              <button className="button primary" onClick={() => void submit("changesRequested")} disabled={busy}>
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Enviar cambios
              </button>
            </>
          ) : (
            <>
              <button className="button secondary" onClick={() => setAsking(true)} disabled={busy}>
                <RotateCcw size={14} /> Solicitar cambios
              </button>
              {data.canApprove ? (
                <button
                  className="button primary qa-approve"
                  onClick={() => void submit("approved")}
                  disabled={busy || data.item.state === "approved"}
                >
                  {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                  {data.item.state === "approved" ? "Aprobada" : "Aprobar pieza"}
                </button>
              ) : (
                <span className="qa-muted">La aprobación la realiza otra persona de tu equipo.</span>
              )}
            </>
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
  const entry = (c: typeof first) => (
    <>
      <header>
        <b>{c.author}</b>
        <small>{new Date(c.at).toLocaleString()}</small>
        {c.canDelete && (
          <button
            className="icon-button"
            style={{ marginLeft: "auto", width: 24, height: 24 }}
            aria-label="Borrar comentario"
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
    </>
  );
  return (
    <article className={`qa-portal-comment ${first.authorKind === "client" ? "mine" : ""}`}>
      {n && <span className="qa-pin client" style={{ position: "static", transform: "none", float: "right", width: 22, height: 22, minWidth: 22 }}>{n}</span>}
      {entry(first)}
      {replies.map((r) => (
        <div key={r.id} className="qa-portal-reply">
          {entry(r)}
        </div>
      ))}
      {canReply &&
        (replying ? (
          <Composer threadId={thread.id} onDone={() => setReplying(false)} />
        ) : (
          <button className="qa-link" style={{ marginTop: 6 }} onClick={() => setReplying(true)}>
            Responder
          </button>
        ))}
    </article>
  );
}

/** Text or voice comment. New threads may carry a point on the image; replies go to a thread. */
function Composer({
  itemId,
  threadId,
  point,
  clearPoint,
  textareaRef,
  onDone,
}: {
  itemId?: Id<"qaVisualDeliveryItems">;
  threadId?: Id<"qaVisualThreads">;
  point?: { x: number; y: number } | null;
  clearPoint?: () => void;
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
          anchor: point ? { kind: "point", x: point.x, y: point.y } : { kind: "general" },
          body,
          audio,
          requestId: crypto.randomUUID(),
        });
      pending.current = null;
      recorder.discard();
      setText("");
      clearPoint?.();
      onDone?.();
    } catch (e) {
      setError(errorText(e, "No se pudo enviar. Revisá la conexión y tocá «Enviar» de nuevo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="qa-composer">
      {point && (
        <div className="qa-composer-context">
          <span><MapPin size={11} /> Comentario en el punto marcado</span>
          <button className="icon-button" aria-label="Quitar punto" onClick={clearPoint} style={{ width: 22, height: 22 }}>
            <X size={12} />
          </button>
        </div>
      )}
      {recorder.state === "idle" ? (
        <textarea
          ref={textareaRef}
          value={text}
          maxLength={4000}
          placeholder={threadId ? "Escribí una respuesta…" : "Escribí un comentario o grabá un audio…"}
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
