import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Check,
  Copy,
  Info,
  Link2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  campaignError,
  type CampaignCardData,
} from "@/app/lib/qa-visual/campaign-model";
import {
  FolderChecklist,
  type FolderInspection,
  type SourceSelection,
} from "./FolderChecklist";

const selectionKey = (url: string, selection: SourceSelection) =>
  JSON.stringify([
    url.trim(),
    selection.excelFileId ?? "",
    selection.csvFileId ?? "",
  ]);

export function CampaignForm({
  campaign,
  onClose,
  onCreated,
}: {
  campaign?: CampaignCardData;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const started = useRef(false);
  const add = useAction(api.qaVisual.campaignRegistration.add);
  const inspect = useAction(api.qaVisual.campaignRegistration.inspect);
  const inspectCampaign = useAction(
    api.qaVisual.campaignRegistration.inspectCampaign,
  );
  const chooseSources = useAction(
    api.qaVisual.campaignRegistration.chooseSources,
  );
  const account = useQuery(api.qaVisual.campaigns.serviceAccount, {});
  const [url, setUrl] = useState(campaign?.folderUrl ?? "");
  const [selection, setSelection] = useState<SourceSelection>(
    campaign?.sourceSelection ?? {},
  );
  const [step, setStep] = useState<"link" | "check">(
    campaign ? "check" : "link",
  );
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [verified, setVerified] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"inspect" | "save" | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const ready = inspection?.ok && verified === selectionKey(url, selection);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    if (!campaign) inputRef.current?.focus();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [campaign]);

  useEffect(() => {
    if (campaign && !started.current) {
      started.current = true;
      void verify(campaign.sourceSelection);
    }
    // Initial inspection is read-only; later checks are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);

  async function verify(chosen: SourceSelection = selection) {
    if (submitting.current || !url.trim()) return;
    submitting.current = true;
    setPending("inspect");
    setStep("check");
    setError("");
    setVerified("");
    try {
      const result = campaign
        ? await inspectCampaign({ campaignId: campaign._id, ...chosen })
        : await inspect({ folderUrl: url.trim(), ...chosen });
      setInspection(result);
      if ("folder" in result) {
        setSelection(result.selection);
        if (result.ok) setVerified(selectionKey(url, result.selection));
      }
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      submitting.current = false;
      setPending(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "link") {
      await verify();
      return;
    }
    if (submitting.current || !ready) return;
    submitting.current = true;
    setPending("save");
    setError("");
    try {
      if (campaign) {
        const result = await chooseSources({
          campaignId: campaign._id,
          ...selection,
        });
        if (result.error) {
          setError(result.error);
          if (result.inspection) {
            setInspection(result.inspection);
            setVerified("");
          }
        } else onCreated(campaign.name);
      } else {
        const result = await add({ folderUrl: url.trim(), ...selection });
        if ("error" in result) {
          setError(result.error);
          if (result.inspection) {
            setInspection(result.inspection);
            setVerified("");
          }
        } else onCreated(result.name);
      }
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      submitting.current = false;
      setPending(null);
    }
  }

  async function copyAccount() {
    if (!account) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
    } catch {
      setCopyError(
        "No se pudo copiar. Seleccioná el correo y copialo manualmente.",
      );
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="qc-dialog"
      aria-labelledby="qa-campaign-form-title"
      aria-describedby="qa-campaign-form-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting.current)
          onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="qc-dialog-header">
          <div>
            <h2 id="qa-campaign-form-title">
              {campaign ? "Elegir fuentes" : "Agregar campaña"}
            </h2>
            <p id="qa-campaign-form-description">
              {campaign ? (
                `Elegí la matriz y el CSV de ${campaign.name}.`
              ) : (
                <>
                  Compartí la carpeta con la cuenta de servicio como{" "}
                  <b>Lector</b> y pegá su enlace.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="qc-icon-button"
            onClick={onClose}
            disabled={Boolean(pending)}
            aria-label="Cerrar diálogo"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {!campaign && (
          <ol
            className="qc-stepper"
            aria-label="Pasos para agregar una campaña"
          >
            <li
              className={step === "link" ? "current" : "done"}
              aria-current={step === "link" ? "step" : undefined}
            >
              <span>
                {step === "check" ? <Check size={12} aria-hidden /> : "1"}
              </span>
              Enlace
            </li>
            <li
              className={step === "check" ? "current" : ""}
              aria-current={step === "check" ? "step" : undefined}
            >
              <span>2</span>Verificación
            </li>
          </ol>
        )}
        <div className="qc-dialog-body">
          <label className="qc-label" htmlFor="qa-drive-folder">
            Enlace de la carpeta de Drive
          </label>
          <div className="qc-url-field">
            <Link2 size={14} aria-hidden />
            <input
              ref={inputRef}
              id="qa-drive-folder"
              type="url"
              required
              maxLength={2048}
              value={url}
              readOnly={
                step === "check" || Boolean(campaign) || Boolean(pending)
              }
              onChange={(event) => {
                setUrl(event.target.value);
                setInspection(null);
                setSelection({});
                setVerified("");
                setError("");
              }}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </div>
          <div className="qc-service-account">
            <span>
              Cuenta de servicio ·{" "}
              {account ? (
                <code>{account}</code>
              ) : account === undefined ? (
                "Cargando…"
              ) : (
                "No configurada"
              )}
            </span>
            {account && (
              <button
                type="button"
                className="qc-button ghost small"
                onClick={copyAccount}
              >
                {copied ? (
                  <Check size={14} aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
                {copied ? "Copiado" : "Copiar"}
              </button>
            )}
          </div>
          <p className="qc-sr-only" role="status">
            {copied ? "Correo de la cuenta de servicio copiado." : ""}
          </p>
          {copyError && (
            <p className="qc-error" role="alert">
              {copyError}
            </p>
          )}
          {pending === "inspect" && (
            <p className="qc-loading" role="status">
              <LoaderCircle size={16} className="qc-spin" aria-hidden />
              Verificando carpeta…
            </p>
          )}
          {step === "check" &&
            inspection &&
            ("folder" in inspection ? (
              <FolderChecklist
                inspection={inspection}
                selection={selection}
                disabled={Boolean(pending)}
                onSelect={(chosen) => {
                  setSelection(chosen);
                  void verify(chosen);
                }}
              />
            ) : (
              <div className="qc-callout danger" role="alert">
                <Info size={16} aria-hidden />
                <p>{inspection.error}</p>
              </div>
            ))}
          {error && (
            <p className="qc-error" role="alert">
              {error}
            </p>
          )}
          {step === "check" && inspection && !ready && !pending && (
            <div className="qc-callout info">
              <Info size={16} aria-hidden />
              <p>
                {campaign
                  ? "No se cambiaron las fuentes."
                  : "No se registró la campaña."}{" "}
                Cuando corrijas la carpeta en Drive, volvé a verificar.
              </p>
            </div>
          )}
        </div>
        <div className="qc-dialog-footer">
          <div>
            {step === "check" && !campaign && (
              <button
                type="button"
                className="qc-button ghost"
                disabled={Boolean(pending)}
                onClick={() => {
                  setStep("link");
                  setVerified("");
                  setError("");
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                Volver
              </button>
            )}
          </div>
          <div className="qc-dialog-actions">
            <button
              type="button"
              className="qc-button ghost"
              onClick={onClose}
              disabled={Boolean(pending)}
            >
              Cancelar
            </button>
            {step === "check" && !ready && (
              <button
                type="button"
                className="qc-button secondary"
                disabled={Boolean(pending)}
                onClick={() => void verify()}
              >
                <RefreshCw size={14} aria-hidden />
                Verificar de nuevo
              </button>
            )}
            <button
              type="submit"
              className="qc-button primary"
              disabled={
                Boolean(pending) || !url.trim() || (step === "check" && !ready)
              }
            >
              {pending && (
                <LoaderCircle size={14} className="qc-spin" aria-hidden />
              )}
              {pending === "save"
                ? "Guardando…"
                : pending === "inspect"
                  ? "Verificando…"
                  : step === "link"
                    ? "Verificar carpeta"
                    : campaign
                      ? "Guardar e importar"
                      : "Agregar campaña"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
