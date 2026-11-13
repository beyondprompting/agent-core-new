import {
  ArrowDownToLine,
  MessageSquare,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  RotateCcw,
  Square,
} from "lucide-react";

import { ReviewStatusBar } from "@/app/components/qa-visual/piece/review-status";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ViewerToolbar({
  session: {
    version,
    setPendingPin,
    tool,
    setTool,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    setModal,
    cancelImageComment,
    pendingMark,
    pinToolRef,
    piece,
    aiReview,
    humanReview,
    changeVersion,
    openAiReview,
    download,
  },
  onReanalyze,
  reanalyzing,
}: {
  session: ReviewSession;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}) {
  return (
    <>
      {/* Viewer bar (design scene 3): panels, annotation tools, version and file, download.
          Zoom lives in a floating pill over the image (ReviewCanvas). */}
      <div className="viewer-toolbar viewer-unified">
        <button
          className={`icon-button panel-toggle ${leftOpen ? "" : "off"}`}
          title={leftOpen ? "Ocultar archivos" : "Mostrar archivos"}
          aria-label={leftOpen ? "Ocultar archivos" : "Mostrar archivos"}
          aria-pressed={leftOpen}
          onClick={() => setLeftOpen(!leftOpen)}
        >
          <PanelLeftClose size={16} />
        </button>
        <div className="annotation-tools" role="toolbar" aria-label="Herramientas de anotación">
          {(
            [
              { id: "select", label: "Seleccionar", icon: MousePointer2 },
              { id: "pin", label: "Comentar en un punto", icon: MessageSquare },
              { id: "rectangle", label: "Marcar un área", icon: Square },
              { id: "draw", label: "Dibujo libre", icon: Pencil },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              ref={item.id === "pin" ? pinToolRef : undefined}
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.id}
              className={`tool-button ${tool === item.id ? "active" : ""}`}
              onClick={() => {
                setTool(item.id);
                if (item.id !== "pin") setPendingPin(null);
              }}
            >
              <item.icon size={15} />
            </button>
          ))}
          {pendingMark && (
            <button
              className="tool-button"
              title="Descartar la marca sin publicar"
              aria-label="Descartar la marca sin publicar"
              onClick={cancelImageComment}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
        <div className="viewer-file">
          {piece.versions > 1 ? (
            <select
              aria-label="Versión de la pieza"
              className="viewer-version"
              value={version}
              onChange={(e) => changeVersion(Number(e.target.value))}
            >
              {Array.from({ length: piece.versions }, (_, i) => (
                <option key={i} value={i + 1}>
                  v{i + 1}
                </option>
              ))}
            </select>
          ) : (
            <span className="viewer-version single">v{version}</span>
          )}
          <span className="viewer-filename" title={piece.filename}>
            {piece.filename}
          </span>
        </div>
        <button
          className="icon-button"
          title="Descargar original"
          aria-label="Descargar original de esta pieza"
          onClick={download}
        >
          <ArrowDownToLine size={16} />
        </button>
        <button
          className={`icon-button panel-toggle ${rightOpen ? "" : "off"}`}
          title={rightOpen ? "Ocultar comentarios" : "Mostrar comentarios"}
          aria-label={rightOpen ? "Ocultar comentarios" : "Mostrar comentarios"}
          aria-pressed={rightOpen}
          onClick={() => setRightOpen(!rightOpen)}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      <ReviewStatusBar
        ai={aiReview}
        human={humanReview}
        pieceName={piece.name}
        version={version}
        onOpenAi={openAiReview}
        onOpenHuman={() => setModal("approval")}
        onReanalyze={onReanalyze}
        reanalyzing={reanalyzing}
        client={piece.client}
      />
    </>
  );
}
