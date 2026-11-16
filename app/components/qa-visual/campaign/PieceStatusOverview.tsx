"use client";

import { BadgeCheck, Bot } from "lucide-react";
import {
  PIECE_STAGES,
  countStages,
  type PieceFilterKey,
  type PieceFilters,
  type PieceStage,
} from "@/app/lib/qa-visual/piece-filters";
import type { Piece, PieceStatus } from "@/app/lib/qa-visual/review-model";

export const STAGE_TONES: Record<PieceStage, string> = {
  internal: "neutral",
  ready: "progress",
  sent: "client-soft",
  viewed: "client",
  clientChanges: "danger",
  final: "success",
};

type AiCounts = { validated: number; findings: number; partial: number; failed: number };

/**
 * Campaign status at a glance: final (client) approvals first, then where every piece is on its
 * way there. Every stage and AI count is a shortcut to the matching filter.
 */
export function PieceStatusOverview({
  pieces,
  statuses,
  filters,
  onFiltersChange,
  ai,
}: {
  pieces: Piece[];
  statuses: Record<string, PieceStatus>;
  filters: PieceFilters;
  onFiltersChange: (filters: PieceFilterKey[]) => void;
  ai?: AiCounts;
}) {
  const total = pieces.length;
  const counts = countStages(
    pieces.map((p) => ({
      human: statuses[`${p.id}-${p.currentVersion ?? 1}`] ?? p.status,
      client: p.client,
    })),
  );
  const sentToClient = counts.sent + counts.viewed + counts.clientChanges + counts.final;
  const opened = counts.viewed + counts.clientChanges + counts.final;
  const pct = total ? Math.round((counts.final / total) * 100) : 0;
  // A shortcut replaces the filter of its own group and keeps the rest; a second click clears it.
  const toggle = (key: PieceFilterKey, prefix: string) => {
    const rest = filters.filter((f) => !f.startsWith(prefix));
    onFiltersChange(filters.includes(key) ? rest : [...rest, key]);
  };
  return (
    <section className="qa-overview" aria-label="Estado de las piezas">
      <div className="qa-overview-hero">
        <span
          className="qa-overview-ring"
          style={{ ["--pct" as string]: `${pct}%` }}
          role="img"
          aria-label={`${counts.final} de ${total} con aprobación final`}
        >
          <span>{pct}%</span>
        </span>
        <div>
          <span className="qa-overview-eyebrow">
            <BadgeCheck size={12} /> Aprobación final del cliente
          </span>
          <strong>
            {counts.final} <small>de {total} piezas</small>
          </strong>
          <span className="qa-overview-sub">
            {sentToClient} enviadas al cliente · {opened} vistas
          </span>
        </div>
      </div>

      <div className="qa-overview-flow">
        <div className="qa-overview-bar" aria-hidden>
          {PIECE_STAGES.map((s) =>
            counts[s.key] ? (
              <i
                key={s.key}
                className={`stage-${STAGE_TONES[s.key]}`}
                style={{ flexGrow: counts[s.key] }}
              />
            ) : null,
          )}
        </div>
        <ul className="qa-overview-stages">
          {PIECE_STAGES.map((s) => {
            const key = `stage:${s.key}` as const;
            const on = filters.includes(key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className={`stage-${STAGE_TONES[s.key]} ${on ? "on" : ""} ${counts[s.key] ? "" : "empty"}`}
                  aria-pressed={on}
                  title={`${s.hint}. ${on ? "Quitar filtro" : "Ver solo estas piezas"}`}
                  onClick={() => toggle(key, "stage:")}
                >
                  <span className="qa-overview-count">
                    <i />
                    {counts[s.key]}
                  </span>
                  <span className="qa-overview-label">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {ai && (
        <div className="qa-overview-ai">
          <span className="qa-overview-eyebrow">
            <Bot size={12} /> Revisión IA
          </span>
          <div>
            {(
              [
                ["ai:validated", ai.validated, "validadas", "success"],
                ["ai:findings", ai.findings, "con hallazgos", "warning"],
                ["ai:partial", ai.partial, "incompletas", "warning"],
                ["ai:failed", ai.failed, "con error", "danger"],
              ] as const
            )
              .filter(([key, n]) => n > 0 || key === "ai:validated" || key === "ai:findings")
              .map(([key, n, label, tone]) => (
                <button
                  key={key}
                  type="button"
                  className={`tone-${tone} ${filters.includes(key) ? "on" : ""}`}
                  aria-pressed={filters.includes(key)}
                  onClick={() => toggle(key, "ai:")}
                >
                  <b>{n}</b> {label}
                </button>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
