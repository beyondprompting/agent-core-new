import {
  ArrowUpRight,
  Check,
  Eye,
  FileImage,
  Layers,
  MessageSquare,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import type { Comment, Piece, PieceStatus, ReviewFeed } from "@/app/lib/qa-visual/review-model";
import { getAiReviewState } from "@/app/lib/qa-visual/review-state";

export function CampaignSummary({
  items,
  comments,
  statuses,
  results,
  campaignName,
  onSelectPiece,
}: {
  items: Piece[];
  results: ReviewFeed["results"];
  campaignName?: string;
  comments: Comment[];
  statuses: Record<string, PieceStatus>;
  onSelectPiece: (id: string) => void;
}) {
  const approved = items.filter(
    (p) => (statuses[`${p.id}-1`] ?? p.status) === "Aprobada",
  ).length;
  const unresolved = comments.filter((c) => !c.resolved).length;
  const aiValidated = items.filter(
    (p) => results[p.id]?.[1] === "validated",
  ).length;
  const aiWithFindings = items.filter(
    (p) => results[p.id]?.[1] === "findings",
  ).length;
  return (
    <div className="campaign-tab-content">
      <span className="section-eyebrow">VISTA GENERAL</span>
      <h3>{campaignName || "Campaña"}</h3>
      <p className="campaign-description">Todas las piezas de esta campaña.</p>
      <div className="overview-stat-grid">
        <div>
          <FileImage size={16} />
          <strong>{items.length}</strong>
          <span>Archivos originales</span>
        </div>
        <div>
          <ShieldCheck size={16} />
          <strong>
            {approved} / {items.length}
          </strong>
          <span>Aprobadas por personas</span>
        </div>
        <div>
          <Layers size={16} />
          <strong>
            {items.filter((p) => p.format.startsWith("Post")).length} +{" "}
            {items.filter((p) => p.format.startsWith("Story")).length}
          </strong>
          <span>Posts y Stories</span>
        </div>
        <div>
          <MessageSquare size={16} />
          <strong>{unresolved}</strong>
          <span>Comentarios abiertos</span>
        </div>
        <div>
          <ScanLine size={16} />
          <strong>
            {aiValidated} / {items.length}
          </strong>
          <span>Validadas por IA</span>
        </div>
        <div>
          <Eye size={16} />
          <strong>{aiWithFindings}</strong>
          <span>IA con hallazgos</span>
        </div>
      </div>
      <h4>CONTEXTO DE LA CAMPAÑA</h4>
      <dl className="campaign-context">
        <div>
          <dt>Cliente</dt>
          <dd>KFC Ecuador</dd>
        </div>
        <div>
          <dt>Campaña</dt>
          <dd>{campaignName || "Campaña"}</dd>
        </div>
        <div>
          <dt>Periodo</dt>
          <dd>Octubre 2026</dd>
        </div>
        <div>
          <dt>Objetivo</dt>
          <dd>Descargas</dd>
        </div>
        <div>
          <dt>Canales</dt>
          <dd>Domicilio · Express</dd>
        </div>
        <div>
          <dt>Medio</dt>
          <dd>Meta</dd>
        </div>
      </dl>
      <h4>REVISIÓN POR PIEZA</h4>
      <div className="overview-piece-list">
        {items.map((piece) => (
          <button key={piece.id} onClick={() => onSelectPiece(piece.id)}>
            <span
              className={`overview-piece-icon ${(statuses[`${piece.id}-1`] ?? piece.status) === "Aprobada" ? "ok" : "warn"}`}
            >
              {(statuses[`${piece.id}-1`] ?? piece.status) === "Aprobada" ? (
                <Check size={13} />
              ) : (
                <Eye size={13} />
              )}
            </span>
            <span>
              <strong>{piece.name}</strong>
              <small>
                {piece.formatName} · IA:{" "}
                {
                  getAiReviewState(
                    results[piece.id]?.[1],
                    comments.filter(
                      (c) => c.pieceId === piece.id && c.version === 1,
                    ),
                  ).shortLabel
                }
              </small>
              <small>Humana: {statuses[`${piece.id}-1`] ?? piece.status}</small>
            </span>
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
      <div className="info-note">
        <ShieldCheck size={16} />
        <span>
          Resumen de toda la campaña. Los comentarios y decisiones pertenecen a
          cada pieza y versión.
        </span>
      </div>
    </div>
  );
}
