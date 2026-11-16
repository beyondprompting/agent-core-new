"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Bot, CheckCheck, LoaderCircle, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type BulkApproveItem = {
  pieceVersionId: string;
  title: string;
  version: number;
  aiValidated: boolean;
};

type Reason = "acceptedFinding" | "falsePositive" | "notApplicable" | "other";

/**
 * Team approval of several pieces from the gallery. AI-validated versions are approved as is;
 * the rest only if the reviewer writes one justification that is stored with each approval.
 */
export function BulkApproveDialog({
  campaignId,
  items,
  onClose,
  onDone,
}: {
  campaignId: string;
  items: BulkApproveItem[];
  onClose: () => void;
  onDone: (approvedIds: string[], message: string) => void;
}) {
  const approveMany = useMutation(api.qaVisual.decisions.approveMany);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => dialogRef.current?.showModal(), []);
  const validated = items.filter((i) => i.aiValidated);
  const withFindings = items.filter((i) => !i.aiValidated);
  const [includeFindings, setIncludeFindings] = useState(false);
  const [reason, setReason] = useState<Reason>("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<{ title: string; reason: string }[]>([]);
  const chosen = includeFindings ? items : validated;
  const needsNote = includeFindings && withFindings.length > 0;
  async function approve() {
    setBusy(true);
    setError("");
    try {
      const result = await approveMany({
        campaignId: campaignId as Id<"qaVisualCampaigns">,
        pieceVersionIds: chosen.map((i) => i.pieceVersionId as Id<"qaVisualPieceVersions">),
        ...(needsNote ? { exception: { reason, note: note.trim() } } : {}),
      });
      const skippedIds = new Set(result.skipped.map((s) => s.pieceVersionId as string));
      const approvedIds = chosen.map((i) => i.pieceVersionId).filter((id) => !skippedIds.has(id));
      const message = `${result.approved} ${result.approved === 1 ? "pieza aprobada" : "piezas aprobadas"} por el equipo`;
      if (result.skipped.length) {
        setSkipped(
          result.skipped.map((s) => ({
            title: items.find((i) => i.pieceVersionId === s.pieceVersionId)?.title ?? "Pieza",
            reason: s.reason,
          })),
        );
        onDone(approvedIds, message);
      } else {
        onDone(approvedIds, message);
        onClose();
      }
    } catch (e) {
      const data = e instanceof ConvexError ? e.data : null;
      setError(typeof data === "string" ? data : (data?.message ?? "No se pudieron aprobar las piezas."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="qa-dialog"
      aria-labelledby="qa-bulk-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="qa-dialog-head">
        <div>
          <h2 id="qa-bulk-title">Aprobar {items.length} {items.length === 1 ? "pieza" : "piezas"}</h2>
          <p>Es la aprobación del equipo de la versión actual. Después vas a poder enviarlas al cliente.</p>
        </div>
        <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="qa-dialog-body qa-bulk">
        {skipped.length > 0 ? (
          <div className="qa-bulk-skipped" role="status">
            <b>Estas piezas no se aprobaron</b>
            <ul>
              {skipped.map((s, i) => (
                <li key={i}>
                  <span>{s.title}</span>
                  <small>{s.reason}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="qa-bulk-group success">
              <span className="qa-bulk-count">{validated.length}</span>
              <div>
                <b>Validadas por IA</b>
                <small>Se aprueban directamente.</small>
              </div>
            </div>
            {withFindings.length > 0 && (
              <div className={`qa-bulk-group warning ${includeFindings ? "on" : ""}`}>
                <span className="qa-bulk-count">{withFindings.length}</span>
                <div>
                  <b>Con hallazgos o sin análisis completo</b>
                  <small>Solo se aprueban con una justificación, que queda registrada en cada pieza.</small>
                  <label className="qa-bulk-toggle">
                    <input
                      type="checkbox"
                      checked={includeFindings}
                      onChange={(e) => setIncludeFindings(e.target.checked)}
                    />
                    Aprobarlas también con excepción
                  </label>
                  {includeFindings && (
                    <div className="qa-bulk-exception">
                      <label className="qa-field">
                        <span>Motivo</span>
                        <select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
                          <option value="acceptedFinding">Hallazgo aceptado por el cliente</option>
                          <option value="falsePositive">Falso positivo de IA</option>
                          <option value="notApplicable">El requisito no aplica</option>
                          <option value="other">Otro motivo</option>
                        </select>
                      </label>
                      <label className="qa-field">
                        <span>Justificación</span>
                        <textarea
                          rows={3}
                          value={note}
                          maxLength={4000}
                          placeholder="Por qué se aprueban a pesar de los hallazgos…"
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <ul className="qa-bulk-list">
                    {withFindings.slice(0, 6).map((i) => (
                      <li key={i.pieceVersionId}>
                        <Bot size={11} /> {i.title} · v{i.version}
                      </li>
                    ))}
                    {withFindings.length > 6 && <li>y {withFindings.length - 6} más</li>}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="qa-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="qa-dialog-foot">
        {skipped.length > 0 ? (
          <button className="button primary" onClick={onClose}>
            Entendido
          </button>
        ) : (
          <>
            <span className="qa-muted">
              {chosen.length} de {items.length} se van a aprobar
            </span>
            <button className="button secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button
              className="button primary"
              onClick={() => void approve()}
              disabled={busy || !chosen.length || (needsNote && !note.trim())}
            >
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCheck size={14} />}
              Aprobar {chosen.length}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
