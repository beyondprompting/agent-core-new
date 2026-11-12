import { useEffect, useRef } from "react";

/**
 * Carousel navigation (§23.9): ← → move, Esc closes and C opens the composer.
 * Shortcuts never act while typing, inside dialogs or with modifier keys.
 */
export function useCarouselKeys({
  enabled,
  onPrev,
  onNext,
  onClose,
  onComment,
}: {
  enabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onComment?: () => void;
}) {
  const handlers = useRef({ onPrev, onNext, onClose, onComment });
  handlers.current = { onPrev, onNext, onClose, onComment };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest('input, textarea, select, [role="dialog"]:not(.qa-carousel), [role="menu"]')
      )
        return;
      const h = handlers.current;
      if (event.key === "ArrowLeft") h.onPrev();
      else if (event.key === "ArrowRight") h.onNext();
      else if (event.key === "Escape") h.onClose();
      else if ((event.key === "c" || event.key === "C") && h.onComment) h.onComment();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Horizontal swipe on touch screens. */
export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: React.PointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onPrev();
      else onNext();
    },
  };
}
