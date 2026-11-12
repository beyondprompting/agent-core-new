import { useEffect, useRef } from "react";

export function usePieceKeyboardNavigation({
  enabled,
  activeId,
  onChoose,
}: {
  enabled: boolean;
  activeId: string;
  onChoose: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey ||
          !["ArrowUp", "ArrowDown"].includes(event.key)) return;

      const list = listRef.current;
      const target = event.target;
      if (!list || !(target instanceof HTMLElement)) return;
      if (target.isContentEditable || target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
        '[role="textbox"], [role="dialog"], [role="alertdialog"], [role="menu"], ' +
        '[role="listbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tablist"]',
      )) return;
      // Preserve keyboard behavior on controls outside the piece list.
      if (!list.contains(target) && target.closest('button, a, [role="button"]')) return;

      const cards = Array.from(list.querySelectorAll<HTMLButtonElement>("button[data-piece-id]"));
      if (!cards.length) return;
      const index = cards.findIndex((card) => card.dataset.pieceId === activeId);
      const nextIndex = index < 0
        ? (event.key === "ArrowDown" ? 0 : cards.length - 1)
        : Math.max(0, Math.min(cards.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      const next = cards[nextIndex];
      event.preventDefault();
      if (next.dataset.pieceId !== activeId) onChoose(next.dataset.pieceId!);
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, activeId, onChoose]);

  return listRef;
}
