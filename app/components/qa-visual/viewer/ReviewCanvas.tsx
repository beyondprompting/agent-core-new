import { useState } from "react";
import { CircleHelp, ImageIcon, Plus, ShieldCheck, ZoomIn, ZoomOut } from "lucide-react";

import { Artwork } from "@/app/components/qa-visual/shared/visuals";
import { CanvasCommentMarkers } from "./CanvasCommentMarkers";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ReviewCanvas({
  session: {
    version,
    saving,
    canReview,
    selected,
    filter,
    pendingPin,
    zoom,
    setZoom,
    setPan,
    tool,
    showPins,
    setModal,
    drawing,
    pan,
    artboardRef,
    piece,
    pieceComments,
    pieceMarks,
    selectComment,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  },
}: {
  session: ReviewSession;
}) {
  const [imageSize, setImageSize] = useState<{
    src: string;
    width: number;
    height: number;
  }>();
  const dimensions = imageSize?.src === piece.image ? imageSize : piece;
  const ratio =
    dimensions.width && dimensions.height
      ? dimensions.width / dimensions.height
      : 1;
  return (
    <>
      <div className="canvas-area">
        <div className="canvas-context">
          <span className="canvas-phase">
            <span className="context-dot" /> {piece.phase}
          </span>
          <span className="canvas-specs">
            {piece.platform ?? "Meta"} · {piece.format.split(" · ")[0]} ·{" "}
            {piece.channel}
          </span>
        </div>
        <div className="artboard-area">
          <div
            ref={artboardRef}
            className={`artboard ${piece.height > piece.width ? "portrait" : ""} tool-${tool} ${zoom > 100 ? "zoomed" : ""}`}
            style={{
              aspectRatio: ratio,
              width: `min(100cqw, calc(100cqh * ${ratio}))`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Artwork
              key={piece.image}
              piece={piece}
              eager
              onDimensions={(width, height) =>
                setImageSize({ src: piece.image, width, height })
              }
            />
            <svg
              className="annotation-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {[...pieceMarks, ...(drawing ? [drawing] : [])].map((mark) => {
                const first = mark.points[0],
                  last = mark.points.at(-1)!;
                return mark.type === "rectangle" ? (
                  <rect
                    key={mark.id}
                    x={Math.min(first.x, last.x)}
                    y={Math.min(first.y, last.y)}
                    width={Math.abs(last.x - first.x)}
                    height={Math.abs(last.y - first.y)}
                    fill="rgba(79,70,229,.08)"
                    stroke="#818cf8"
                    strokeWidth=".5"
                  />
                ) : (
                  <polyline
                    key={mark.id}
                    points={mark.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#a5b4fc"
                    strokeWidth=".55"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
            <CanvasCommentMarkers
              comments={pieceComments}
              selected={selected}
              visible={showPins}
              onSelect={(id) => selectComment(id, { highlight: true })}
            />
            {pendingPin && (
              <span
                className="image-pin pending-pin"
                style={{
                  left: `${pendingPin.x}%`,
                  top: `${pendingPin.y}%`,
                }}
              >
                <Plus size={15} />
              </span>
            )}
          </div>
        </div>
        <div className="canvas-caption">
          <span>
            <ImageIcon size={13} />
            {piece.width > 0 && piece.height > 0 && (
              <>
                {piece.width} × {piece.height} px<span>·</span>
              </>
            )}
            {piece.extension ?? "PNG"}
          </span>
          <div className="zoom-pill" role="group" aria-label="Zoom">
            <button
              aria-label="Alejar"
              title="Alejar"
              disabled={zoom <= 50}
              onClick={() => {
                const next = Math.max(50, zoom - 25);
                setZoom(next);
                if (next <= 100) setPan({ x: 0, y: 0 });
              }}
            >
              <ZoomOut size={14} />
            </button>
            <button
              className="zoom-pill-value"
              title="Ajustar a la pantalla"
              aria-label={`Zoom ${zoom} %. Ajustar a la pantalla`}
              onClick={() => {
                setZoom(100);
                setPan({ x: 0, y: 0 });
              }}
            >
              {zoom} %
            </button>
            <button
              aria-label="Acercar"
              title={zoom > 100 ? "Acercar · arrastrá la imagen para moverla" : "Acercar"}
              disabled={zoom >= 200}
              onClick={() => setZoom(Math.min(200, zoom + 25))}
            >
              <ZoomIn size={14} />
            </button>
          </div>
          <span>
            <ShieldCheck size={13} />
            Versión {version} de {piece.versions}
          </span>
        </div>
      </div>
      <div className="viewer-footer">
        <span>
          <span className="live-dot" />
          {saving
            ? "Guardando…"
            : canReview
              ? "Revisión guardada en la campaña"
              : "Cargando revisión…"}
        </span>
        <button onClick={() => setModal("help")}>
          <CircleHelp size={13} />
          Ayuda de revisión
        </button>
      </div>
    </>
  );
}
