import { CommentCard } from "./CommentCard";
import { MessageSquare, Send, Settings2, Sparkles, X } from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function CommentsPanel(sessionProps: { session: ReviewSession }) {
  const { session } = sessionProps;
  const {
    filter,
    reviewer,
    setFilter,
    draft,
    setDraft,
    replyTo,
    setReplyTo,
    tool,
    setTool,
    setToast,
    inputRef,
    pieceComments,
    visibleComments,
    aiReview,
    publish,
    openAiReview,
  } = session;
  return (
    <>
      <button
        className={`qa-summary state-${aiReview.tone} ${aiReview.tone === "warning" ? "has-findings" : "no-findings"}`}
        onClick={openAiReview}
      >
        <Avatar type="robot" />
        <div>
          <strong>{aiReview.title}</strong>
          <span>{aiReview.detail}</span>
        </div>
        <span className="ai-badge">
          <Sparkles size={10} />
          IA
        </span>
      </button>
      <div className="comment-filter">
        <select
          aria-label="Filtrar comentarios"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todos los comentarios</option>
          <option value="agent">Solo agentes</option>
          <option value="human">Solo personas</option>
          <option value="open">Sin resolver</option>
        </select>
        <span>{visibleComments.length}</span>
        <button
          className="icon-button"
          title="Mostrar solo comentarios sin resolver"
          onClick={() => setFilter(filter === "open" ? "all" : "open")}
        >
          <Settings2 size={15} />
        </button>
      </div>
      <div className="comments-scroll">
        {visibleComments.map((c) => (
          <CommentCard key={c.id} comment={c} session={session} />
        ))}
        {!visibleComments.length && (
          <div className="empty-state">
            <MessageSquare size={28} />
            <strong>
              {pieceComments.length
                ? "Sin comentarios con este filtro"
                : "Todo listo para tu revisión"}
            </strong>
            <p>
              Agrega un comentario sobre la pieza o marca una región de la
              imagen.
            </p>
            {filter !== "all" && (
              <button onClick={() => setFilter("all")}>Ver todos</button>
            )}
          </div>
        )}
      </div>
      <div className="comment-composer">
        {replyTo && (
          <div className="composer-context">
            <span>{`Respuesta a comentario ${replyTo}`}</span>
            <button
              aria-label="Cancelar respuesta"
              onClick={() => setReplyTo(null)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="composer-inner">
          <Avatar type="you" name={reviewer} small />
          <textarea
            ref={inputRef}
            aria-label="Agregar un comentario"
            placeholder="Escribe un comentario…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                publish();
              }
            }}
          />
        </div>
        <div className="composer-actions">
          <button
            className={tool === "pin" ? "active" : ""}
            title="Marcar un punto en la imagen"
            onClick={() => {
              setTool("pin");
              setToast("Haz clic en la imagen para ubicar tu comentario");
            }}
          >
            <MessageSquare size={15} />
            <span>Marcar en imagen</span>
          </button>
          <button
            className="publish-button"
            disabled={!draft.trim()}
            onClick={publish}
          >
            Publicar
            <Send size={12} />
          </button>
        </div>
      </div>
    </>
  );
}
