import { DuplicateResolution } from "./DuplicateResolution";
import { sourceLabel } from "@/convex/qaVisual/model/contracts";
import {
  ArrowUpRight,
  Check,
  Eye,
  FileImage,
  FileText,
  Link2,
  ShieldCheck,
  Minus,
  X,
} from "lucide-react";
import type { Piece, PieceStatus } from "@/app/lib/qa-visual/review-model";
import type {
  AiReviewState,
  HumanReviewState,
} from "@/app/lib/qa-visual/review-state";

export type PieceFinding = {
  ruleId: string;
  outcome: "pass" | "fail" | "unverifiable" | "notApplicable";
  observed: string;
  method?: "model" | "deterministic";
};

const controlStates = {
  pass: { label: "Cumple", tone: "ok", Icon: Check },
  fail: { label: "No cumple", tone: "fail", Icon: X },
  unverifiable: { label: "No verificable", tone: "warn", Icon: Eye },
  notApplicable: { label: "No aplica", tone: "neutral", Icon: Minus },
  notEvaluated: { label: "Sin evaluar", tone: "neutral", Icon: Minus },
} as const;

type DetailField = {
  title: string;
  value: string;
  note: string;
  pending?: boolean;
  control?: keyof typeof controlStates;
  observed?: string;
};

export function PieceDetails({
  piece,
  findings,
  version,
  status,
  aiReview,
  humanReview,
  onOpenResources,
}: {
  piece: Piece;
  findings?: PieceFinding[];
  version: number;
  status: PieceStatus;
  aiReview: AiReviewState;
  humanReview: HumanReviewState;
  onOpenResources: () => void;
}) {
  const requirementLabels = {
    ready: "Requisito disponible",
    conflict: "Fuentes en conflicto",
    notRequested: "No solicitado",
    unresolved: "Sin resolver",
    missing: "Falta el dato",
    invalid: "Dato inválido",
  };
  const labels: Record<string, string> = {
    dimensions: "Dimensiones",
    format: "Formato",
    product: "Oferta del cliente",
    price: "Precio solicitado",
    date: "Vigencia solicitada",
    cta: "Llamado a la acción",
  };
  const resultByRule = new Map(
    findings?.map((result) => [result.ruleId, result]),
  );
  const requirements = piece.clientRequirements ?? [];
  const requested: DetailField[] = requirements.map((rule) => {
    const result = resultByRule.get(rule.ruleId);
    return {
      title: labels[rule.ruleId] ?? rule.ruleId,
      value:
        rule.expected ??
        (rule.status === "notRequested"
          ? "No solicitado por el cliente"
          : "Sin referencia verificable"),
      note: `${rule.basis === "client" ? "Cliente" : "Producción"} · ${sourceLabel(rule.sources)} · ${requirementLabels[rule.status]}${rule.expectedAlternatives?.length ? ` · CSV: ${rule.expectedAlternatives.join(" / ")}` : ""}${result?.method ? ` · ${result.method === "model" ? "IA" : "Código"}` : ""}`,

      control:
        result?.outcome ??
        (rule.status === "notRequested" ? "notApplicable" : "notEvaluated"),
      observed: result?.observed,
    };
  });
  for (const result of findings ?? []) {
    if (
      result.outcome === "notApplicable" &&
      !requirements.some((rule) => rule.ruleId === result.ruleId)
    ) {
      requested.push({
        title: labels[result.ruleId] ?? result.ruleId,
        value: "Sin requisito en el pedido",
        note: result.observed,
        control: "notApplicable",
      });
    }
  }
  const groups: { title: string; fields: DetailField[] }[] = [
    {
      title: "PEDIDO ORIGINAL DEL CLIENTE · EXCEL",
      fields: requested.length
        ? requested
        : [
            {
              title: "Requisitos del cliente",
              value: "Sin requisitos vinculados",
              note: "No se encontró una fila única para esta pieza en la matriz.",
              control: "unverifiable",
            },
          ],
    },
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
        ...(piece.validity === "—"
          ? []
          : [
              {
                title: "Asset de vigencia",
                value: piece.validity,
                note: "Asset declarado en el CSV de producción",
                pending: false,
              },
            ]),
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
          note: "Cada entrega conserva su revisión y aprobación",
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
      {piece.pieceId && version === (piece.currentVersion ?? 1) && (
        <DuplicateResolution key={piece.pieceId} pieceId={piece.pieceId} />
      )}
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
      {!!aiReview.reasons?.length && (
        <section className="detail-group">
          <h4>CONTROLES PENDIENTES DE VERIFICACIÓN</h4>
          <ul>
            {aiReview.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.title} className="detail-group">
          <h4>{group.title}</h4>
          {group.fields.map((field) => {
            const control = field.control
              ? controlStates[field.control]
              : undefined;
            const Icon = control?.Icon ?? (field.pending ? Eye : Check);
            return (
              <div className="requirement-card" key={field.title}>
                <div>
                  <span
                    className={`requirement-check ${control?.tone ?? (field.pending ? "warn" : "ok")}`}
                    title={
                      control?.label ??
                      (field.pending ? "Por revisar" : "Dato disponible")
                    }
                  >
                    <Icon size={13} />
                  </span>
                  <strong>{field.title}</strong>
                  {control && (
                    <span className={`qa-control-label ${control.tone}`}>
                      {control.label}
                    </span>
                  )}
                </div>
                <p className="detail-value">{field.value}</p>
                <small>{field.note}</small>
                {field.observed && (
                  <p className="detail-value">
                    <small>Observado</small> {field.observed}
                  </p>
                )}
              </div>
            );
          })}
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
