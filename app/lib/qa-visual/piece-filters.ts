import type { PieceClientStatus } from "@/convex/qaVisual/clientReview";
import type { AiReviewStatus, PieceStatus } from "./review-model";

/**
 * Checkbox filters of the internal gallery and file list.
 * Options of the same group are OR'ed; groups and quick toggles are AND'ed.
 */
export type PieceFilterKey =
  | "attention"
  | "hideFinal"
  | "ai:findings"
  | "ai:partial"
  | "ai:failed"
  | "ai:analyzing"
  | "ai:stale"
  | "ai:validated"
  | "human:Pendiente"
  | "human:En revisión"
  | "human:Cambios solicitados"
  | "human:Aprobada"
  | "client:none"
  | "client:sent"
  | "client:changesRequested"
  | "client:approved"
  | "client:outdated";

export type PieceFilters = readonly PieceFilterKey[];

export const QUICK_FILTERS: { key: PieceFilterKey; label: string; hint: string }[] = [
  {
    key: "attention",
    label: "Con hallazgos o problemas",
    hint: "Hallazgos de IA, revisión incompleta o con error, o cambios pedidos por el equipo o el cliente",
  },
  {
    key: "hideFinal",
    label: "Ocultar aprobadas por el cliente",
    hint: "Oculta las piezas con aprobación final",
  },
];

export const FILTER_GROUPS: {
  label: string;
  options: { key: PieceFilterKey; label: string }[];
}[] = [
  {
    label: "Revisión IA",
    options: [
      { key: "ai:findings", label: "Con hallazgos" },
      { key: "ai:partial", label: "Incompleta" },
      { key: "ai:failed", label: "Error" },
      { key: "ai:stale", label: "Desactualizada" },
      { key: "ai:analyzing", label: "Analizando" },
      { key: "ai:validated", label: "Validada" },
    ],
  },
  {
    label: "Aprobación interna",
    options: [
      { key: "human:Pendiente", label: "Pendiente" },
      { key: "human:En revisión", label: "En revisión" },
      { key: "human:Cambios solicitados", label: "Cambios solicitados" },
      { key: "human:Aprobada", label: "Aprobada por el equipo" },
    ],
  },
  {
    label: "Cliente · aprobación final",
    options: [
      { key: "client:none", label: "Sin enviar" },
      { key: "client:sent", label: "Esperando al cliente" },
      { key: "client:changesRequested", label: "Pidió cambios" },
      { key: "client:outdated", label: "Versión nueva sin enviar" },
      { key: "client:approved", label: "Aprobación final" },
    ],
  },
];

export type PieceFilterFacts = {
  ai: AiReviewStatus | undefined;
  human: PieceStatus;
  client: PieceClientStatus | null | undefined;
};

/** A piece is only finished when the client approved the version that is current internally. */
export const hasFinalApproval = (client: PieceClientStatus | null | undefined) =>
  client?.state === "approved" && !client.internalAhead;

/** Client state as seen by the current internal version. */
export function clientFilterState(client: PieceClientStatus | null | undefined) {
  if (!client) return "none" as const;
  if (client.internalAhead) return "outdated" as const;
  if (client.state === "viewed") return "sent" as const;
  return client.state;
}

/** Something that someone has to look at: AI findings, an incomplete AI review, or requested changes. */
export function needsAttention({ ai, human, client }: PieceFilterFacts) {
  if (hasFinalApproval(client)) return false;
  return (
    ai === "findings" ||
    ai === "partial" ||
    ai === "failed" ||
    human === "Cambios solicitados" ||
    (client?.state === "changesRequested" && !client.internalAhead)
  );
}

export function matchesPieceFilters(facts: PieceFilterFacts, filters: PieceFilters) {
  if (!filters.length) return true;
  if (filters.includes("attention") && !needsAttention(facts)) return false;
  if (filters.includes("hideFinal") && hasFinalApproval(facts.client)) return false;
  const group = (prefix: string, value: string | undefined) => {
    const selected = filters.filter((f) => f.startsWith(prefix));
    return !selected.length || selected.some((f) => f.slice(prefix.length) === value);
  };
  return (
    group("ai:", facts.ai) &&
    group("human:", facts.human) &&
    group("client:", clientFilterState(facts.client))
  );
}

export function toggleFilter(filters: PieceFilters, key: PieceFilterKey): PieceFilterKey[] {
  return filters.includes(key) ? filters.filter((f) => f !== key) : [...filters, key];
}

/**
 * Carousel order that respects the active filter. The open piece stays in place even if it
 * stopped matching (e.g. it was just approved), so «next» continues inside the filtered set.
 */
export function carouselOrder<T>(filtered: readonly T[], all: readonly T[], current: T): T[] {
  if (filtered.includes(current)) return [...filtered];
  const position = all.indexOf(current);
  if (position < 0) return filtered.length ? [...filtered] : [current];
  const before = new Set(all.slice(0, position));
  const at = filtered.findIndex((item) => !before.has(item));
  const order = [...filtered];
  order.splice(at < 0 ? order.length : at, 0, current);
  return order;
}
