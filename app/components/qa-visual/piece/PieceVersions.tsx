import { Check, Layers, Upload } from "lucide-react";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";
import { ClientAsks, VersionApprovals } from "./VersionTrail";

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
        Cada versión tiene su propio análisis de IA, aprobación del equipo y
        revisión del cliente. Un pedido de cambios se resuelve con una versión
        nueva: la anterior conserva su historia.
      </p>
      <ClientAsks asks={session.detail?.clientAsks ?? null} />
      {(session.detail?.versions ?? []).map((v) => (
        <button
          className={`version-card ${session.version === v.number ? "active" : ""}`}
          key={v.id}
          onClick={() => session.changeVersion(v.number)}
        >
          <div>
            <strong>Versión {v.number}</strong>
            <span className="version-file" title={v.fileName}>
              {v.fileName}
            </span>
            <small>{new Date(v.at).toLocaleString()}</small>
            <VersionApprovals version={v} />
          </div>
          {session.version === v.number && <Check size={14} />}
        </button>
      ))}
      {!session.detail && <p>Cargando versiones…</p>}
      {session.detail?.moreVersions && (
        <p>Se muestran las 200 versiones más recientes.</p>
      )}
      <section
        className="version-howto"
        aria-label="Cómo cargar una versión corregida"
      >
        <h4>
          <Upload size={14} />
          Cargar una versión corregida
        </h4>
        <ol>
          <li>
            En Drive (DESPLIEGUE), abrí el archivo y usá{" "}
            <b>Administrar versiones → Subir versión nueva</b>.
          </li>
          <li>
            Acá, tocá <b>Actualizar desde Drive</b>. Aparece como versión{" "}
            {(session.detail?.versions.length ?? session.piece.versions) + 1},
            sin análisis ni aprobación.
          </li>
          <li>
            Analizala con <b>Volver a analizar esta versión</b> o con{" "}
            <b>Analizar piezas</b>.
          </li>
        </ol>
      </section>
      <div className="info-note">
        <Layers size={16} />
        <span>
          Una imagen corregida requiere su propio análisis, la aprobación del
          equipo y la del cliente. Un cambio en el pedido conserva la decisión
          con una advertencia.
        </span>
      </div>
    </div>
  );
}
