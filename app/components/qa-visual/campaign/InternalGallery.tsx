import { useState } from "react";
import { BadgeCheck, Bot, Building2, Check, CheckCheck, Search, Send, ShieldCheck, X } from "lucide-react";
import { BulkApproveDialog } from "./BulkApproveDialog";
import type { Piece } from "@/app/lib/qa-visual/review-model";
import { GalleryGrid, type GalleryItem } from "@/app/components/qa-visual/gallery/GalleryGrid";
import { PieceFilterMenu } from "@/app/components/qa-visual/gallery/PieceFilterMenu";
import { clientFilterState, hasFinalApproval, needsAttention } from "@/app/lib/qa-visual/piece-filters";
import { getAiReviewState, getHumanReviewState } from "@/app/lib/qa-visual/review-state";
import { humanStateWithClient, internalClientState, needsNewVersion, previewSrc } from "@/app/lib/qa-visual/client-state";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

/** Internal gallery (§23.9, scene 6): every piece with its AI, internal and client state. */
export function InternalGallery({
  session,
  campaignId,
  onOpen,
  selected,
  onToggle,
  onSelectionChange,
  onClearSelection,
  onSend,
}: {
  session: ReviewSession;
  campaignId: string;
  onOpen: (id: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (versionId: string) => void;
  onSelectionChange: (next: Set<string>) => void;
  onClearSelection: () => void;
  onSend?: () => void;
}) {
  const { pieces, filteredPieces, results, statuses, query, setQuery, filters, setFilters } = session;
  const finalCount = pieces.filter((p) => hasFinalApproval(p.client)).length;
  const [approving, setApproving] = useState(false);
  // What each selected piece allows: team approval or sending to the client (same rules as the server).
  const actions = (p: Piece) => {
    const version = p.currentVersion ?? 1;
    const humanStatus = statuses[`${p.id}-${version}`] ?? p.status;
    const aiStatus = results[p.id]?.[version];
    const clientState = clientFilterState(p.client);
    const rejected = needsNewVersion(p.client);
    return {
      canApprove: humanStatus !== "Aprobada" && !rejected,
      canSend:
        humanStatus === "Aprobada" &&
        !rejected &&
        clientState !== "sent" &&
        !(hasFinalApproval(p.client) && aiStatus === "validated"),
      aiValidated: aiStatus === "validated",
    };
  };
  const chosen = pieces.filter((p) => p.pieceVersionId && selected.has(p.pieceVersionId));
  const toApprove = chosen.filter((p) => actions(p).canApprove);
  const toSend = chosen.filter((p) => actions(p).canSend);
  const visibleSelectable = filteredPieces
    .filter((p) => p.pieceVersionId && (actions(p).canApprove || actions(p).canSend))
    .map((p) => p.pieceVersionId!);
  const allVisibleSelected =
    visibleSelectable.length > 0 && visibleSelectable.every((id) => selected.has(id));
  return (
    <section className="qa-gallery-view" aria-label="Galería de piezas">
      <div className="qa-gallery-toolbar">
        <div className="qa-gallery-filters">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="Buscar piezas"
              placeholder="Buscar pieza, producto o canal"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Limpiar búsqueda" onClick={() => setQuery("")}>
                <X size={12} />
              </button>
            )}
          </div>
          <PieceFilterMenu filters={filters} onChange={setFilters} />
        </div>
        <div className="qa-gallery-meta">
          <span className="qa-gallery-count">
            <b>
              {filteredPieces.length === pieces.length
                ? `${pieces.length} piezas`
                : `${filteredPieces.length} de ${pieces.length} piezas`}
            </b>
            <span className="qa-final-count" title="Aprobadas por el cliente en su versión actual">
              <BadgeCheck size={12} /> {finalCount} con aprobación final
            </span>
          </span>
          {visibleSelectable.length > 0 && (
            <button
              type="button"
              className={`qa-select-all ${allVisibleSelected ? "on" : ""}`}
              aria-pressed={allVisibleSelected}
              onClick={() => {
                const next = new Set(selected);
                for (const id of visibleSelectable)
                  if (allVisibleSelected) next.delete(id);
                  else next.add(id);
                onSelectionChange(next);
              }}
            >
              <span className="qa-select-box" aria-hidden>
                {allVisibleSelected && <Check size={11} strokeWidth={3} />}
              </span>
              {allVisibleSelected ? "Quitar selección" : `Seleccionar ${visibleSelectable.length} visibles`}
            </button>
          )}
        </div>
      </div>
      <GalleryGrid
        onOpen={onOpen}
        // Selection is kept per version so it survives filters and re-imports.
        onToggle={(id) => {
          const versionId = filteredPieces.find((p) => p.id === id)?.pieceVersionId;
          if (versionId) onToggle(versionId);
        }}
        empty={
          <>
            <Search size={24} />
            <p>No hay piezas con estos filtros.</p>
          </>
        }
        items={filteredPieces.map((p) => {
          const version = p.currentVersion ?? 1;
          const aiStatus = results[p.id]?.[version];
          const ai = getAiReviewState(aiStatus, []);
          const humanStatus = statuses[`${p.id}-${version}`] ?? p.status;
          const human = humanStateWithClient(getHumanReviewState(humanStatus), p.client, version);
          const client = internalClientState(p.client);
          const versionId = p.pieceVersionId;
          const final = hasFinalApproval(p.client);
          const clientState = clientFilterState(p.client);
          const accent: GalleryItem["accent"] = final
            ? "success"
            : clientState === "changesRequested" || humanStatus === "Cambios solicitados"
              ? "danger"
              : needsAttention({ ai: aiStatus, human: humanStatus, client: p.client })
                ? "warning"
                : undefined;
          // Internal approval is a step; the client's approval of the current version closes the piece.
          const flag = needsNewVersion(p.client) ? (
            <span className="qa-flag warning">Falta versión nueva</span>
          ) : humanStatus !== "Aprobada" || final ? undefined : clientState === "none" || clientState === "outdated" ? (
              <span className="qa-flag info">Lista para enviar</span>
            ) : clientState === "sent" ? (
              <span className="qa-flag client">Esperando al cliente</span>
            ) : undefined;
          return {
            id: p.id,
            title: p.name,
            meta: `${p.format} · v${version}${p.client ? ` · V${p.client.clientVersion} cliente` : ""}`,
            src: previewSrc(p.thumbnail) ?? p.image,
            width: p.width,
            height: p.height,
            unavailable: p.imageError,
            // Selectable to approve it (team) or to send it to the client.
            selectable: Boolean(versionId) && (actions(p).canApprove || actions(p).canSend),
            selected: Boolean(versionId && selected.has(versionId)),
            accent,
            // Outside the image so it never wraps over narrow (portrait) artwork.
            flags: final ? (
              <span className="qa-final-stamp" title={client.detail}>
                <BadgeCheck size={12} /> Aprobación final
              </span>
            ) : (
              flag
            ),
            footer: (
              <span className="qa-tri">
                <span className={`qa-chip tone-${ai.tone}`} title={`IA · ${ai.title}`}>
                  <Bot size={11} />
                  {ai.shortLabel}
                </span>
                <span className={`qa-chip tone-${human.tone}`} title={`Interna · ${human.title}`}>
                  <ShieldCheck size={11} />
                  {human.shortLabel}
                </span>
                <span className={`qa-chip tone-${client.tone}`} title={`Cliente · ${client.label}`}>
                  <Building2 size={11} />
                  {client.short}
                </span>
              </span>
            ),
          };
        })}
      />
      {chosen.length > 0 && (
        <div className="qa-action-bar" role="toolbar" aria-label="Acciones sobre las piezas seleccionadas">
          <span className="qa-action-count">
            <b>{chosen.length}</b> {chosen.length === 1 ? "seleccionada" : "seleccionadas"}
          </span>
          <span className="qa-action-divider" />
          <button
            className="button primary"
            disabled={!toApprove.length}
            title={toApprove.length ? undefined : "Ninguna seleccionada espera la aprobación del equipo"}
            onClick={() => setApproving(true)}
          >
            <CheckCheck size={14} /> Aprobar{toApprove.length ? ` ${toApprove.length}` : ""}
          </button>
          {onSend && (
            <button
              className="button secondary qa-send-client"
              disabled={!toSend.length}
              title={toSend.length ? undefined : "Ninguna seleccionada está lista para enviar"}
              onClick={onSend}
            >
              <Send size={14} /> Enviar al cliente{toSend.length ? ` ${toSend.length}` : ""}
            </button>
          )}
          <button className="qa-action-clear" aria-label="Quitar selección" title="Quitar selección" onClick={onClearSelection}>
            <X size={15} />
          </button>
        </div>
      )}
      {approving && (
        <BulkApproveDialog
          campaignId={campaignId}
          items={toApprove.map((p) => ({
            pieceVersionId: p.pieceVersionId!,
            title: p.name,
            version: p.currentVersion ?? 1,
            aiValidated: actions(p).aiValidated,
          }))}
          onClose={() => setApproving(false)}
          // Approved pieces stay selected: the next step is usually sending them to the client.
          onDone={(_approvedIds, message) => session.setToast(message)}
        />
      )}
    </section>
  );
}
