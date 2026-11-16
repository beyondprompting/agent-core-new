"use client";

import { useRef } from "react";

import { ArrowUpRight, BadgeCheck, Bot, Building2, Check, CheckCheck, Columns3, ListFilter, Lock, MessageSquare, Reply, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { FinalApprovalBanner } from "@/app/components/qa-visual/piece/review-status";
import { ClientAsks, VersionTrail } from "@/app/components/qa-visual/piece/VersionTrail";
import { carouselOrder, hasFinalApproval } from "@/app/lib/qa-visual/piece-filters";
import { CarouselShell } from "@/app/components/qa-visual/carousel/CarouselShell";
import { humanStateWithClient, internalClientState, needsNewVersion } from "@/app/lib/qa-visual/client-state";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

/** Internal carousel (scene 7): quick review with the three states and client activity. */
export function InternalCarousel({
  session,
  onClose,
  onOpenDetailed,
  onReanalyze,
  reanalyzing,
  pieceHref,
}: {
  session: ReviewSession;
  pieceHref: string;
  onClose: () => void;
  onOpenDetailed: () => void;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}) {
  const { filteredPieces, piece, activeId, choosePiece, aiReview, pieceComments, version } = session;
  const humanReview = humanStateWithClient(session.humanReview, piece.client, version);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const decided = session.humanReview.tone === "success" || needsNewVersion(piece.client);
  // The carousel walks the filtered gallery; the open piece stays until the reviewer moves on.
  const order = carouselOrder(
    filteredPieces.map((p) => p.id),
    session.pieces.map((p) => p.id),
    activeId,
  );
  const index = Math.max(0, order.indexOf(activeId));
  const go = (delta: number) => {
    if (order.length < 2) return;
    choosePiece(order[(index + delta + order.length) % order.length]);
  };
  const client = internalClientState(piece.client);
  const final = hasFinalApproval(piece.client);
  const filtered = session.filters.length > 0 || session.query.trim().length > 0;
  const markers = pieceComments.filter((c) => c.pin);
  const ratio = piece.width && piece.height ? piece.width / piece.height : 1;
  return (
    <CarouselShell
      title={piece.name}
      subtitle={`${piece.format} · v${version}${piece.client ? ` · V${piece.client.clientVersion} enviada en la ronda ${piece.client.deliveryNumber}` : ""}`}
      position={index}
      total={order.length}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
      onClose={onClose}
      onComment={() => commentRef.current?.focus()}
      toolbar={
        <>
        {filtered && (
          <span className="qa-carousel-filter" title="El carrusel recorre solo las piezas del filtro activo">
            <ListFilter size={13} /> Filtrado
          </span>
        )}
        <a
          className="qa-carousel-btn"
          href={pieceHref}
          onClick={(e) => {
            // Plain click opens the piece here; Cmd/Ctrl-click keeps the link for a new tab.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpenDetailed();
          }}
        >
          <Columns3 size={14} />
          <span>Ir a la pieza</span>
        </a>
        </>
      }
      stage={
        <div
          className="qa-carousel-art"
          style={{
            aspectRatio: ratio,
            width: `min(100cqw, calc(100cqh * ${ratio}))`,
          }}
        >
          {piece.image ? (
            <img src={piece.image} alt={piece.name} draggable={false} />
          ) : (
            <span className="qa-carousel-wait">{piece.imageError ?? "Preparando imagen…"}</span>
          )}
          {piece.image &&
            markers.map((c) => {
              const thread = session.detail?.threads.find((t) => t._id === c.threadId);
              const kind = thread?.audience === "client" ? "client" : c.kind === "agent" ? "agent" : "human";
              return (
                <span
                  key={c.id}
                  className={`qa-pin ${kind}`}
                  style={{ left: `${c.pin!.x}%`, top: `${c.pin!.y}%` }}
                  title={c.body}
                >
                  {c.marker}
                </span>
              );
            })}
        </div>
      }
      panel={
        <>
          <div className="qa-panel-section">
            <FinalApprovalBanner client={piece.client} humanApproved={humanReview.tone === "success"} />
            <VersionTrail session={session} />
            <ClientAsks asks={session.detail?.clientAsks ?? null} />
            <h4>Estados de esta versión</h4>
            <div className={`qa-state tone-${aiReview.tone}`}>
              <Bot size={15} />
              <div>
                <small>IA</small>
                <b>{aiReview.title}</b>
                <span>{aiReview.detail}</span>
              </div>
              {onReanalyze && (
                <button
                  className="icon-button"
                  disabled={reanalyzing}
                  title="Volver a analizar esta versión"
                  aria-label="Volver a analizar esta versión"
                  onClick={onReanalyze}
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
            <div className={`qa-state tone-${humanReview.tone}`}>
              <ShieldCheck size={15} />
              <div>
                <small>Interna</small>
                <b>{humanReview.title}</b>
                <span>{humanReview.detail}</span>
              </div>
            </div>
            <div className={`qa-state tone-${client.tone} ${final ? "final" : ""}`}>
              {final ? <BadgeCheck size={15} /> : <Building2 size={15} />}
              <div>
                <small>Cliente · definitoria</small>
                <b>{client.label}</b>
                <span>{client.detail}</span>
              </div>
            </div>
          </div>
          <div className="qa-panel-scroll">
            <div className="qa-panel-section">
              <h4>
                <MessageSquare size={12} /> Conversaciones · {pieceComments.length}
              </h4>
              {!pieceComments.length && <p className="qa-muted">Sin comentarios en esta versión.</p>}
              {pieceComments.slice(0, 12).map((c) => {
                const thread = session.detail?.threads.find((t) => t._id === c.threadId);
                const fromClient = thread?.audience === "client";
                const canReply = session.canReview && Boolean(c.threadId || c.finding);
                const replying = session.replyTo === c.id;
                const last = c.replies?.at(-1);
                return (
                  <article key={c.id} className={`qa-mini-comment ${fromClient ? "client" : c.kind}`}>
                    <b>
                      {c.author}
                      {fromClient && <span className="qa-tag-client">Cliente</span>}
                      {c.resolved && <span className="qa-mini-resolved"><Check size={10} /> Resuelto</span>}
                    </b>
                    <p>{c.body || (thread?.comments[0]?.audio ? "Comentario de voz" : "")}</p>
                    {last && (
                      <div className={`qa-mini-reply ${last.visibility === "internal" && fromClient ? "note" : ""}`}>
                        <b>
                          {last.author}
                          {fromClient && last.visibility === "internal" && <span className="qa-mini-note"><Lock size={9} /> Nota interna</span>}
                        </b>
                        <p>{last.body || "Audio"}</p>
                        {c.replies!.length > 1 && <small>{c.replies!.length} respuestas</small>}
                      </div>
                    )}
                    {replying ? (
                      <div className="qa-mini-composer">
                        {fromClient && (
                          <div className="qa-reply-modes" role="radiogroup" aria-label="Destino de la respuesta">
                            <button
                              role="radio"
                              aria-checked={session.replyVisibility === "client"}
                              className={session.replyVisibility === "client" ? "on client" : ""}
                              onClick={() => session.setReplyVisibility("client")}
                            >
                              <Building2 size={11} /> Al cliente
                            </button>
                            <button
                              role="radio"
                              aria-checked={session.replyVisibility === "internal"}
                              className={session.replyVisibility === "internal" ? "on" : ""}
                              onClick={() => session.setReplyVisibility("internal")}
                            >
                              <Lock size={11} /> Nota interna
                            </button>
                          </div>
                        )}
                        <textarea
                          autoFocus
                          value={session.draft}
                          maxLength={4000}
                          rows={3}
                          disabled={session.saving}
                          placeholder={fromClient && session.replyVisibility === "client" ? "Respuesta para el cliente…" : "Escribí una respuesta…"}
                          aria-label="Respuesta"
                          onChange={(e) => session.setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            // Keep carousel shortcuts out of the composer.
                            e.stopPropagation();
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              void session.publish();
                            }
                            if (e.key === "Escape") session.setReplyTo(null);
                          }}
                        />
                        <div className="qa-mini-composer-actions">
                          <button className="button secondary" onClick={() => session.setReplyTo(null)} disabled={session.saving}>
                            Cancelar
                          </button>
                          <button
                            className="button primary"
                            onClick={() => void session.publish()}
                            disabled={session.saving || !session.draft.trim()}
                          >
                            <Send size={13} />
                            {fromClient && session.replyVisibility === "client" ? "Enviar al cliente" : "Responder"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="qa-mini-actions">
                        {canReply && (
                          <button
                            onClick={() => {
                              session.setDraft("");
                              session.setReplyTo(c.id);
                              // From the carousel, answering a client thread goes to the client by default.
                              if (fromClient) session.setReplyVisibility("client");
                            }}
                          >
                            <Reply size={12} /> Responder
                          </button>
                        )}
                        <button
                          onClick={() => {
                            onOpenDetailed();
                            session.selectComment(c.id, { highlight: true });
                          }}
                        >
                          <ArrowUpRight size={12} /> Ver en la pieza
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
              {pieceComments.length > 12 && (
                <button className="qa-link" onClick={onOpenDetailed}>
                  Ver las {pieceComments.length} conversaciones en la pieza
                </button>
              )}
            </div>
          </div>
          {session.canReview && !session.replyTo && (
            // New comments go straight from the carousel; no need to open the editor.
            <div className="qa-carousel-composer">
              <textarea
                ref={commentRef}
                value={session.draft}
                maxLength={4000}
                rows={2}
                disabled={session.saving}
                placeholder={`Comentá la v${version}…`}
                aria-label="Nuevo comentario"
                onChange={(e) => session.setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void session.publish();
                  }
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <div className="qa-carousel-composer-bar">
                <span>Nota interna · ⌘/Ctrl + Enter</span>
                <button
                  className="button primary"
                  onClick={() => void session.publish()}
                  disabled={session.saving || !session.draft.trim()}
                >
                  <Send size={13} /> Publicar
                </button>
              </div>
            </div>
          )}
          <div className="qa-panel-actions">
            <button
              className={`button ${decided ? "secondary" : "primary"}`}
              onClick={() => session.setModal("approval")}
              disabled={!session.canReview}
            >
              <CheckCheck size={14} />
              {decided ? "Ver decisión" : "Aprobar esta versión"}
            </button>
          </div>
        </>
      }
    />
  );
}
