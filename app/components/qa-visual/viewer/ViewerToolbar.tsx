import {
  ArrowDownToLine,
  ChevronDown,
  Expand,
  Eye,
  FileImage,
  Hand,
  MessageSquare,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  RotateCcw,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { ReviewStatusBar } from "@/app/components/qa-visual/piece/review-status";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ViewerToolbar({
  session: {
    version,
    filter,
    setPendingPin,
    zoom,
    setZoom,
    tool,
    setTool,
    showPins,
    setShowPins,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    setModal,
    cancelImageComment,
    pendingMark,
    setPan,
    pinToolRef,
    piece,
    aiReview,
    humanReview,
    pieceMarks,
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
      <div className="viewer-filebar">
        <div>
          <button
            className="icon-button"
            title={leftOpen ? "Ocultar archivos" : "Mostrar archivos"}
            onClick={() => setLeftOpen(!leftOpen)}
          >
            <PanelLeftClose size={17} />
          </button>
          <FileImage size={15} />
          <span title={piece.filename}>{piece.filename}</span>
          <select
            aria-label="Versión de la pieza"
            value={version}
            onChange={(e) => changeVersion(Number(e.target.value))}
          >
            {Array.from({ length: piece.versions }, (_, i) => (
              <option key={i} value={i + 1}>
                V{i + 1}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button
            className="icon-button"
            title="Descargar original de esta pieza"
            onClick={download}
          >
            <ArrowDownToLine size={16} />
          </button>
          <button
            className="icon-button"
            title={rightOpen ? "Ocultar comentarios" : "Mostrar comentarios"}
            onClick={() => setRightOpen(!rightOpen)}
          >
            <PanelRightClose size={17} />
          </button>
        </div>
      </div>
      <div className="viewer-toolbar">
        <div className="zoom-tools">
          <button
            className="icon-button"
            title="Alejar"
            onClick={() => setZoom(Math.max(50, zoom - 25))}
          >
            <ZoomOut size={16} />
          </button>
          <button
            className="zoom-value"
            title="Restablecer zoom"
            onClick={() => {
              setZoom(100);
              setPan({ x: 0, y: 0 });
            }}
          >
            {zoom}%<ChevronDown size={12} />
          </button>
          <button
            className="icon-button"
            title="Acercar"
            onClick={() => setZoom(Math.min(200, zoom + 25))}
          >
            <ZoomIn size={16} />
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="annotation-tools">
          {(
            [
              {
                id: "select",
                label: "Seleccionar",
                icon: MousePointer2,
              },
              { id: "hand", label: "Desplazar imagen", icon: Hand },
              {
                id: "pin",
                label: "Agregar comentario en la imagen",
                icon: MessageSquare,
              },
              {
                id: "rectangle",
                label: "Dibujar rectángulo",
                icon: Square,
              },
              {
                id: "draw",
                label: "Dibujar a mano alzada",
                icon: Pencil,
              },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              ref={item.id === "pin" ? pinToolRef : undefined}
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.id}
              className={`icon-button tool-button ${tool === item.id ? "active" : ""}`}
              onClick={() => {
                setTool(item.id);
                if (item.id !== "pin") setPendingPin(null);
              }}
            >
              <item.icon size={17} />
            </button>
          ))}
          <button
            className="icon-button"
            title="Cancelar anotación sin publicar"
            disabled={!pendingMark}
            onClick={cancelImageComment}
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="toolbar-end">
          <button
            className={`pins-toggle ${showPins ? "on" : ""}`}
            onClick={() => setShowPins(!showPins)}
            title="Mostrar u ocultar marcadores"
          >
            <Eye size={15} />
            <span>Marcadores</span>
          </button>
          <button
            className="icon-button"
            title="Ampliar espacio de revisión"
            onClick={() => {
              const expanded = !leftOpen && !rightOpen;
              setLeftOpen(expanded);
              setRightOpen(expanded);
            }}
          >
            <Expand size={16} />
          </button>
        </div>
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
