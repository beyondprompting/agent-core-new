import { useState } from "react";
import {
  CircleHelp,
  ImageIcon,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Artwork } from "@/app/components/qa-visual/shared/visuals";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function ReviewCanvas({
  session: {
    version,
    selected,
    filter,
    pendingPin,
    zoom,
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
  const region = pieceComments.find(
    (c) => c.id === selected && !c.resolved,
  )?.region;
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
            className={`artboard ${piece.height > piece.width ? "portrait" : ""} tool-${tool}`}
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
            {showPins &&
              pieceComments
                .filter((c) => c.pin && !c.resolved)
                .map((c) => (
                  <button
                    key={c.marker ?? c.id}
                    className={`image-pin ${c.kind} ${selected === c.id ? "selected" : ""}`}
                    style={{
                      left: `${c.pin!.x}%`,
                      top: `${c.pin!.y}%`,
                    }}
                    title={`Comentario ${c.id}: ${c.author}`}
                    onClick={() => selectComment(c.id)}
                  >
                    {c.kind === "agent" ? <Sparkles size={12} /> : null}
                    {c.marker ?? c.id}
                  </button>
                ))}
            {showPins && region && (
              <div
                className="selected-region"
                style={{
                  left: `${region.x}%`,
                  top: `${region.y}%`,
                  width: `${region.width}%`,
                  height: `${region.height}%`,
                  right: "auto",
                }}
              />
            )}
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
            <span>·</span>Original recibido
          </span>
          <span>
            <ShieldCheck size={13} />
            Versión {version} de {piece.versions}
          </span>
        </div>
      </div>
      <div className="viewer-footer">
        <span>
          <span className="live-dot" />
          Cambios de esta sesión
        </span>
        <button onClick={() => setModal("help")}>
          <CircleHelp size={13} />
          Ayuda de revisión
        </button>
      </div>
    </>
  );
}
