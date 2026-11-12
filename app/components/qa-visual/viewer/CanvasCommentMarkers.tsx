import { Sparkles } from "lucide-react";
import type { Comment } from "@/app/lib/qa-visual/review-model";

export function CanvasCommentMarkers({
  comments, selected, visible, onSelect,
}: {
  comments: readonly Comment[];
  selected: Comment["id"] | null;
  visible: boolean;
  onSelect: (id: Comment["id"]) => void;
}) {
  if (!visible) return null;
  const open = comments.filter((comment) => !comment.resolved);
  const general = open.filter((comment) => !comment.pin && comment.marker !== undefined);
  const located = open.filter((comment) => comment.pin);
  const region = open.find((comment) => comment.id === selected)?.region;

  return (
    <>
      {general.length > 0 && (
        <div className="canvas-general-comments" role="group" aria-label="Comentarios generales de la imagen">
          {general.map((comment) => (
            <button
              key={comment.id}
              className={`image-pin agent ${selected === comment.id ? "selected" : ""}`}
              aria-label={`Abrir comentario general ${comment.marker}`}
              aria-pressed={selected === comment.id}
              onClick={() => onSelect(comment.id)}
            >
              <Sparkles size={12} />
              {comment.marker}
            </button>
          ))}
          <span className="canvas-general-label" aria-hidden="true">Comentarios generales</span>
        </div>
      )}
      {located.map((comment) => (
        <button
          key={comment.id}
          className={`image-pin ${comment.kind} ${selected === comment.id ? "selected" : ""}`}
          style={{ left: `${comment.pin!.x}%`, top: `${comment.pin!.y}%` }}
          title={`Comentario ${comment.marker ?? comment.id} · ${comment.author}`}
          aria-label={`Abrir comentario ${comment.marker ?? comment.id} en la imagen`}
          aria-pressed={selected === comment.id}
          onClick={() => onSelect(comment.id)}
        >
          {comment.kind === "agent" && <Sparkles size={12} />}
          {comment.marker ?? comment.id}
        </button>
      ))}
      {region && (
        <div
          className="selected-region"
          style={{
            left: `${region.x}%`, top: `${region.y}%`,
            width: `${region.width}%`, height: `${region.height}%`, right: "auto",
          }}
        />
      )}
    </>
  );
}
