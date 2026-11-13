import { usePathname } from "next/navigation";
import {
  Copy,
  Eye,
  Link2,
  MessageSquare,
  Moon,
  ScanLine,
  Sparkles,
  Square,
  Users,
  X,
} from "lucide-react";

import { ApprovalDialog } from "./ApprovalDialog";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ReviewDialogs({ session }: { session: ReviewSession }) {
  const { setToast, modal, setModal, saving } = session;
  const pathname = usePathname();

  return (
    <>
      {modal && (
        <div className="modal-backdrop" onClick={() => !saving && setModal(null)}>
          <section
            className={`modal ${modal === "approval" ? "approval-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Cerrar diálogo"
              disabled={saving}
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
                  <span className="min-w-0 truncate" title={pathname}>
                    {pathname}
                  </span>
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
              <ApprovalDialog session={session} />
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
