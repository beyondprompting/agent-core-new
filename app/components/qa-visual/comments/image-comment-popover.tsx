"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { CornerDownLeft, MapPin, Send, X } from "lucide-react";
import { getCommentPosition } from "@/app/lib/qa-visual/comment-position";
import { Avatar } from "@/app/components/qa-visual/shared/visuals";

export default function ImageCommentPopover({
  anchor,
  point,
  pieceName,
  reviewer,
  layoutKey,
  onPublish,
  onCancel,
  busy = false,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  point: { x: number; y: number };
  pieceName: string;
  reviewer: string;
  layoutKey: string;
  busy?: boolean;
  onPublish: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [position, setPosition] = useState<ReturnType<
    typeof getCommentPosition
  > | null>(null);
  const card = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textarea.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const bounds = card.current?.getBoundingClientRect();
      if (!rect || !bounds) return;
      setPosition(
        getCommentPosition({
          pinX: rect.left + (rect.width * point.x) / 100,
          pinY: rect.top + (rect.height * point.y) / 100,
          cardWidth: bounds.width,
          cardHeight: bounds.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, point.x, point.y, layoutKey]);

  const submit = () => {
    if (text.trim() && !busy) onPublish(text.trim());
  };

  return (
    <form
      ref={card}
      className={`image-comment-popover popover-${position?.side ?? "right"}`}
      style={{
        left: position?.left ?? 12,
        top: position?.top ?? 12,
        visibility: position ? "visible" : "hidden",
      }}
      role="dialog"
      aria-labelledby="image-comment-title"
      aria-describedby="image-comment-context"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {position?.showArrow && (
        <span
          className="popover-arrow"
          style={{ top: position.arrowTop }}
          aria-hidden="true"
        />
      )}
      <div className="popover-heading">
        <Avatar type="you" name={reviewer} />
        <div>
          <strong id="image-comment-title">Nuevo comentario</strong>
          <span>{reviewer}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Cancelar comentario"
          aria-label="Cancelar comentario en la imagen"
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>
      <div className="popover-location" id="image-comment-context">
        <MapPin size={12} />
        <span>{pieceName}</span>
        <span className="location-dot" />
        Zona marcada
      </div>
      <label className="sr-only" htmlFor="image-comment-text">
        Comentario sobre esta zona de la imagen
      </label>
      <textarea
        id="image-comment-text"
        ref={textarea}
        placeholder="¿Qué quieres señalar en esta zona?"
        value={text}
        maxLength={4000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="popover-bottom">
        <span>
          <CornerDownLeft size={11} />
          Ctrl / ⌘ + Enter
        </span>
        <button type="button" className="popover-cancel" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={!text.trim() || busy}
        >
          Publicar
          <Send size={13} />
        </button>
      </div>
    </form>
  );
}
