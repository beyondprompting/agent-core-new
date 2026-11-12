import { Check, Layers } from "lucide-react";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function PieceVersions({ session }: { session: ReviewSession }) {
  return (
    <div className="versions-panel">
      <div className="requirements-title">
        <span className="document-icon">
          <Layers size={21} />
        </span>
        <div>
          <h3>Versiones de la pieza</h3>
          <p>{session.piece.name}</p>
        </div>
      </div>
      <p className="versions-intro">
        Cada entrega conserva sus comentarios y decisiones.
      </p>
      {(session.detail?.versions ?? []).map((v) => (
        <button
          className={`version-card ${session.version === v.number ? "active" : ""}`}
          key={v.id}
          onClick={() => session.changeVersion(v.number)}
        >
          <div>
            <strong>Versión {v.number}</strong>
            <span>{v.fileName}</span>
            <small>
              {new Date(v.at).toLocaleString()} · {v.humanStatus}
            </small>
          </div>
          {session.version === v.number && <Check size={14} />}
        </button>
      ))}
      {!session.detail && <p>Cargando versiones…</p>}
      {session.detail?.moreVersions && (
        <p>Se muestran las 200 versiones más recientes.</p>
      )}
      <div className="info-note">
        <Layers size={16} />
        <span>
          Una imagen corregida requiere su propia aprobación. Un cambio en el
          pedido conserva la decisión con una advertencia.
        </span>
      </div>
    </div>
  );
}
