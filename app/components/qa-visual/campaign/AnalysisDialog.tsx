"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { LoaderCircle, ScanLine, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const MAX_INSTRUCTIONS = 2000;

export type AnalysisScope = "pending" | "findings" | "all";
const scopes: Record<AnalysisScope, { title: string; detail: string }> = {
  pending: {
    title: "Pendientes y desactualizadas",
    detail: "Sin análisis, con un análisis anterior a un cambio o con error.",
  },
  findings: {
    title: "Con hallazgos",
    detail:
      "Vuelve a revisar solo las piezas cuyo último análisis marcó algo. Útil si algo está bien así: aclaralo en las instrucciones.",
  },
  all: {
    title: "Todas",
    detail:
      "Repite el análisis de todas las piezas aunque esté vigente. Se conservan los resultados anteriores.",
  },
};

/**
 * Confirmation of an AI analysis: which pieces to run and the instructions for the model.
 * The instructions are saved on the campaign, so every later analysis (a single piece,
 * retries and the automatic one after a Drive refresh) obeys them too.
 */
export function AnalysisDialog({
  campaignId,
  initialScope,
  counts,
  onClose,
  onStart,
}: {
  campaignId: string;
  initialScope: AnalysisScope;
  counts: Record<AnalysisScope, number | undefined>;
  onClose: () => void;
  onStart: (scope: AnalysisScope) => Promise<void> | void;
}) {
  const [scope, setScope] = useState<AnalysisScope>(initialScope);
  const count = counts[scope];
  const rerun = scope !== "pending";
  const id = campaignId as Id<"qaVisualCampaigns">;
  const saved = useQuery(api.qaVisual.campaigns.analysisInstructions, {
    campaignId: id,
  });
  const save = useMutation(api.qaVisual.campaigns.setAnalysisInstructions);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => dialogRef.current?.showModal(), []);
  const value = text ?? saved?.instructions ?? "";
  const loading = saved === undefined;

  async function start() {
    setBusy(true);
    setError("");
    try {
      if (value.trim() !== (saved?.instructions ?? ""))
        await save({ campaignId: id, instructions: value });
      await onStart(scope);
      onClose();
    } catch (cause) {
      const data = cause instanceof ConvexError ? cause.data : null;
      setError(
        typeof data === "string"
          ? data
          : (data?.message ?? "No se pudieron guardar las instrucciones."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="qa-dialog"
      aria-labelledby="qa-analysis-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="qa-dialog-head">
        <div>
          <h2 id="qa-analysis-title">
            {rerun ? "Volver a analizar piezas" : "Analizar piezas con IA"}
          </h2>
          <p>
            La IA compara cada pieza con el pedido del cliente y revisa que todo
            el texto esté bien escrito (ortografía, tildes y redacción).
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Cerrar"
          onClick={onClose}
          disabled={busy}
        >
          <X size={16} />
        </button>
      </header>
      <div className="qa-dialog-body">
        <fieldset className="qa-field qa-scope-options">
          <legend>Qué piezas analizar</legend>
          {(Object.keys(scopes) as AnalysisScope[]).map((option) => (
            <label
              key={option}
              className={`qa-scope-option ${scope === option ? "on" : ""}`}
            >
              <input
                type="radio"
                name="qa-analysis-scope"
                value={option}
                checked={scope === option}
                disabled={busy || counts[option] === 0}
                onChange={() => setScope(option)}
              />
              <span>
                <b>{scopes[option].title}</b>
                <small>{scopes[option].detail}</small>
              </span>
              <em>{counts[option] ?? "—"}</em>
            </label>
          ))}
        </fieldset>
        <label className="qa-field">
          <span>
            Instrucciones para la IA <small>(opcional)</small>
          </span>
          <textarea
            rows={6}
            value={value}
            maxLength={MAX_INSTRUCTIONS}
            disabled={loading || busy}
            placeholder={
              rerun
                ? "Contale a la IA qué está bien así, por ejemplo:\n• El precio sin el signo $ es correcto.\n• «LOCURA» va sin tilde: es el nombre del producto.\n• La fecha se agrega después; no la marques como faltante."
                : "Por ejemplo:\n• No marques como error que «LOCURA» no lleve tilde: es el nombre del producto.\n• Aceptá el precio sin el signo $.\n• Revisá también que el logo esté arriba a la derecha."
            }
            onChange={(event) => setText(event.target.value)}
          />
          <small>
            La IA las obedece en cada análisis de esta campaña, también al
            reanalizar una pieza o después de actualizar desde Drive. Las
            dimensiones y el formato del archivo se controlan por código y no
            cambian con estas instrucciones. {value.length}/{MAX_INSTRUCTIONS}
          </small>
        </label>
        {error && (
          <p className="qa-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="qa-dialog-foot">
        <span className="qa-muted">
          {count === undefined
            ? ""
            : `${count} ${count === 1 ? "pieza" : "piezas"}`}
        </span>
        <button className="button secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          className="button primary"
          onClick={() => void start()}
          disabled={busy || loading || count === 0}
        >
          {busy ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <ScanLine size={14} />
          )}
          {rerun ? "Reanalizar" : "Analizar"}
          {count ? ` ${count}` : ""}
        </button>
      </footer>
    </dialog>
  );
}
