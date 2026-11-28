import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowRight, FilePen, LoaderCircle, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { CampaignDraft } from "./CampaignForm";

/** Registrations that were not finished: everything decided in them is kept. */
export function DraftList({
  drafts,
  onContinue,
  onDiscarded,
}: {
  drafts: CampaignDraft[];
  onContinue: (draft: CampaignDraft) => void;
  onDiscarded: (name: string) => void;
}) {
  const discard = useMutation(api.qaVisual.campaigns.discardDraft);
  const [confirming, setConfirming] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");

  async function remove(draft: CampaignDraft) {
    setPending(draft._id);
    setError("");
    try {
      await discard({ campaignId: draft._id });
      onDiscarded(draft.name);
    } catch {
      setError("No se pudo descartar. Intentá de nuevo.");
    } finally {
      setPending(undefined);
      setConfirming(undefined);
    }
  }

  return (
    <section className="qc-drafts" aria-labelledby="qc-drafts-title">
      <h2 id="qc-drafts-title">Sin terminar</h2>
      <ul>
        {drafts.map((draft) => (
          <li key={draft._id} className="qc-draft">
            <span className="qc-draft-icon">
              <FilePen size={16} aria-hidden />
            </span>
            <div className="qc-draft-text">
              <strong>{draft.name}</strong>
              <span>
                {confirming === draft._id
                  ? "Se borran las piezas excluidas, las equivalencias y lo elegido. Los cambios ya aplicados al CSV quedan."
                  : `Empezada el ${new Date(draft.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "long" })} · falta vincular las piezas y crearla`}
              </span>
            </div>
            <div className="qc-draft-actions">
              {confirming === draft._id ? (
                <>
                  <button
                    type="button"
                    className="qc-button ghost small"
                    disabled={Boolean(pending)}
                    onClick={() => setConfirming(undefined)}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className="qc-button danger small"
                    disabled={Boolean(pending)}
                    onClick={() => void remove(draft)}
                  >
                    {pending === draft._id && (
                      <LoaderCircle size={14} className="qc-spin" aria-hidden />
                    )}
                    Sí, descartar
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="qc-button ghost small"
                    disabled={Boolean(pending)}
                    onClick={() => setConfirming(draft._id)}
                  >
                    <Trash2 size={14} aria-hidden />
                    Descartar
                  </button>
                  <button
                    type="button"
                    className="qc-button secondary small"
                    disabled={Boolean(pending)}
                    aria-haspopup="dialog"
                    onClick={() => onContinue(draft)}
                  >
                    Continuar
                    <ArrowRight size={14} aria-hidden />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="qc-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
