"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { LoaderCircle, ScanLine, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const MAX_INSTRUCTIONS = 2000;

/**
 * Confirmation of an AI analysis. The instructions are saved on the campaign, so every later
 * analysis (a single piece, retries and the automatic one after a Drive refresh) obeys them too.
 */
export function AnalysisDialog({
  campaignId,
  scope,
  count,
  onClose,
  onStart,
}: {
  campaignId: string;
  scope: "pending" | "all";
  count?: number;
  onClose: () => void;
  onStart: () => Promise<void> | void;
}) {
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
      await onStart();
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
            {scope === "all"
              ? "Reanalizar todas las piezas"
              : "Analizar piezas con IA"}
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
              "Por ejemplo:\n• No marques como error que «LOCURA» no lleve tilde: es el nombre del producto.\n• Aceptá el precio sin el signo $.\n• Revisá también que el logo esté arriba a la derecha."
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
          {scope === "all" ? "Reanalizar" : "Analizar"}
          {count ? ` ${count}` : ""}
        </button>
      </footer>
    </dialog>
  );
}
