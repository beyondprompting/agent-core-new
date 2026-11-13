"use client";

import { BadgeCheck, Bot, Building2, CheckCheck, Columns3, ListFilter, MessageSquare, RotateCcw, ShieldCheck } from "lucide-react";
import { FinalApprovalBanner } from "@/app/components/qa-visual/piece/review-status";
import { carouselOrder, hasFinalApproval } from "@/app/lib/qa-visual/piece-filters";
import { CarouselShell } from "@/app/components/qa-visual/carousel/CarouselShell";
import { internalClientState } from "@/app/lib/qa-visual/client-state";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

/** Internal carousel (scene 7): quick review with the three states and client activity. */
export function InternalCarousel({
  session,
  onClose,
  onOpenDetailed,
  onReanalyze,
  reanalyzing,
}: {
  session: ReviewSession;
  onClose: () => void;
  onOpenDetailed: () => void;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}) {
  const { filteredPieces, piece, activeId, choosePiece, aiReview, humanReview, pieceComments, version } =
    session;
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
  const clientThreads = (session.detail?.threads ?? []).filter((t) => t.audience === "client");
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
      onComment={onOpenDetailed}
      toolbar={
        <>
        {filtered && (
          <span className="qa-carousel-filter" title="El carrusel recorre solo las piezas del filtro activo">
            <ListFilter size={13} /> Filtrado
          </span>
        )}
        <button className="qa-carousel-btn" onClick={onOpenDetailed}>
          <Columns3 size={14} />
          Abrir en revisión detallada
        </button>
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
              {pieceComments.slice(0, 8).map((c) => {
                const thread = session.detail?.threads.find((t) => t._id === c.threadId);
                const fromClient = thread?.audience === "client";
                return (
                  <article key={c.id} className={`qa-mini-comment ${fromClient ? "client" : c.kind}`}>
                    <b>
                      {c.author}
                      {fromClient && <span className="qa-tag-client">Cliente</span>}
                    </b>
                    <p>{c.body || (thread?.comments[0]?.audio ? "Comentario de voz" : "")}</p>
                  </article>
                );
              })}
              {clientThreads.length > 0 && (
                <p className="qa-muted">
                  {clientThreads.length} {clientThreads.length === 1 ? "conversación" : "conversaciones"} con el cliente. Respondé desde la revisión detallada.
                </p>
              )}
            </div>
          </div>
          <div className="qa-panel-actions">
            <button className="button secondary" onClick={onOpenDetailed}>
              <MessageSquare size={14} />
              Comentar
            </button>
            <button
              className={`button ${humanReview.tone === "success" ? "secondary" : "primary"}`}
              onClick={() => session.setModal("approval")}
              disabled={!session.canReview}
            >
              <CheckCheck size={14} />
              {humanReview.tone === "success" ? "Ver decisión" : "Aprobar esta versión"}
            </button>
          </div>
        </>
      }
    />
  );
}
