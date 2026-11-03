import { CommentsPanel } from "@/app/components/qa-visual/comments/CommentsPanel";
import {
  CheckCheck,
  FileImage,
  History,
  MessageCircle,
  Sparkles,
} from "lucide-react";

import { PieceDetails } from "./PieceDetails";
import { PieceVersions } from "./PieceVersions";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function PiecePanel({ session }: { session: ReviewSession }) {
  const {
    activeId,
    version,
    setLeftTab,
    rightTab,
    setRightTab,
    setLeftOpen,
    approvals,
    piece,
    currentStatus,
    pieceComments,
    aiReview,
    humanReview,
    changeVersion,
  } = session;
  return (
    <aside className="comments-panel" aria-label="Comentarios y hallazgos">
      <div className="panel-tabs right-tabs">
        {(["Comentarios", "Detalles", "Versiones", "Historial"] as const).map(
          (tab) => (
            <button
              key={tab}
              className={rightTab === tab ? "active" : ""}
              onClick={() => setRightTab(tab)}
            >
              {tab}
              {tab === "Comentarios" && <span>{pieceComments.length}</span>}
            </button>
          ),
        )}
      </div>
      {rightTab === "Comentarios" ? (
        <CommentsPanel session={session} />
      ) : rightTab === "Detalles" ? (
        <PieceDetails
          piece={piece}
          version={version}
          status={currentStatus}
          aiReview={aiReview}
          humanReview={humanReview}
          onOpenResources={() => {
            setLeftOpen(true);
            setLeftTab("Recursos");
          }}
        />
      ) : rightTab === "Versiones" ? (
        <PieceVersions
          piece={piece}
          version={version}
          onSelectVersion={changeVersion}
        />
      ) : (
        <div className="history-scroll">
          <h3>Actividad de esta versión</h3>
          <p className="history-intro">El historial acompaña a cada entrega.</p>
          <div className="timeline">
            {approvals
              .filter((a) => a.pieceId === activeId && a.version === version)
              .map((a, i) => (
                <div key={i}>
                  <span className="timeline-icon">
                    <CheckCheck size={13} />
                  </span>
                  <strong>{a.author} registró una decisión</strong>
                  <p>{a.message}</p>
                  <small>Decisión de esta sesión · Versión {version}</small>
                </div>
              ))}
            {pieceComments
              .slice()
              .reverse()
              .map((c) => (
                <div key={c.id}>
                  <span className="timeline-icon">
                    {c.kind === "agent" ? (
                      <Sparkles size={13} />
                    ) : (
                      <MessageCircle size={13} />
                    )}
                  </span>
                  <strong>{c.author}</strong>
                  <p>
                    {c.resolved
                      ? "Control verificado o comentario resuelto"
                      : "Agregó un comentario a la revisión"}
                  </p>
                  <small>
                    {c.time} · Versión {version}
                  </small>
                </div>
              ))}
            <div>
              <span className="timeline-icon">
                <FileImage size={13} />
              </span>
              <strong>Versión {version} incorporada</strong>
              <p>Archivo original listo para revisión</p>
              <small>Original proporcionado · versión única</small>
            </div>
          </div>
          <div className="info-note">
            <History size={16} />
            <span>
              Una nueva versión conserva el historial y requiere su propia
              aprobación.
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
