import {
  Check,
  CheckCircle2,
  MessageSquare,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";
import { CompactReviewStatus } from "./review-status";

export function ApprovalDialog({ session }: { session: ReviewSession }) {
  const {
    version,
    piece,
    aiReview,
    humanReview,
    latestDecision,
    detail,
    decisionMode,
    setDecisionMode,
    changeRequest,
    setChangeRequest,
    exception,
    setException,
    exceptionReason,
    setExceptionReason,
    requiresException,
    saving,
    canReview,
    saveError,
    setDecision,
    setModal,
  } = session;
  const requestingChanges = decisionMode === "changes";
  const needsComment = requestingChanges || requiresException;
  const comment = requestingChanges ? changeRequest : exception;
  const disabled = saving || !canReview || (needsComment && !comment.trim());
  const revoked = detail?.decision?.decision === "revoked";
  const approved = detail?.decision?.decision === "approved" && !detail.decision.outdated;
  const previousNote = detail?.decision?.note || latestDecision?.exception;

  return (
    <>
      <header className="approval-heading">
        <span className="modal-icon">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id="modal-title">Aprobación humana</h2>
          <p>
            {piece.name} · Versión {version}
          </p>
        </div>
      </header>

      <CompactReviewStatus ai={aiReview} human={humanReview} />

      {latestDecision && (
        <section
          className={`approval-current state-${humanReview.tone}`}
          aria-label="Última decisión"
        >
          <div className="approval-current-heading">
            <div>
              <span>
                Última decisión · {latestDecision.author || "Revisor"}
              </span>
              <strong>
                {revoked ? "Decisión revocada" : humanReview.title}
              </strong>
            </div>
            {detail?.currentDecisionId && !revoked && (
              <button
                type="button"
                className="button secondary approval-revoke"
                disabled={saving || !canReview}
                onClick={() => void setDecision("Pendiente")}
              >
                <Undo2 size={13} />
                Revocar decisión
              </button>
            )}
          </div>
          {previousNote && (
            <p className="approval-previous-note">{previousNote}</p>
          )}
        </section>
      )}

      {saveError && (
        <p className="approval-error" role="alert">{saveError}</p>
      )}

      {approved && !requestingChanges ? (
        <div className="approval-actions">
          <button
            type="button"
            className="button secondary"
            disabled={saving || !canReview}
            onClick={() => setDecisionMode("changes")}
          >
            <MessageSquare size={15} />
            Solicitar cambios
          </button>
          <button type="button" className="button primary" disabled={saving} onClick={() => setModal(null)}>
            Cerrar
          </button>
        </div>
      ) : (
        <form
          className={`approval-form ${requestingChanges ? "requesting-changes" : "approving"}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && (!approved || requestingChanges))
              void setDecision(
                requestingChanges ? "Cambios solicitados" : "Aprobada",
              );
          }}
        >
          {!approved && (
            <fieldset className="approval-options" disabled={saving || !canReview}>
              <legend className="sr-only">
                Elegí tu decisión para esta versión
              </legend>
              <label
                className={`approval-option approve ${!requestingChanges ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="approval-decision"
                  value="approve"
                  checked={!requestingChanges}
                  onChange={() => setDecisionMode("approve")}
                />
                <span className="approval-option-title">
                  <strong>Aprobar</strong>
                  <span className="approval-option-check" aria-hidden="true">
                    {!requestingChanges && <Check size={12} />}
                  </span>
                </span>
                <span className="approval-option-description">
                  La versión puede avanzar.
                </span>
              </label>
              <label
                className={`approval-option changes ${requestingChanges ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="approval-decision"
                  value="changes"
                  checked={requestingChanges}
                  onChange={() => setDecisionMode("changes")}
                />
                <span className="approval-option-title">
                  <strong>Solicitar cambios</strong>
                  <span className="approval-option-check" aria-hidden="true">
                    {requestingChanges && <Check size={12} />}
                  </span>
                </span>
                <span className="approval-option-description">
                  Necesita correcciones.
                </span>
              </label>
            </fieldset>
          )}

          <div className="approval-action-body">
            {!requestingChanges && requiresException && (
              <>
                <p className="approval-exception-notice">
                  La IA no validó esta versión. Para aprobarla, justificá la
                  excepción.
                </p>
                <label className="approval-field">
                  Motivo de la excepción
                  <select
                    value={exceptionReason}
                    disabled={saving}
                    onChange={(event) =>
                      setExceptionReason(
                        event.target.value as typeof exceptionReason,
                      )
                    }
                  >
                    <option value="acceptedFinding">
                      Hallazgo aceptado por el cliente
                    </option>
                    <option value="falsePositive">Falso positivo de IA</option>
                    <option value="notApplicable">El requisito no aplica</option>
                    <option value="other">Otro motivo</option>
                  </select>
                </label>
              </>
            )}
            {needsComment ? (
              <div className="approval-comment">
                <label className="approval-field" htmlFor="approval-comment">
                  <span className="approval-field-heading">
                    {requestingChanges
                      ? "¿Qué debe corregirse?"
                      : "Justificación de la excepción"}
                    <span className="approval-required">*</span>
                  </span>
                </label>
                <textarea
                  id="approval-comment"
                  required
                  rows={4}
                  maxLength={4000}
                  disabled={saving}
                  aria-describedby="approval-comment-help"
                  value={comment}
                  onChange={(event) =>
                    requestingChanges
                      ? setChangeRequest(event.target.value)
                      : setException(event.target.value)
                  }
                  placeholder={
                    requestingChanges
                      ? "Describí el cambio concreto que necesita esta versión…"
                      : "Explicá por qué aprobás esta versión con una excepción…"
                  }
                />
                <p id="approval-comment-help" className="approval-hint">
                  {requestingChanges
                    ? "Se guardará como comentario de esta versión."
                    : "La justificación quedará registrada con la aprobación."}
                </p>
              </div>
            ) : (
              <div className="approval-ready">
                <CheckCircle2 size={18} />
                <span>Lista para tu aprobación.</span>
              </div>
            )}

            <div className="approval-actions">
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={() => approved ? setDecisionMode("approve") : setModal(null)}
              >
                {approved ? "Volver" : "Cancelar"}
              </button>
              <button
                type="submit"
                className={`button approval-submit ${requestingChanges ? "changes" : "primary"}`}
                disabled={disabled}
              >
                {requestingChanges ? (
                  <MessageSquare size={15} />
                ) : (
                  <Check size={15} />
                )}
                {saving
                  ? "Guardando…"
                  : requestingChanges
                    ? "Enviar solicitud"
                    : requiresException
                      ? "Aprobar con excepción"
                      : "Aprobar versión"}
              </button>
            </div>
          </div>
        </form>
      )}
      <p className="approval-footnote">
        La decisión se aplica a esta pieza y versión.
      </p>
    </>
  );
}
