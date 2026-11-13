"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InternalGallery } from "@/app/components/qa-visual/campaign/InternalGallery";
import { InternalCarousel } from "@/app/components/qa-visual/campaign/InternalCarousel";
import { SendToClientDialog } from "@/app/components/qa-visual/deliveries/SendToClientDialog";
import type { CampaignView } from "@/app/components/qa-visual/campaign/CampaignHeader";
import "./gallery.css";
import { CheckCircle2, ScanLine, X, AlertCircle, Square } from "lucide-react";
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
import type { ReviewLocation } from "@/app/lib/qa-visual/review-location";
import { useReviewSession } from "@/app/hooks/qa-visual/use-review-session";
import {
  useAgentAnalysis,
  type AnalysisContext,
} from "@/app/hooks/qa-visual/use-agent-analysis";
import "./review.css";

export function QaViewer({
  campaignId,
  inventory,
  initialLocation = {},
  feed = emptyReviewFeed,
  analysis,
  syncError,
  refreshing = false,
  onRefresh,
}: {
  campaignId: string;
  inventory: QaInventory;
  initialLocation?: ReviewLocation;
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
            initialLocation={initialLocation}
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
  initialLocation,
  pieces,
  inventory,
  feed,
  reviewer,
  agent,
  onRefresh,
  refreshing,
}: {
  campaignId: string;
  initialLocation: ReviewLocation;
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
    initialLocation,
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
  const [view, setView] = useState<CampaignView>(
    initialLocation.view ?? "review",
  );
  const [carousel, setCarousel] = useState(false);
  const [sending, setSending] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const changeView = (next: CampaignView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "gallery") url.searchParams.set("vista", "galeria");
    else url.searchParams.delete("vista");
    window.history.replaceState(window.history.state, "", url);
  };
  const deliveryPreview = useQuery(api.qaVisual.clientReview.deliveryPreview, {
    campaignId: campaignId as Id<"qaVisualCampaigns">,
  });
  const cancelled = dashboard?.cancelled ?? 0;
  const finished = (dashboard?.completed ?? 0) + failed + cancelled;
  const hasPreviousAnalysis = Boolean(
    dashboard?.reviews.some(
      (row) =>
        row &&
        (row.status === "completed" ||
          row.status === "stale" ||
          row.status === "failed" ||
          ("resultId" in row && row.resultId)),
    ),
  );
  // Pieces without a current result (never analyzed, outdated, failed or stopped).
  const pendingCount = dashboard
    ? pieces.filter((p) => {
        const row = dashboard.reviews.find((r) => r?.name === p.filename);
        return (
          !row ||
          ["pending", "stale", "failed", "cancelled"].includes(row.status)
        );
      }).length
    : undefined;
  const analyze = (scope: "pending" | "all" | "retry") =>
    scope === "retry"
      ? void agent.launch(
          "retry",
          dashboard?.failedNames,
          dashboard?.failedPieceIds,
        )
      : void agent.launch("batch", undefined, undefined, scope);
  const reanalyzePiece = piece.pieceId
    ? () => void agent.launch("piece", [piece.filename], [piece.pieceId!])
    : undefined;
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
        onAnalyze={agent.available ? analyze : undefined}
        view={view}
        onViewChange={changeView}
        onSendToClient={() => setSending(true)}
        sendCount={deliveryPreview?.eligible.length}
        pendingCount={pendingCount}
        failedCount={dashboard?.failedPieceIds.length ?? 0}
        totalCount={pieces.length}
        hasPreviousAnalysis={hasPreviousAnalysis}
      />
      {dashboard?.total || phase || agent.error || agent.notice ? (
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
            {agent.notice && !agent.error && (
              <div className="qa-analysis-detail">{agent.notice}</div>
            )}
            {!!cancelled && (
              <div className="qa-analysis-detail">
                {cancelled}{" "}
                {cancelled === 1 ? "pieza detenida" : "piezas detenidas"} antes
                de empezar
              </div>
            )}
          </div>
          {dashboard?.active && (
            <div className="qa-analysis-actions">
              <button
                className="button secondary"
                disabled={dashboard.cancelling}
                onClick={() => void agent.cancel()}
              >
                <Square size={13} />
                {dashboard.cancelling ? "Deteniendo…" : "Detener"}
              </button>
            </div>
          )}
          {agent.available && !!dashboard?.failedNames.length && (
            <div className="qa-analysis-actions">
              <button
                className="button secondary"
                disabled={agent.busy}
                onClick={() =>
                  void agent.launch(
                    "retry",
                    dashboard.failedNames,
                    dashboard.failedPieceIds,
                  )
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
      {view === "gallery" ? (
        <InternalGallery
          session={session}
          onOpen={(id) => {
            session.choosePiece(id);
            setCarousel(true);
          }}
          selected={selection}
          onToggle={(versionId) =>
            setSelection((prev) => {
              const next = new Set(prev);
              if (next.has(versionId)) next.delete(versionId);
              else next.add(versionId);
              return next;
            })
          }
          onClearSelection={() => setSelection(new Set())}
          onSend={() => setSending(true)}
        />
      ) : (
        <section
          aria-label="Revisión visual"
          className={`review-layout ${!leftOpen ? "hide-left" : ""} ${!rightOpen ? "hide-right" : ""}`}
        >
          {leftOpen && <FilesPanel session={session} />}
          <section className="viewer" aria-label="Visor de pieza">
            <ViewerToolbar
              session={session}
              onReanalyze={agent.available ? reanalyzePiece : undefined}
              reanalyzing={Boolean(
                row &&
                ["queued", "preparing", "analyzing", "retrying"].includes(
                  row.status,
                ),
              )}
            />
            <ReviewCanvas session={session} />
          </section>
          {rightOpen && (
            <PiecePanel
              session={session}
              findings={session.detail?.review?.findings}
            />
          )}
        </section>
      )}
      {carousel && (
        <InternalCarousel
          session={session}
          onClose={() => setCarousel(false)}
          onOpenDetailed={() => {
            setCarousel(false);
            changeView("review");
          }}
          onReanalyze={agent.available ? reanalyzePiece : undefined}
          reanalyzing={Boolean(
            row &&
            ["queued", "preparing", "analyzing", "retrying"].includes(
              row.status,
            ),
          )}
        />
      )}
      {sending && (
        <SendToClientDialog
          campaignId={campaignId as Id<"qaVisualCampaigns">}
          preselected={[...selection]}
          onClose={() => setSending(false)}
          onSent={(message) => {
            setSelection(new Set());
            session.setToast(message);
          }}
        />
      )}
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
