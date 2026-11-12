import { Bot, Building2, Search, ShieldCheck, X } from "lucide-react";
import { GalleryGrid } from "@/app/components/qa-visual/gallery/GalleryGrid";
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
  const { filteredPieces, results, statuses, query, setQuery, statusFilter, setStatusFilter } = session;
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
        <select
          aria-label="Filtrar piezas por estado"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <optgroup label="Revisión IA">
            <option value="ai:findings">IA · Con hallazgos</option>
            <option value="ai:validated">IA · Validada</option>
            <option value="ai:partial">IA · Incompleta</option>
            <option value="ai:failed">IA · Error</option>
            <option value="ai:stale">IA · Desactualizada</option>
          </optgroup>
          <optgroup label="Aprobación interna">
            <option value="Pendiente">Interna · Pendiente</option>
            <option value="En revisión">Interna · En revisión</option>
            <option value="Cambios solicitados">Interna · Cambios</option>
            <option value="Aprobada">Interna · Aprobada</option>
          </optgroup>
          <optgroup label="Revisión del cliente">
            <option value="client:none">Cliente · Sin enviar</option>
            <option value="client:sent">Cliente · Por revisar</option>
            <option value="client:changesRequested">Cliente · Pidió cambios</option>
            <option value="client:approved">Cliente · Aprobada</option>
          </optgroup>
        </select>
        <span className="qa-gallery-count">{filteredPieces.length} piezas</span>
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
          const ai = getAiReviewState(results[p.id]?.[version], []);
          const humanStatus = statuses[`${p.id}-${version}`] ?? p.status;
          const human = getHumanReviewState(humanStatus);
          const client = internalClientState(p.client);
          const versionId = p.pieceVersionId;
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
            flags:
              p.client?.internalAhead && humanStatus === "Aprobada" ? (
                <span className="qa-flag info">Lista para enviar</span>
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
