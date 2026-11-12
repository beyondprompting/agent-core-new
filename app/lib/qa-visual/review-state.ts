import type { AiReviewStatus, Comment, PieceStatus } from "./review-model";

export type ReviewTone =
  | "neutral"
  | "warning"
  | "success"
  | "danger"
  | "progress";
export type ReviewDecision = {
  pieceId: string;
  version: number;
  status: PieceStatus;
  author: string;
  exception: string;
  message: string;
  at?: number;
};
export type AiReviewState = {
  status: AiReviewStatus | undefined;
  title: string;
  shortLabel: string;
  detail: string;
  tone: ReviewTone;
  findings: number;
  openFindings: number;
  reasons?: string[];
};
export type HumanReviewState = {
  title: string;
  shortLabel: string;
  detail: string;
  tone: ReviewTone;
  author?: string;
  hasException: boolean;
};

// The AI result is an explicit snapshot. Resolving discussion does not rerun QA.
export function getAiReviewState(
  status: AiReviewStatus | undefined,
  comments: readonly Comment[],
): AiReviewState {
  if (!status)
    return {
      status,
      title: "—",
      shortLabel: "—",
      detail: "Sin resultado disponible",
      tone: "neutral",
      findings: 0,
      openFindings: 0,
    };
  const warnings = comments.filter(
    (c) =>
      !c.historical &&
      c.kind === "agent" &&
      (c.severity === "warning" || c.severity === "blocking"),
  );
  const findings = warnings.length;
  const openFindings = warnings.filter((c) => !c.resolved).length;
  const states: Record<
    AiReviewStatus,
    { title: string; shortLabel: string; detail: string; tone: ReviewTone }
  > = {
    stale: {
      title: "Análisis desactualizado",
      shortLabel: "Desactualizada",
      detail: "Cambió la imagen, el pedido o los criterios de análisis",
      tone: "neutral",
    },
    analyzing: {
      title: "Analizando…",
      shortLabel: "Analizando…",
      detail: "Los agentes están revisando esta versión",
      tone: "progress",
    },
    findings: {
      title: "Con hallazgos",
      shortLabel: findings
        ? `${findings} ${findings === 1 ? "hallazgo" : "hallazgos"}`
        : "Con hallazgos",
      detail: openFindings
        ? `${openFindings} ${openFindings === 1 ? "hallazgo por revisar" : "hallazgos por revisar"}`
        : "Observaciones revisadas · resultado conservado",
      tone: "warning",
    },
    validated: {
      title: "Validada por IA",
      shortLabel: "Validada",
      detail: "Todos los controles solicitados fueron verificados",
      tone: "success",
    },
    partial: {
      title: "Revisión incompleta",
      shortLabel: "Incompleta",
      detail: "Falta información para concluir",
      tone: "warning",
    },
    failed: {
      title: "Error de análisis",
      shortLabel: "Error",
      detail: "No se pudo completar la revisión IA",
      tone: "danger",
    },
  };
  return { status, ...states[status], findings, openFindings };
}

export function getHumanReviewState(
  status: PieceStatus,
  decision?: ReviewDecision,
): HumanReviewState {
  const author = decision?.author;
  const hasException =
    status === "Aprobada" && Boolean(decision?.exception?.trim());
  if (status === "Aprobada")
    return {
      title: hasException ? "Aprobada con excepción" : "Aprobada",
      shortLabel: "Aprobada",
      detail: author
        ? `${author}${hasException ? " · con excepción" : " · esta versión"}`
        : "Decisión registrada para esta versión",
      tone: "success",
      author,
      hasException,
    };
  if (status === "Cambios solicitados")
    return {
      title: "Cambios solicitados",
      shortLabel: "Cambios",
      detail: author
        ? `${author} solicitó una corrección`
        : "Esperando una nueva versión",
      tone: "danger",
      author,
      hasException: false,
    };
  if (status === "En revisión")
    return {
      title: "En revisión",
      shortLabel: "En revisión",
      detail: author
        ? `${author} está revisando esta versión`
        : "Todavía sin decisión de aprobación",
      tone: "neutral",
      author,
      hasException: false,
    };
  return {
    title: "Pendiente de aprobación",
    shortLabel: "Pendiente",
    detail: "Todavía sin decisión humana",
    tone: "neutral",
    hasException: false,
  };
}
