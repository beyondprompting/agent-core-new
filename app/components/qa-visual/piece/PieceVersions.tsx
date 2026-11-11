import { Check, Layers } from "lucide-react";
import type { Piece } from "@/app/lib/qa-visual/review-model";
import { Artwork } from "@/app/components/qa-visual/shared/visuals";

export function PieceVersions({
  piece,
  version,
  onSelectVersion,
}: {
  piece: Piece;
  version: number;
  onSelectVersion: (version: number) => void;
}) {
  return (
    <div className="versions-panel">
      <div className="requirements-title">
        <span className="document-icon">
          <Layers size={21} />
        </span>
        <div>
          <h3>Versiones de la pieza</h3>
          <p>{piece.name}</p>
        </div>
      </div>
      <p className="versions-intro">
        Cada entrega conserva sus comentarios y decisiones.
      </p>
      {Array.from({ length: piece.versions }, (_, i) => i + 1)
        .reverse()
        .map((v) => (
          <button
            className={`version-card ${version === v ? "active" : ""}`}
            key={v}
            onClick={() => onSelectVersion(v)}
          >
            <div className="version-thumb">
              <Artwork piece={piece} thumbnail />
            </div>
            <div>
              <strong>Versión {v}</strong>
              <span>Original recibido</span>
              <small>Única versión proporcionada</small>
            </div>
            {version === v && <Check size={14} />}
          </button>
        ))}
      <div className="info-note">
        <Layers size={16} />
        <span>
          No se recibieron versiones corregidas de esta pieza. Las nuevas
          versiones requerirán su propia revisión.
        </span>
      </div>
    </div>
  );
}
