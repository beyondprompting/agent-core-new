import {
  ArrowUpRight,
  Check,
  Eye,
  FileImage,
  FileText,
  Link2,
  ShieldCheck,
} from "lucide-react";
import type { Piece, PieceStatus } from "@/app/lib/qa-visual/review-model";
import type { AiReviewState, HumanReviewState } from "@/app/lib/qa-visual/review-state";

export function PieceDetails({
  piece,
  version,
  status,
  aiReview,
  humanReview,
  onOpenResources,
}: {
  piece: Piece;
  version: number;
  status: PieceStatus;
  aiReview: AiReviewState;
  humanReview: HumanReviewState;
  onOpenResources: () => void;
}) {
  const groups = [
    {
      title: "CONTENIDO Y REVISIÓN",
      fields: [
        {
          title: "Oferta y precio",
          value:
            piece.price === "—"
              ? piece.product
              : `${piece.product} · ${piece.price}`,
          note: piece.productionLinked
            ? "Según CSV de producción"
            : "Sin fila vinculada en el CSV",
          pending: piece.product === "—" || piece.price === "—",
        },
        {
          title: "Referencia de vigencia",
          value: piece.validity,
          note: "Asset declarado en el CSV de producción",
          pending: piece.validity === "—",
        },
        {
          title: "Referencia de llamado a la acción",
          value: piece.cta,
          note: "Asset declarado en el CSV de producción",
          pending: piece.cta === "—",
        },
        {
          title: "Revisión IA",
          value: aiReview.title,
          note: aiReview.detail,
          pending: aiReview.status !== "validated",
        },
        {
          title: "Aprobación humana",
          value: humanReview.title,
          note: humanReview.detail,
          pending: status !== "Aprobada",
        },
      ],
    },
    {
      title: "ARCHIVO Y VERSIÓN",
      fields: [
        {
          title: "Formato de entrega",
          value: piece.format,
          note: "Datos declarados en el CSV o en el nombre del archivo",
          pending: false,
        },
        {
          title: "Archivo original",
          value: piece.filename,
          note: "Nombre completo del archivo recibido",
          pending: false,
        },
        {
          title: "Versión",
          value: `Versión ${version} de ${piece.versions}`,
          note: "Única versión proporcionada",
          pending: false,
        },
        {
          title: "Origen de la vista",
          value: `${piece.extension ?? "PNG"} original proporcionado`,
          note: "Archivo conservado sin modificaciones",
          pending: false,
        },
      ],
    },
    {
      title: "CONTEXTO DE ESTA PIEZA",
      fields: [
        {
          title: "Campaña",
          value: piece.campaign,
          note: "Según CSV de producción",
          pending: piece.campaign === "—",
        },
        {
          title: "Fase",
          value: piece.phase,
          note: "Según CSV de producción",
          pending: false,
        },
        {
          title: "Canal",
          value: piece.channel,
          note: "Canal correspondiente a esta pieza",
          pending: false,
        },
        {
          title: "Medio",
          value: piece.platform ?? "—",
          note: "Según CSV de producción",
          pending: false,
        },
      ],
    },
  ];
  return (
    <div className="requirements-scroll piece-details">
      <div className="requirements-title">
        <span className="document-icon">
          <FileImage size={21} />
        </span>
        <div>
          <h3>Detalles de la pieza</h3>
          <p>
            {piece.name} · {piece.formatName}
          </p>
        </div>
      </div>
      <div className="requirement-source">
        <Link2 size={13} />
        Archivo original<span>Versión {version}</span>
      </div>
      <div className="detail-legend">
        <span>
          <Check size={12} />
          Dato disponible
        </span>
        <span>
          <Eye size={12} />
          Por revisar
        </span>
      </div>
      {groups.map((group) => (
        <section key={group.title} className="detail-group">
          <h4>{group.title}</h4>
          {group.fields.map((field) => (
            <div className="requirement-card" key={field.title}>
              <div>
                <span
                  className={`requirement-check ${field.pending ? "warn" : "ok"}`}
                  title={field.pending ? "Por revisar" : "Dato disponible"}
                >
                  {field.pending ? <Eye size={13} /> : <Check size={13} />}
                </span>
                <strong>{field.title}</strong>
              </div>
              <p className="detail-value">{field.value}</p>
              <small>{field.note}</small>
            </div>
          ))}
        </section>
      ))}
      <div className="info-note">
        <ShieldCheck size={17} />
        <span>
          Los resultados y las decisiones corresponden a la versión
          seleccionada. Consulta los comentarios para ver el alcance de cada
          revisión.
        </span>
      </div>
      <button className="details-resources-link" onClick={onOpenResources}>
        <FileText size={14} />
        Ver recursos de la campaña
        <ArrowUpRight size={12} />
      </button>
    </div>
  );
}
