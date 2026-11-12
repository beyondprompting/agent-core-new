import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Check,
  FileSpreadsheet,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  campaignDate,
  campaignError,
  type CampaignCardData,
} from "@/app/lib/qa-visual/campaign-model";
import { useCampaignSummary } from "@/app/hooks/qa-visual/use-campaign-summary";
import {
  importStages,
  importStageLabels,
} from "@/convex/qaVisual/model/importProgress";

export function CampaignCard({
  campaign,
  onChooseSources,
}: {
  campaign: CampaignCardData;
  onChooseSources: (campaign: CampaignCardData) => void;
}) {
  const summary = useCampaignSummary(campaign);
  const refresh = useMutation(api.qaVisual.campaignSnapshots.refresh);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const archived = campaign.status === "archived";
  const importing = campaign.syncing || retrying;
  const failed = !importing && !archived && Boolean(campaign.syncError);
  const needsSources = failed && campaign.needsSources;
  const analyzing = campaign.analyzing && !archived;
  const stage = Math.max(
    0,
    importStages.indexOf(campaign.importStage ?? "listing"),
  );
  const tone = archived
    ? "neutral"
    : importing
      ? "primary"
      : needsSources
        ? "warning"
        : failed
          ? "danger"
          : analyzing
            ? "primary"
            : "neutral";
  const label = archived
    ? "Archivada"
    : importing
      ? "Importando"
      : needsSources
        ? "Requiere acción"
        : failed
          ? "No se pudo actualizar"
          : analyzing
            ? `Analizando${summary ? ` · ${summary.done} de ${summary.pieces}` : ""}`
            : summary?.pieces
              ? summary.done === summary.pieces
                ? "Análisis completo"
                : "Lista para revisar"
              : summary
                ? "Sin piezas"
                : "Cargando…";
  const Icon = archived
    ? Archive
    : importing || analyzing
      ? LoaderCircle
      : failed
        ? AlertCircle
        : Check;

  async function retry() {
    setRetrying(true);
    setError("");
    try {
      await refresh({ campaignId: campaign._id });
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="qa-campaign-card" aria-label={campaign.name}>
      <div className="qc-card-top">
        <span className="qc-folder-icon">
          <FolderOpen size={20} aria-hidden />
        </span>
        <span className={`qc-chip ${tone}`}>
          <Icon
            size={12}
            className={importing || analyzing ? "qc-spin" : undefined}
            aria-hidden
          />
          {label}
        </span>
      </div>
      <div>
        <h2>{campaign.name}</h2>
        <p className="qc-meta">
          {failed && campaign.lastSyncedAt
            ? "Datos visibles del "
            : "Google Drive · " +
              (campaign.lastSyncedAt ? "actualizada " : "agregada ")}
          <time
            dateTime={new Date(
              campaign.lastSyncedAt ?? campaign.createdAt,
            ).toISOString()}
          >
            {campaignDate(campaign.lastSyncedAt ?? campaign.createdAt)}
          </time>
        </p>
      </div>
      {importing ? (
        <>
          <div
            className="qc-indeterminate"
            role="progressbar"
            aria-label="Importando campaña"
          />
          <ol className="qc-import-steps" aria-label="Etapas de importación">
            {importStageLabels.map((name, index) => (
              <li
                key={name}
                className={
                  index < stage ? "done" : index === stage ? "current" : ""
                }
                aria-current={index === stage ? "step" : undefined}
              >
                {index < stage && <Check size={12} aria-hidden />}
                {name}
              </li>
            ))}
          </ol>
          <p className="qc-help">
            {campaign.imported
              ? "La última importación sigue disponible mientras se actualiza."
              : "Podés abrir la campaña cuando termine. Las imágenes se preparan después, sin bloquear el editor."}
          </p>
        </>
      ) : failed ? (
        <div className={`qc-callout ${needsSources ? "warning" : "danger"}`}>
          {needsSources ? (
            <FileSpreadsheet size={16} aria-hidden />
          ) : (
            <AlertCircle size={16} aria-hidden />
          )}
          <div>
            <strong>
              {needsSources
                ? "Elegí las fuentes de esta campaña"
                : "No se pudo completar la importación"}
            </strong>
            <p>{campaign.syncError}</p>
            {campaign.imported && (
              <p>Mientras tanto se muestra la última importación.</p>
            )}
          </div>
        </div>
      ) : summary ? (
        <>
          <div
            className="qc-progress"
            role="img"
            aria-label={`${summary.validated} validadas, ${summary.findings} con hallazgos, ${summary.partial} incompletas y ${summary.failed} con error, de ${summary.pieces} piezas`}
          >
            {(["validated", "findings", "partial", "failed"] as const).map(
              (key) => (
                <span
                  key={key}
                  className={key}
                  style={{
                    width: `${summary.pieces ? (summary[key] / summary.pieces) * 100 : 0}%`,
                  }}
                />
              ),
            )}
          </div>
          <dl className="qc-stats">
            {(
              [
                ["pieces", "piezas", ""],
                ["validated", "validadas", "success"],
                ["findings", "con hallazgos", "warning"],
                ["approved", "aprobadas", "success"],
              ] as const
            ).map(([key, name, color]) => (
              <div key={key} className={color}>
                <dt>{name}</dt>
                <dd>{summary[key]}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="qc-help" role="status">
          Cargando resumen…
        </p>
      )}
      {error && (
        <p className="qc-error" role="alert">
          {error}
        </p>
      )}
      <div className="qc-card-footer">
        <span className="qc-muted">
          {importing && campaign.importImages !== undefined
            ? `${campaign.importImages} imágenes encontradas`
            : failed
              ? campaign.imported && summary
                ? `${summary.pieces} piezas · ${summary.validated} validadas`
                : "Sin importación lista"
              : summary
                ? `${summary.notices} ${summary.notices === 1 ? "aviso" : "avisos"} de fuente`
                : ""}
        </span>
        {needsSources ? (
          <button
            className="qc-button secondary small"
            onClick={() => onChooseSources(campaign)}
          >
            Elegir fuentes
          </button>
        ) : failed ? (
          <button
            className="qc-button secondary small"
            onClick={retry}
            disabled={retrying}
          >
            <RefreshCw size={14} aria-hidden />
            Reintentar
          </button>
        ) : !archived && campaign.imported ? (
          <Link
            className="qc-review-link"
            href={`/workspace/qa-visual/${campaign._id}`}
            prefetch={false}
          >
            {importing ? "Abrir última revisión" : "Abrir revisión"}
            <ArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>
      {failed && campaign.imported && (
        <Link
          className="qc-review-link"
          href={`/workspace/qa-visual/${campaign._id}`}
          prefetch={false}
        >
          Abrir última revisión
          <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </li>
  );
}
