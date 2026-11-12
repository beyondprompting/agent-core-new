import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  MessageSquare,
} from "lucide-react";
import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import { AudioMessage } from "@/app/components/qa-visual/voice/AudioMessage";
import type { Comment } from "@/app/lib/qa-visual/review-model";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function CommentCard({
  comment: c,
  session,
}: {
  comment: Comment;
  session: ReviewSession;
}) {
  const [candidate, setCandidate] = useState(""),
    [note, setNote] = useState("");
  const first =
    c.kind === "human"
      ? session.detail?.threads
          .find((t) => t._id === c.threadId)
          ?.comments.find((c) => !c.event)
      : undefined;
  const canResolve = Boolean(c.threadId || c.finding);
  return (
    <article
      id={`comment-${c.id}`}
      className={`comment-card ${c.kind === "source" ? "source-notice" : ""} ${c.audience === "client" ? "client-thread" : ""} ${session.selected === c.id ? "selected" : ""} ${c.resolved ? "resolved" : ""}`}
      onClick={() => session.setSelected(c.id)}
    >
      <div className="comment-heading">
        {c.kind === "source" ? (
          <BookOpen size={22} />
        ) : (
          <Avatar type={c.kind === "agent" ? "robot" : "you"} name={c.author} />
        )}
        <div>
          <div className="comment-author">
            {c.author}
            {c.kind === "agent" && <span className="agent-label">AGENTE</span>}
            {c.audience === "client" && (
              <span className="qa-tag-client" title="Esta conversación la ve el cliente">
                {c.role === "Cliente" ? "CLIENTE" : "VISIBLE PARA EL CLIENTE"}
              </span>
            )}
          </div>
          <span className="comment-time">
            {c.role}
            {c.time && <> · {c.time}</>}
          </span>
        </div>
        {canResolve && (
          <button
            className={`resolve-control ${c.resolved ? "is-resolved" : ""}`}
            disabled={session.saving || !session.canReview}
            title={c.resolved ? "Reabrir comentario" : "Resolver comentario"}
            aria-label={`${c.resolved ? "Reabrir" : "Resolver"} comentario ${c.marker ?? c.id}`}
            onClick={(e) => {
              e.stopPropagation();
              void session.toggleResolved(c.id);
            }}
          >
            <Check size={14} />
          </button>
        )}
      </div>
      <div className="comment-body">
        {c.severity && (
          <span className={`finding-badge ${c.severity}`}>
            <span />
            {c.severity === "blocking"
              ? "Hallazgo bloqueante"
              : "Requiere revisión"}
          </span>
        )}
        <EditableComment
          id={first?._id}
          body={c.body}
          canEdit={Boolean(first?.canEdit)}
          session={session}
        />
        {c.audio && (
          <AudioMessage
            src={c.audio.url}
            durationMs={c.audio.durationMs}
            transcript={c.audio.transcript}
          />
        )}
        {c.expected && c.kind === "agent" && (
          <div className="evidence-box">
            <div>
              <span>PEDIDO</span>
              <p>{c.expected}</p>
            </div>
            <div>
              <span>VISIBLE</span>
              <p>{c.observed}</p>
            </div>
          </div>
        )}
        {c.source && (
          <button
            className="source-link"
            onClick={(e) => {
              e.stopPropagation();
              session.setRightTab("Detalles");
            }}
          >
            <BookOpen size={12} />
            {c.source}
            <ArrowUpRight size={11} />
          </button>
        )}
        {!!c.issue?.affects.length && (
          <p>
            Afecta:{" "}
            {c.issue.affects
              .map(
                (id) =>
                  ({
                    product: "producto",
                    price: "precio",
                    date: "vigencia",
                    format: "formato",
                    dimensions: "dimensiones",
                    cta: "CTA",
                  })[id] ?? id,
              )
              .join(" · ")}
          </p>
        )}
        {!!c.issue?.candidates?.length && (
          <div className="source-choice">
            <select
              aria-label="Oferta del cliente"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              disabled={session.saving}
            >
              <option value="">Elegir una oferta…</option>
              {c.issue.candidates.map((option, i) => (
                <option
                  key={`${option.row}:${option.ordinal}:${i}`}
                  value={String(i)}
                >
                  {option.ordinal}. {option.text}
                </option>
              ))}
            </select>
            <input
              aria-label="Motivo de vinculación"
              placeholder="Motivo de la confirmación"
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="button secondary"
              disabled={!candidate || !note.trim() || session.saving}
              onClick={() => {
                const option = c.issue?.candidates?.[Number(candidate)];
                if (option)
                  void session.linkOffer(option.row, option.ordinal, note);
              }}
            >
              Confirmar oferta
            </button>
          </div>
        )}
        {!!c.replies?.length && (
          <div className="thread-replies">
            {c.replies.map((reply) => {
              const note = c.audience === "client" && reply.visibility === "internal" && !reply.fromClient;
              return (
                <div key={reply.id} className={note ? "qa-note" : undefined}>
                  {note && <span className="qa-note-label">Nota interna · el cliente no la ve</span>}
                  <strong>{reply.author}</strong>
                  {reply.fromClient && <span className="qa-tag-client">CLIENTE</span>}
                  <small> · {reply.time}</small>
                  {reply.body && (
                    <EditableComment
                      id={reply.id}
                      body={reply.body}
                      canEdit={reply.canEdit}
                      session={session}
                    />
                  )}
                  {reply.audio && (
                    <AudioMessage
                      src={reply.audio.url}
                      durationMs={reply.audio.durationMs}
                      transcript={reply.audio.transcript}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="comment-bottom">
          {canResolve && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                session.setReplyTo(c.id);
                session.inputRef.current?.focus();
              }}
            >
              Responder
            </button>
          )}
          {c.pin && (
            <button
              className="location-link"
              onClick={(e) => {
                e.stopPropagation();
                session.selectComment(c.id);
              }}
            >
              <MessageSquare size={11} />
              {c.marker} · Ver en imagen
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

function EditableComment({
  id,
  body,
  canEdit,
  session,
}: {
  id?: string;
  body: string;
  canEdit: boolean;
  session: ReviewSession;
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(body);
  return editing ? (
    <div className="comment-edit">
      <textarea
        aria-label="Editar comentario"
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="comment-edit-actions">
        <button
          disabled={session.saving || !text.trim()}
          onClick={async () => {
            if (id && (await session.editComment(id, text))) setEditing(false);
          }}
        >
          Guardar
        </button>
        <button onClick={() => setEditing(false)}>Cancelar</button>
      </div>
    </div>
  ) : (
    <>
      <p style={{ whiteSpace: "pre-wrap" }}>{body}</p>
      {canEdit && id && (
        <div className="comment-edit-actions">
          <button
            disabled={session.saving}
            onClick={() => {
              setText(body);
              setEditing(true);
            }}
          >
            Editar
          </button>
          <button
            disabled={session.saving}
            onClick={() => void session.removeComment(id)}
          >
            Eliminar
          </button>
        </div>
      )}
    </>
  );
}
