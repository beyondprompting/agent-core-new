import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowRight,
  Check,
  Copy,
  FileSpreadsheet,
  FileText,
  Images,
  Info,
  Link2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  campaignError,
  type CampaignCardData,
} from "@/app/lib/qa-visual/campaign-model";
import {
  FolderChecklist,
  type CsvDownload,
  type FolderInspection,
  type SourceSelection,
} from "./FolderChecklist";
import { MappingPanel, MappingSummary } from "./MappingPanel";

type Step = "link" | "sources" | "pieces";
export type CampaignDraft = FunctionReturnType<
  typeof api.qaVisual.campaigns.drafts
>[number];
const stepNames: Record<Step, string> = {
  link: "Enlace",
  sources: "Fuentes",
  pieces: "Piezas",
};

const selectionKey = (url: string, selection: SourceSelection) =>
  JSON.stringify([
    url.trim(),
    selection.excelFileId ?? "",
    selection.csvFileId ?? "",
    selection.resourcesFolderId ?? "",
    selection.editablesFolderId ?? "",
    selection.deploymentFolderId ?? "",
  ]);

export function CampaignForm({
  campaign,
  draft,
  onClose,
  onCreated,
}: {
  campaign?: CampaignCardData;
  /** A registration that was not finished: it opens on the pieces. */
  draft?: CampaignDraft;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const started = useRef(false);
  const add = useAction(api.qaVisual.campaignRegistration.add);
  const startDraft = useAction(api.qaVisual.campaignRegistration.startDraft);
  const inspect = useAction(api.qaVisual.campaignRegistration.inspect);
  const inspectCampaign = useAction(
    api.qaVisual.campaignRegistration.inspectCampaign,
  );
  const chooseSources = useAction(
    api.qaVisual.campaignRegistration.chooseSources,
  );
  const createCsv = useAction(api.qaVisual.campaignRegistration.createCsv);
  const account = useQuery(api.qaVisual.campaigns.serviceAccount, {});
  const [url, setUrl] = useState(campaign?.folderUrl ?? draft?.folderUrl ?? "");
  const [selection, setSelection] = useState<SourceSelection>(
    campaign?.sourceSelection ?? draft?.sourceSelection ?? {},
  );
  // Going to the pieces saves the campaign as a draft: from then on every decision is saved.
  const [draftId, setDraftId] = useState<Id<"qaVisualCampaigns"> | undefined>(
    draft?._id,
  );
  const campaignId = campaign?._id ?? draftId;
  // The dialog keeps one size for every step; each step uses the whole body.
  const [step, setStep] = useState<Step>(
    campaign
      ? campaign.mapping.locked
        ? "pieces"
        : "sources"
      : draft
        ? "pieces"
        : "link",
  );
  const steps: Step[] =
    campaign || draft ? ["sources", "pieces"] : ["link", "sources", "pieces"];
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [verified, setVerified] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<
    "inspect" | "draft" | "save" | "csv" | null
  >(null);
  const [csvNotice, setCsvNotice] = useState("");
  const [csvDownload, setCsvDownload] = useState<CsvDownload>();
  const [mappingBusy, setMappingBusy] = useState(false);
  // The CSV was corrected or pieces were excluded: the campaign is already updating.
  const [updating, setUpdating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const ready = inspection?.ok && verified === selectionKey(url, selection);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    if (!campaign && !draft) inputRef.current?.focus();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [campaign, draft]);

  useEffect(() => {
    const saved = campaign ?? draft;
    if (saved && !started.current) {
      started.current = true;
      void verify(saved.sourceSelection);
    }
    // Initial inspection is read-only; later checks are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, draft]);

  async function verify(chosen: SourceSelection = selection) {
    if (submitting.current || !url.trim()) return;
    submitting.current = true;
    setPending("inspect");
    setStep((current) => (current === "link" ? "sources" : current));
    setError("");
    setVerified("");
    try {
      const result = campaignId
        ? await inspectCampaign({ campaignId, ...chosen })
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

  async function generateCsv() {
    if (submitting.current) return;
    submitting.current = true;
    setPending("csv");
    setError("");
    setCsvNotice("");
    setCsvDownload(undefined);
    try {
      const result = await createCsv(
        campaignId
          ? { campaignId, ...selection }
          : { folderUrl: url.trim(), ...selection },
      );
      const summary = result.created ?? result.download;
      if (summary)
        setCsvNotice(
          `${result.created ? `Se creó «${summary.name}»` : "Se armó el CSV"} con ${summary.orders} ${summary.orders === 1 ? "pedido" : "pedidos"}. ` +
            `${summary.assigned} ${summary.assigned === 1 ? "imagen quedó vinculada" : "imágenes quedaron vinculadas"} por su nombre` +
            (summary.unassigned
              ? `; ${summary.unassigned} sin vincular: renombralas con su ID_PIEZA o corregí el CSV en Drive.`
              : "."),
        );
      if (result.download)
        setCsvDownload({
          name: result.download.name,
          content: result.download.content,
        });
      if (result.error) setError(result.error);
      if (result.inspection) {
        setInspection(result.inspection);
        if ("folder" in result.inspection) {
          setSelection(result.inspection.selection);
          setVerified(
            result.inspection.ok
              ? selectionKey(url, result.inspection.selection)
              : "",
          );
        }
      }
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      submitting.current = false;
      setPending(null);
    }
  }

  function adoptInspection(next: FolderInspection) {
    setInspection(next);
    if ("folder" in next) {
      setSelection(next.selection);
      setVerified(next.ok ? selectionKey(url, next.selection) : "");
    }
  }

  /**
   * Sources → pieces. A new campaign is saved as a draft here (or its draft gets the
   * current sources), so exclusions, equivalences and choices have where to be saved.
   */
  async function toPieces() {
    if (!ready || submitting.current) return;
    if (campaign) {
      setStep("pieces");
      return;
    }
    submitting.current = true;
    setPending("draft");
    setError("");
    try {
      const result = await startDraft({ folderUrl: url.trim(), ...selection });
      if ("error" in result) {
        setError(result.error);
        if (result.inspection) adoptInspection(result.inspection);
        return;
      }
      setDraftId(result.campaignId);
      adoptInspection(result.inspection);
      setStep("pieces");
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      submitting.current = false;
      setPending(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (campaign && updating) {
      onClose();
      return;
    }
    if (step === "link") {
      await verify();
      return;
    }
    if (step === "sources") {
      await toPieces();
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
      } else if (draftId) {
        const result = await add({ campaignId: draftId, ...selection });
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

  function goTo(next: Step) {
    if (next === "pieces" && steps.indexOf(step) < steps.indexOf("pieces")) {
      void toPieces();
      return;
    }
    if (next === "link") {
      setVerified("");
      setError("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    setStep(next);
  }

  const serviceAccount = (
    <>
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
    </>
  );

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
              {campaign?.mapping.locked
                ? "Resolver el mapeo de piezas"
                : campaign
                  ? "Elegir fuentes"
                  : draft
                    ? `Continuar ${draft.name}`
                    : "Agregar campaña"}
            </h2>
            <p id="qa-campaign-form-description">
              {campaign?.mapping.locked ? (
                `Hay piezas de ${campaign.name} que no se pueden vincular con el CSV o la matriz. Corregilas o excluilas para abrir el editor.`
              ) : campaign ? (
                `Elegí las carpetas, la matriz y el CSV de ${campaign.name}.`
              ) : step === "sources" ? (
                "Revisá qué encontró QA Visual en la carpeta y elegí la matriz y el CSV si hay más de uno."
              ) : step === "pieces" ? (
                "Cada pieza tiene que tener su fila en el CSV y su pedido en la matriz para poder analizarla."
              ) : (
                <>
                  Compartí la carpeta con la cuenta de servicio como{" "}
                  <b>Lector</b> (o <b>Editor</b> si querés que QA Visual cree el
                  CSV) y pegá su enlace.
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
        <ol className="qc-stepper" aria-label="Pasos">
          {steps.map((name, index) => {
            const at = steps.indexOf(step);
            const state =
              index < at ? "done" : index === at ? "current" : "next";
            // Going back is always possible; going to the pieces needs valid sources.
            const reachable =
              index < at || (name === "pieces" && at < index && ready);
            return (
              <li
                key={name}
                className={state}
                aria-current={state === "current" ? "step" : undefined}
              >
                <button
                  type="button"
                  disabled={!reachable || Boolean(pending) || mappingBusy}
                  onClick={() => goTo(name)}
                >
                  <span className="qc-step-num">
                    {state === "done" ? (
                      <Check size={12} aria-hidden />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {stepNames[name]}
                </button>
              </li>
            );
          })}
        </ol>
        <div className={`qc-dialog-body${step === "pieces" ? " fill" : ""}`}>
          {step === "link" && (
            <div className="qc-link-step">
              <div>
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
                    readOnly={Boolean(campaign) || Boolean(pending)}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setDraftId(undefined);
                      setInspection(null);
                      setSelection({});
                      setVerified("");
                      setError("");
                      setCsvNotice("");
                      setCsvDownload(undefined);
                    }}
                    placeholder="https://drive.google.com/drive/folders/…"
                  />
                </div>
                {serviceAccount}
              </div>
              <aside
                className="qc-guide"
                aria-label="Qué tiene que tener la carpeta"
              >
                <h3>Qué tiene que tener la carpeta</h3>
                <ol>
                  <li>
                    <span className="qc-guide-icon">
                      <FileSpreadsheet size={15} aria-hidden />
                    </span>
                    <div>
                      <b>RECURSOS</b>
                      <span>La matriz del cliente en .xlsx.</span>
                    </div>
                  </li>
                  <li>
                    <span className="qc-guide-icon">
                      <FileText size={15} aria-hidden />
                    </span>
                    <div>
                      <b>EDITABLES</b>
                      <span>
                        El CSV de producción, con cualquier nombre. Si no
                        existe, QA Visual lo puede crear desde la matriz.
                      </span>
                    </div>
                  </li>
                  <li>
                    <span className="qc-guide-icon">
                      <Images size={15} aria-hidden />
                    </span>
                    <div>
                      <b>DESPLIEGUE o VISUALES</b>
                      <span>Las piezas en PNG o JPEG.</span>
                    </div>
                  </li>
                </ol>
                <p>
                  Si las carpetas tienen otros nombres, en el paso siguiente
                  podés elegir cada una. Nada se modifica en Drive sin que lo
                  pidas.
                </p>
              </aside>
            </div>
          )}

          {step !== "link" && pending === "inspect" && !inspection && (
            <p className="qc-loading" role="status">
              <LoaderCircle size={16} className="qc-spin" aria-hidden />
              Verificando carpeta…
            </p>
          )}

          {step === "sources" && (
            <>
              {pending === "inspect" && inspection && (
                <p className="qc-loading" role="status">
                  <LoaderCircle size={16} className="qc-spin" aria-hidden />
                  Verificando carpeta…
                </p>
              )}
              {inspection &&
                ("folder" in inspection ? (
                  <>
                    <FolderChecklist
                      inspection={inspection}
                      selection={selection}
                      disabled={Boolean(pending)}
                      creatingCsv={pending === "csv"}
                      csvDownload={csvDownload}
                      onSelect={(chosen) => {
                        setSelection(chosen);
                        setCsvDownload(undefined);
                        void verify(chosen);
                      }}
                      onCreateCsv={() => void generateCsv()}
                    />
                    {inspection.mapping && (
                      <MappingSummary
                        mapping={inspection.mapping}
                        canContinue={Boolean(ready)}
                        onOpen={() => void toPieces()}
                      />
                    )}
                    {!inspection.ok && serviceAccount}
                  </>
                ) : (
                  <div className="qc-callout danger" role="alert">
                    <Info size={16} aria-hidden />
                    <p>{inspection.error}</p>
                  </div>
                ))}
              {csvNotice && (
                <div className="qc-callout info" role="status">
                  <Info size={16} aria-hidden />
                  <p>{csvNotice}</p>
                </div>
              )}
              {inspection && !ready && !pending && (
                <div className="qc-callout info">
                  <Info size={16} aria-hidden />
                  <p>
                    {campaign
                      ? "No se cambiaron las fuentes."
                      : "Todavía no se puede seguir."}{" "}
                    Cuando corrijas la carpeta en Drive, volvé a verificar.
                  </p>
                </div>
              )}
            </>
          )}

          {step === "pieces" &&
            inspection &&
            ("folder" in inspection && inspection.mapping && campaignId ? (
              <MappingPanel
                mapping={inspection.mapping}
                campaignId={campaignId}
                draft={!campaign}
                selection={selection}
                disabled={Boolean(pending)}
                loading={pending === "inspect"}
                onBusy={setMappingBusy}
                onChanged={(next) => {
                  if (campaign) setUpdating(true);
                  if (next) adoptInspection(next);
                  else void verify();
                }}
              />
            ) : (
              <div className="qc-callout info">
                <Info size={16} aria-hidden />
                <div>
                  <strong>No se puede revisar el mapeo todavía</strong>
                  <p>
                    {!("folder" in inspection)
                      ? inspection.error
                      : inspection.mapping
                        ? "Volvé a las fuentes y tocá «Siguiente: piezas»."
                        : "Hacen falta la matriz, el CSV y la carpeta de piezas con imágenes."}
                  </p>
                  <button
                    type="button"
                    className="qc-link-button"
                    disabled={Boolean(pending)}
                    onClick={() => setStep("sources")}
                  >
                    Revisar las fuentes
                  </button>
                </div>
              </div>
            ))}
          {step === "pieces" &&
            inspection &&
            "folder" in inspection &&
            inspection.mapping &&
            !inspection.ok &&
            !pending && (
              <div className="qc-callout warning">
                <Info size={16} aria-hidden />
                <p>
                  Falta resolver alguna fuente.{" "}
                  <button
                    type="button"
                    className="qc-link-button"
                    onClick={() => setStep("sources")}
                  >
                    Ir a Fuentes
                  </button>
                </p>
              </div>
            )}

          {error && (
            <p className="qc-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="qc-dialog-footer">
          <div className="qc-footer-start">
            {steps.indexOf(step) > 0 && (
              <button
                type="button"
                className="qc-button ghost"
                disabled={Boolean(pending) || mappingBusy}
                onClick={() => goTo(steps[steps.indexOf(step) - 1])}
              >
                Volver
              </button>
            )}
            {draftId && !campaign && (
              <span className="qc-saved">
                <Check size={13} aria-hidden />
                Se guarda a medida que avanzás
              </span>
            )}
          </div>
          <div className="qc-dialog-actions">
            <button
              type="button"
              className="qc-button ghost"
              onClick={onClose}
              disabled={Boolean(pending)}
            >
              {draftId && !campaign ? "Cerrar" : "Cancelar"}
            </button>
            {step === "sources" && inspection && !ready && (
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
                Boolean(pending) ||
                mappingBusy ||
                !url.trim() ||
                (step !== "link" && !ready && !(campaign && updating))
              }
            >
              {pending && (
                <LoaderCircle size={14} className="qc-spin" aria-hidden />
              )}
              {pending === "save"
                ? "Creando…"
                : pending === "draft"
                  ? "Guardando…"
                  : pending === "csv"
                    ? "Creando CSV…"
                    : pending === "inspect"
                      ? "Verificando…"
                      : step === "link"
                        ? "Verificar carpeta"
                        : step === "sources"
                          ? "Siguiente: piezas"
                          : campaign && updating
                            ? "Listo"
                            : campaign
                              ? "Guardar e importar"
                              : "Crear campaña"}
              {!pending && step === "sources" && (
                <ArrowRight size={14} aria-hidden />
              )}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
