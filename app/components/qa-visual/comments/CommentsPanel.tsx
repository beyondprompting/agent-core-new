import { CommentCard } from "./CommentCard";
import { Building2, Lock, MessageSquare, Send, Settings2, Sparkles, X } from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import { VoiceRecorder } from "@/app/components/qa-visual/voice/VoiceRecorder";
import { useVoiceRecorder } from "@/app/hooks/qa-visual/use-voice-recorder";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function CommentsPanel(sessionProps: { session: ReviewSession }) {
  const { session } = sessionProps;
  const {
    filter,
    saving,
    canReview,
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
  const recorder = useVoiceRecorder();
  const replyingToClient =
    Boolean(replyTo) && pieceComments.find((c) => c.id === replyTo)?.audience === "client";
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
          <option value="source">Avisos de fuente</option>
          <option value="human">Solo personas</option>
          <option value="client">Conversaciones con el cliente</option>
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
        {(session.detail?.moreThreads ||
          session.detail?.threads.some((t) => t.moreComments)) && (
          <p className="info-note">
            Esta vista muestra hasta 200 hilos y 200 entradas por hilo. Hay más
            actividad guardada que aún no se muestra aquí.
          </p>
        )}
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
            <span>
              {replyingToClient
                ? "Respuesta en una conversación con el cliente"
                : "Respuesta a un comentario"}
            </span>
            <button
              aria-label="Cancelar respuesta"
              onClick={() => setReplyTo(null)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {replyingToClient && (
          <div className="qa-reply-modes" role="radiogroup" aria-label="Destino de la respuesta">
            <button
              role="radio"
              aria-checked={session.replyVisibility === "internal"}
              className={session.replyVisibility === "internal" ? "on" : ""}
              onClick={() => session.setReplyVisibility("internal")}
            >
              <Lock size={11} /> Nota interna
            </button>
            <button
              role="radio"
              aria-checked={session.replyVisibility === "client"}
              className={session.replyVisibility === "client" ? "on client" : ""}
              onClick={() => session.setReplyVisibility("client")}
            >
              <Building2 size={11} /> Responder al cliente
            </button>
          </div>
        )}
        <div className="composer-inner">
          <Avatar type="you" name={reviewer} small />
          <textarea
            ref={inputRef}
            maxLength={4000}
            disabled={!canReview || saving}
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
        {replyTo && (recorder.state !== "idle" || recorder.error) && (
          <div style={{ padding: "0 10px 8px" }}>
            <VoiceRecorder recorder={recorder} />
            {recorder.error && <p className="qa-error">{recorder.error}</p>}
          </div>
        )}
        <div className="composer-actions">
          {replyTo && recorder.state === "idle" && (
            <VoiceRecorder recorder={recorder} disabled={!canReview || saving} />
          )}
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
            disabled={
              (recorder.state === "ready" ? false : !draft.trim()) || saving || !canReview || recorder.state === "recording"
            }
            onClick={async () => {
              if (recorder.state === "ready" && recorder.recording) {
                if (await session.publishVoice(recorder.recording)) recorder.discard();
              } else publish();
            }}
          >
            Publicar
            <Send size={12} />
          </button>
        </div>
      </div>
    </>
  );
}
