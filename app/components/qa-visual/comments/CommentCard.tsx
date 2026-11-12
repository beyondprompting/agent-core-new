import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import type { Comment } from "@/app/lib/qa-visual/review-model";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";
export function CommentCard({
  comment: c,
  session: {
    setRightTab,
    selected,
    setSelected,
    setReplyTo,
    inputRef,
    selectComment,
    toggleResolved,
  },
}: {
  comment: Comment;
  session: ReviewSession;
}) {
  return (
    <article
      key={c.id}
      id={`comment-${c.id}`}
      className={`comment-card ${selected === c.id ? "selected" : ""} ${c.resolved ? "resolved" : ""}`}
      onClick={() => setSelected(c.id)}
    >
      <div className="comment-heading">
        <Avatar type={c.kind === "agent" ? "robot" : "you"} name={c.author} />
        <div>
          <div className="comment-author">
            {c.author}
            {c.kind === "agent" && <span className="agent-label">AGENTE</span>}
          </div>
          <span className="comment-time">
            {c.kind === "human" ? c.role : c.role} <span>·</span> {c.time}
          </span>
        </div>
        <button
          className={`resolve-control ${c.resolved ? "is-resolved" : ""}`}
          title={c.resolved ? "Reabrir comentario" : "Resolver comentario"}
          aria-label={
            c.resolved
              ? `Reabrir comentario ${c.marker ?? c.id}`
              : `Resolver comentario ${c.marker ?? c.id}`
          }
          onClick={(e) => {
            e.stopPropagation();
            toggleResolved(c.id);
          }}
        >
          <Check size={14} />
        </button>
      </div>
      <div className="comment-body">
        {c.severity && (
          <span className={`finding-badge ${c.severity}`}>
            {c.severity === "warning" ? (
              <>
                <span />
                Requiere revisión
              </>
            ) : (
              <>
                <CheckCircle2 size={11} />
                Verificado
              </>
            )}
          </span>
        )}
        <p>{c.body}</p>
        {c.expected && c.severity === "warning" && (
          <div className="evidence-box">
            <div>
              <span>ESPERADO</span>
              <p>{c.expected}</p>
            </div>
            <div>
              <span>EN LA PIEZA</span>
              <p>“{c.observed}”</p>
            </div>
          </div>
        )}
        {c.source && (
          <button
            className="source-link"
            onClick={(e) => {
              e.stopPropagation();
              setRightTab("Detalles");
            }}
          >
            <BookOpen size={12} />
            {c.source}
            <ArrowUpRight size={11} />
          </button>
        )}
        <div className="comment-bottom">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReplyTo(c.id);
              inputRef.current?.focus();
            }}
          >
            Responder
          </button>
          {(c.pin || c.marker !== undefined) && (
            <button
              className="location-link"
              onClick={(e) => {
                e.stopPropagation();
                selectComment(c.id);
              }}
            >
              <MessageSquare size={11} /> {c.marker ?? c.id} · {c.pin ? "Ver en imagen" : "Ver referencia"}
            </button>
          )}
          {c.resolved && (
            <span className="resolved-label">
              <CheckCheck size={12} />
              Resuelto
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
