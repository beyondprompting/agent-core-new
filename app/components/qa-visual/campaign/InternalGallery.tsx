import { BadgeCheck, Bot, Building2, Search, ShieldCheck, X } from "lucide-react";
import { GalleryGrid, type GalleryItem } from "@/app/components/qa-visual/gallery/GalleryGrid";
import { PieceFilterMenu } from "@/app/components/qa-visual/gallery/PieceFilterMenu";
import { clientFilterState, hasFinalApproval, needsAttention } from "@/app/lib/qa-visual/piece-filters";
import { getAiReviewState, getHumanReviewState } from "@/app/lib/qa-visual/review-state";
import { internalClientState, previewSrc } from "@/app/lib/qa-visual/client-state";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

/** Internal gallery (§23.9, scene 6): every piece with its AI, internal and client state. */
export function InternalGallery({
  session,
  onOpen,
  selected,
  onToggle,
  onClearSelection,
  onSend,
}: {
  session: ReviewSession;
  onOpen: (id: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (versionId: string) => void;
  onClearSelection: () => void;
  onSend?: () => void;
}) {
  const { pieces, filteredPieces, results, statuses, query, setQuery, filters, setFilters } = session;
  const finalCount = pieces.filter((p) => hasFinalApproval(p.client)).length;
  return (
    <section className="qa-gallery-view" aria-label="Galería de piezas">
      <div className="qa-gallery-toolbar">
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
        <span className="qa-gallery-count">
          {filteredPieces.length === pieces.length
            ? `${pieces.length} piezas`
            : `${filteredPieces.length} de ${pieces.length} piezas`}
          {" · "}
          <span className="qa-final-count" title="Aprobadas por el cliente en su versión actual">
            <BadgeCheck size={12} /> {finalCount} con aprobación final
          </span>
        </span>
        <span className="qa-grow" />
        {selected.size > 0 && (
          <div className="qa-selection-bar">
            {selected.size} {selected.size === 1 ? "seleccionada" : "seleccionadas"}
            {onSend && (
              <button className="button secondary qa-send-client" onClick={onSend}>
                Enviar al cliente
              </button>
            )}
            <button className="icon-button" aria-label="Quitar selección" onClick={onClearSelection}>
              <X size={14} />
            </button>
          </div>
        )}
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
          const human = getHumanReviewState(humanStatus);
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
          const flag =
            humanStatus !== "Aprobada" || final ? undefined : clientState === "none" || clientState === "outdated" ? (
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
            selectable: Boolean(versionId) && humanStatus === "Aprobada",
            selected: Boolean(versionId && selected.has(versionId)),
            accent,
            flags: flag,
            badge: final ? (
              <span className="qa-final-stamp" title={client.detail}>
                <BadgeCheck size={13} /> Aprobación final
              </span>
            ) : undefined,
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
    </section>
  );
}
