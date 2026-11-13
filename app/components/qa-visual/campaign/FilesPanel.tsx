import { useLayoutEffect } from "react";
import {
  ArrowUpRight,
  FileText,
  MessageCircle,
  PanelLeftClose,
  Search,
  X,
} from "lucide-react";

import { Artwork } from "@/app/components/qa-visual/shared/visuals";

import { CompactReviewStatus } from "@/app/components/qa-visual/piece/review-status";
import {
  getAiReviewState,
  getHumanReviewState,
} from "@/app/lib/qa-visual/review-state";
import { CampaignResources } from "./CampaignResources";
import { internalClientState } from "@/app/lib/qa-visual/client-state";
import { hasFinalApproval } from "@/app/lib/qa-visual/piece-filters";
import { PieceFilterMenu } from "@/app/components/qa-visual/gallery/PieceFilterMenu";
import { CampaignSummary } from "./CampaignSummary";
import { usePieceKeyboardNavigation } from "@/app/hooks/qa-visual/use-piece-keyboard-navigation";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function FilesPanel({
  session: {
    pieces,
    inventory,
    activeId,
    leftTab,
    setLeftTab,
    comments,
    query,
    setQuery,
    filters,
    setFilters,
    setLeftOpen,
    statuses,
    results,
    approvals,
    activePieces,
    filteredPieces,
    choosePiece,
    modal,
    pendingPin,
    drawing,
  },
}: {
  session: ReviewSession;
}) {
  const listRef = usePieceKeyboardNavigation({
    enabled: leftTab === "Archivos" && !modal && !pendingPin && !drawing,
    activeId,
    onChoose: choosePiece,
  });
  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !selected) return;
    const viewport = list.getBoundingClientRect();
    const card = selected.getBoundingClientRect();
    // Scroll only the file list, without moving the page or stealing focus.
    if (card.top < viewport.top) list.scrollTop += card.top - viewport.top;
    else if (card.bottom > viewport.bottom)
      list.scrollTop += card.bottom - viewport.bottom;
  }, [activeId, leftTab, query, filters, listRef]);

  return (
    <aside className="files-panel" aria-label="Archivos de campaña">
      <div className="panel-tabs left-tabs">
        {(["Archivos", "Resumen", "Recursos"] as const).map((tab) => (
          <button
            className={leftTab === tab ? "active" : ""}
            onClick={() => setLeftTab(tab)}
            key={tab}
          >
            {tab}
            {tab === "Archivos" && <span>{pieces.length}</span>}
          </button>
        ))}
        <button
          className="files-panel-close"
          aria-label="Ocultar panel de archivos"
          title="Ocultar panel de archivos"
          onClick={() => setLeftOpen(false)}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      {leftTab === "Archivos" ? (
        <>
          <div className="files-controls">
            <div className="search-field">
              <Search size={15} />
              <input
                aria-label="Buscar piezas"
                placeholder="Buscar una pieza…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="file-filter">
              <span>PIEZAS DE LA CAMPAÑA</span>
              <PieceFilterMenu filters={filters} onChange={setFilters} quick={false} />
            </div>
          </div>
          <div
            className="file-list"
            ref={listRef}
            aria-keyshortcuts="ArrowUp ArrowDown"
          >
            {filteredPieces.map((p) => {
              const fileComments = comments.filter(
                (c) =>
                  c.pieceId === p.id && c.version === (p.currentVersion ?? 1),
              );
              const ai = getAiReviewState(
                results[p.id]?.[p.currentVersion ?? 1],
                fileComments,
              );
              const conversationCount =
                (p.threadCount ?? 0) +
                fileComments.filter(
                  (c) => c.kind === "agent" && !c.historical && !c.threadId,
                ).length;
              const decision = approvals
                .slice()
                .reverse()
                .find(
                  (a) =>
                    a.pieceId === p.id &&
                    a.version === (p.currentVersion ?? 1) &&
                    a.status ===
                      (statuses[`${p.id}-${p.currentVersion ?? 1}`] ??
                        p.status),
                );
              const human = getHumanReviewState(
                statuses[`${p.id}-${p.currentVersion ?? 1}`] ?? p.status,
                decision,
              );
              return (
                <button
                  key={p.id}
                  data-piece-id={p.id}
                  aria-current={activeId === p.id ? "true" : undefined}
                  className={`file-card ${activeId === p.id ? "selected" : ""}`}
                  onClick={() => choosePiece(p.id)}
                >
                  <div className="file-thumbnail">
                    <Artwork piece={p} thumbnail />
                    {p.width > 0 && p.height * 9 === p.width * 16 && (
                      <span className="thumbnail-format">9:16</span>
                    )}
                  </div>
                  <div className="file-card-content">
                    <span className="file-phase">{p.phase}</span>
                    <strong title={p.name}>{p.name}</strong>
                    <div className="file-meta-row">
                      <span className="file-format">{p.format}</span>
                      {p.client && (
                        <span
                          className={`qa-client-chip tone-${internalClientState(p.client).tone}`}
                          title={internalClientState(p.client).detail}
                        >
                          {hasFinalApproval(p.client)
                            ? "✓ Aprobación final"
                            : `Cliente · ${internalClientState(p.client).short}`}
                        </span>
                      )}
                      {conversationCount > 0 && (
                        <span
                          className="file-comment-count"
                          title={`${conversationCount} conversaciones`}
                        >
                          <MessageCircle size={11} />
                          {conversationCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <CompactReviewStatus ai={ai} human={human} />
                </button>
              );
            })}
            {!filteredPieces.length && (
              <div className="empty-state">
                <Search size={24} />
                <p>No hay piezas con estos filtros.</p>
                <button
                  onClick={() => {
                    setQuery("");
                    setFilters([]);
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
          <div className="campaign-summary">
            <div>
              <span>Aprobación humana</span>
              <strong>
                {
                  activePieces.filter(
                    (p) =>
                      (statuses[`${p.id}-${p.currentVersion ?? 1}`] ??
                        p.status) === "Aprobada",
                  ).length
                }{" "}
                de {pieces.length} aprobadas
              </strong>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${(activePieces.filter((p) => (statuses[`${p.id}-${p.currentVersion ?? 1}`] ?? p.status) === "Aprobada").length / pieces.length) * 100}%`,
                }}
              />
            </div>
          </div>
        </>
      ) : leftTab === "Resumen" ? (
        <CampaignSummary
          items={activePieces}
          results={results}
          campaignName={inventory.campaignName}
          comments={comments}
          statuses={statuses}
          onSelectPiece={(id) => {
            choosePiece(id);
            setLeftTab("Archivos");
          }}
        />
      ) : (
        <CampaignResources inventory={inventory} />
      )}
      <div className="files-footer">
        <FileText size={14} />
        <span>Recursos de la campaña</span>
        <button
          title="Ver recursos de toda la campaña"
          onClick={() => setLeftTab("Recursos")}
        >
          <ArrowUpRight size={14} />
        </button>
      </div>
    </aside>
  );
}
