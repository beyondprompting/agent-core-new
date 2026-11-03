import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Link2,
  MessageSquare,
  Moon,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  X,
} from "lucide-react";

import { CompactReviewStatus } from "./review-status";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ReviewDialogs({
  session: {
    version,
    setToast,
    modal,
    setModal,
    exception,
    setException,
    piece,
    aiReview,
    latestDecision,
    humanReview,
    requiresException,
    setDecision,
  },
}: {
  session: ReviewSession;
}) {
  return (
    <>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Cerrar diálogo"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
            {modal === "share" ? (
              <>
                <span className="modal-icon">
                  <Users size={24} />
                </span>
                <h2 id="modal-title">Comparte esta revisión</h2>
                <p>
                  Copia el enlace de la revisión. El acceso depende de los
                  permisos de cada participante.
                </p>
                <div className="share-link">
                  <Link2 size={15} />
                  <span>/workspace/qa-visual</span>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          window.location.href,
                        );
                        setToast("Enlace copiado");
                      } catch {
                        setToast(window.location.href);
                      }
                    }}
                  >
                    <Copy size={14} />
                    Copiar
                  </button>
                </div>
                <p className="modal-footnote">
                  Las decisiones se registran por pieza y versión.
                </p>
              </>
            ) : modal === "approval" ? (
              <>
                <span className="modal-icon">
                  <ShieldCheck size={25} />
                </span>
                <h2 id="modal-title">Aprobación humana</h2>
                <p>
                  {piece.name} · Versión {version}
                </p>
                <CompactReviewStatus ai={aiReview} human={humanReview} />
                {latestDecision && (
                  <div className="previous-decision">
                    <strong>
                      Última decisión · {latestDecision.author ?? "Revisor"}
                    </strong>
                    <span>{humanReview.title}</span>
                    {latestDecision.exception && (
                      <p>{latestDecision.exception}</p>
                    )}
                  </div>
                )}
                <div
                  className={`decision-summary ${requiresException ? "warn" : "ok"}`}
                >
                  {requiresException ? (
                    <Eye size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  <span>
                    {requiresException
                      ? aiReview.status === "findings"
                        ? "La IA mantiene un resultado con hallazgos. Puedes solicitar cambios o justificar una aprobación con excepción."
                        : "La revisión IA no está validada. Para aprobar esta versión, registra una excepción."
                      : "La IA validó los controles ejecutados. Puedes registrar tu decisión para esta versión."}
                  </span>
                </div>
                {requiresException && (
                  <label className="exception-label">
                    Justificación para aprobar con excepción
                    <textarea
                      value={exception}
                      onChange={(e) => setException(e.target.value)}
                      placeholder="Describe por qué se acepta esta versión…"
                    />
                  </label>
                )}
                <div className="modal-buttons">
                  <button
                    className="button secondary"
                    onClick={() => setDecision("Cambios solicitados")}
                  >
                    Solicitar cambios
                  </button>
                  <button
                    className="button primary"
                    disabled={requiresException && !exception.trim()}
                    onClick={() => setDecision("Aprobada")}
                  >
                    <Check size={15} />
                    {requiresException
                      ? "Aprobar con excepción"
                      : "Aprobar versión"}
                  </button>
                </div>
                <p className="modal-footnote">
                  La decisión se aplica a esta pieza y versión.
                </p>
              </>
            ) : (
              <>
                <span className="modal-icon">
                  <ScanLine size={25} />
                </span>
                <h2 id="modal-title">Tu espacio de revisión visual</h2>
                <p>
                  Selecciona una pieza, revisa los comentarios de personas y
                  agentes, y registra una decisión por versión.
                </p>
                <ul className="help-list">
                  <li>
                    <MessageSquare size={16} />
                    Marca un punto y escribe tu comentario junto a la imagen.
                  </li>
                  <li>
                    <Square size={16} />
                    Usa rectángulos o dibujo libre para anotar.
                  </li>
                  <li>
                    <Sparkles size={16} />
                    Abre un hallazgo para consultar su evidencia.
                  </li>
                  <li>
                    <Moon size={16} />
                    Cambia entre tema claro y oscuro según tu preferencia.
                  </li>
                </ul>
                <div className="info-note">
                  <Eye size={17} />
                  <span>
                    Cada versión tiene su propia revisión IA y aprobación
                    humana. Resolver un comentario conserva el resultado del
                    análisis hasta la siguiente revisión.
                  </span>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
