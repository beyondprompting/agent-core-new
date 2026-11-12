"use client";

import { useMemo } from "react";
import { CheckCircle2, ScanLine, X, AlertCircle } from "lucide-react";
import { CampaignHeader } from "@/app/components/qa-visual/campaign/CampaignHeader";
import { FilesPanel } from "@/app/components/qa-visual/campaign/FilesPanel";
import { PiecePanel } from "@/app/components/qa-visual/piece/PiecePanel";
import { ReviewCanvas } from "@/app/components/qa-visual/viewer/ReviewCanvas";
import { ReviewDialogs } from "@/app/components/qa-visual/piece/ReviewDialogs";
import { ViewerToolbar } from "@/app/components/qa-visual/viewer/ViewerToolbar";
import ImageCommentPopover from "@/app/components/qa-visual/comments/image-comment-popover";
import { toReviewPieces } from "@/app/lib/qa-visual/piece-inventory";
import {
  emptyReviewFeed,
  type Piece,
  type ReviewFeed,
} from "@/app/lib/qa-visual/review-model";
import { useUser } from "@/app/UserContextProvider";
import type { QaInventory } from "@/app/lib/qa-visual/source";
import { useReviewSession } from "@/app/hooks/qa-visual/use-review-session";
import {
  useAgentAnalysis,
  type AnalysisContext,
} from "@/app/hooks/qa-visual/use-agent-analysis";
import "./review.css";

export function QaViewer({
  campaignId,
  inventory,
  feed = emptyReviewFeed,
  analysis,
  syncError,
  refreshing = false,
  onRefresh,
}: {
  campaignId: string;
  inventory: QaInventory;
  feed?: ReviewFeed;
  analysis?: AnalysisContext;
  syncError?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const agent = useAgentAnalysis(analysis);
  const { user } = useUser();
  const reviewer = user?.name || user?.email || "Revisor";
  const pieces = useMemo(
    () => toReviewPieces(inventory, campaignId),
    [inventory, campaignId],
  );
  return (
    <div className="qa-visual">
      <div className="workspace">
        {inventory.notices.length > 0 && (
          <div className="drive-notices" role="status">
            {inventory.notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </div>
        )}
        {syncError && (
          <div className="drive-notices" role="alert">
            {syncError}
          </div>
        )}
        {pieces.length ? (
          <ReviewWorkspace
            key={campaignId}
            pieces={pieces}
            inventory={inventory}
            feed={analysis ? agent.feed : feed}
            agent={agent}
            reviewer={reviewer}
            campaignId={campaignId}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        ) : (
          <>
            <CampaignHeader
              campaignName={inventory.campaignName}
              reviewer={reviewer}
              analyzing={false}
              onRefresh={onRefresh}
              refreshing={refreshing}
            />
            <section className="empty-state">
              <ScanLine size={28} />
              <p role="status">
                {refreshing
                  ? "Importando los archivos de Drive…"
                  : "No hay piezas disponibles para revisar."}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewWorkspace({
  campaignId,
  pieces,
  inventory,
  feed,
  reviewer,
  agent,
  onRefresh,
  refreshing,
}: {
  campaignId: string;
  agent: ReturnType<typeof useAgentAnalysis>;
  onRefresh?: () => void;
  refreshing: boolean;
  feed: ReviewFeed;
  reviewer: string;
  pieces: Piece[];
  inventory: QaInventory;
}) {
  const session = useReviewSession(
    pieces,
    inventory,
    feed,
    reviewer,
    campaignId,
  );
  const {
    leftOpen,
    rightOpen,
    version,
    pendingPin,
    artboardRef,
    piece,
    zoom,
    pan,
    rightTab,
    toast,
  } = session;
  const row = agent.dashboard?.reviews.find(
    (review) => review?.name === piece.filename,
  );
  const phase =
    row?.status === "stale"
      ? "Análisis desactualizado"
      : row?.status === "preparing"
        ? "Preparando imagen"
        : row?.status === "queued"
          ? "En cola"
          : row?.status === "retrying"
            ? "Esperando reintento"
            : row?.status === "analyzing"
              ? "Analizando"
              : row?.status === "failed"
                ? (row.error ?? "Error de análisis")
                : undefined;
  const dashboard = agent.dashboard;
  const total = dashboard?.total ?? 0;
  const failed = dashboard?.failed ?? 0;
  const finished = (dashboard?.completed ?? 0) + failed;
  const percentage = total ? Math.round((finished / total) * 100) : 0;
  const complete = total > 0 && finished === total && !agent.busy;
  return (
    <>
      <CampaignHeader
        campaignName={inventory.campaignName}
        reviewer={reviewer}
        onShare={() => session.setModal("share")}
        analyzing={agent.busy}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onAnalyze={
          agent.available ? () => void agent.launch("batch") : undefined
        }
      />
      {dashboard?.total || phase || agent.error ? (
        <div className="qa-analysis-bar" role="status" aria-live="polite">
          <div
            className={`qa-analysis-icon ${complete ? (failed || dashboard?.findings || dashboard?.partial ? "has-errors" : dashboard?.stale ? "" : "is-complete") : ""}`}
            aria-hidden="true"
          >
            {complete ? (
              failed ? (
                <AlertCircle size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )
            ) : (
              <ScanLine size={18} />
            )}
          </div>
          <div className="qa-analysis-main">
            <div className="qa-analysis-heading">
              <strong>
                {complete ? "Análisis finalizado" : "Análisis de campaña"}
              </strong>
              {total > 0 && (
                <span className="qa-analysis-count">
                  {finished} de {total} piezas
                </span>
              )}
              {complete && (
                <span>
                  {dashboard?.validated ?? 0} validadas ·{" "}
                  {dashboard?.findings ?? 0} con hallazgos ·{" "}
                  {dashboard?.partial ?? 0} incompletas
                  {!!dashboard?.stale && (
                    <> · {dashboard.stale} desactualizadas</>
                  )}
                </span>
              )}
              {failed > 0 && (
                <span className="qa-analysis-errors">{failed} con error</span>
              )}
            </div>
            {total > 0 && (
              <div className="qa-analysis-meter">
                <div
                  className="qa-analysis-track"
                  role="progressbar"
                  aria-label="Progreso del análisis"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={finished}
                >
                  <span
                    style={{
                      width: `${((dashboard?.validated ?? 0) / total) * 100}%`,
                    }}
                  />
                  <span
                    className="qa-analysis-track-findings"
                    style={{
                      width: `${((dashboard?.findings ?? 0) / total) * 100}%`,
                    }}
                  />
                  <span
                    className="qa-analysis-track-partial"
                    style={{
                      width: `${((dashboard?.partial ?? 0) / total) * 100}%`,
                    }}
                  />
                  <span
                    className="qa-analysis-track-error"
                    style={{ width: `${(failed / total) * 100}%` }}
                  />
                  <span
                    className="qa-analysis-track-stale"
                    style={{
                      width: `${((dashboard?.stale ?? 0) / total) * 100}%`,
                    }}
                  />
                </div>
                <span>{percentage}%</span>
              </div>
            )}
            {!!dashboard?.preparingImages && (
              <span className="qa-analysis-phase">
                Preparando imágenes · {dashboard.preparedImages} de {total}{" "}
                listas
              </span>
            )}
            {phase && phase !== "Preparando imagen" && (
              <div className="qa-analysis-detail">
                {phase}
                {row && "previous" in row && row.previous
                  ? " · Se muestra el resultado anterior"
                  : ""}
              </div>
            )}
            {agent.error && (
              <div className="qa-analysis-detail">{agent.error}</div>
            )}
          </div>
          {agent.available && !!dashboard?.failedNames.length && (
            <div className="qa-analysis-actions">
              <button
                className="button secondary"
                disabled={agent.busy}
                onClick={() =>
                  void agent.launch("retry", dashboard.failedNames)
                }
              >
                Reintentar fallidas
              </button>
            </div>
          )}
        </div>
      ) : null}
      {session.saveError && (
        <div className="drive-notices" role="alert">
          {session.saveError}
        </div>
      )}
      <section
        aria-label="Revisión visual"
        className={`review-layout ${!leftOpen ? "hide-left" : ""} ${!rightOpen ? "hide-right" : ""}`}
      >
        {leftOpen && <FilesPanel session={session} />}
        <section className="viewer" aria-label="Visor de pieza">
          <ViewerToolbar session={session} />
          <ReviewCanvas session={session} />
        </section>
        {rightOpen && (
          <PiecePanel
            session={session}
            findings={session.detail?.review?.findings}
          />
        )}
      </section>
      {pendingPin && (
        <ImageCommentPopover
          anchor={artboardRef}
          point={pendingPin}
          pieceName={piece.name}
          reviewer={reviewer}
          layoutKey={`${zoom}-${pan.x}-${pan.y}-${leftOpen}-${rightOpen}-${rightTab}`}
          onPublish={session.publishImageComment}
          busy={session.saving}
          onCancel={session.cancelImageComment}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
          <button
            aria-label="Cerrar aviso"
            onClick={() => session.setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <ReviewDialogs session={session} />
    </>
  );
}
