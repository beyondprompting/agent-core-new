import type { ReactNode } from "react";
import { Check, ImageIcon } from "lucide-react";

export type GalleryItem = {
  id: string;
  title: string;
  meta: string;
  src?: string;
  width?: number;
  height?: number;
  badge?: ReactNode;
  flags?: ReactNode;
  footer: ReactNode;
  selectable?: boolean;
  selected?: boolean;
  unavailable?: string;
};

/** Grid of pieces in their real proportion (Post 1:1, Story 9:16), shared by the editor and the portal. */
export function GalleryGrid({
  items,
  onOpen,
  onToggle,
  empty,
  compact = false,
}: {
  items: GalleryItem[];
  onOpen: (id: string) => void;
  onToggle?: (id: string) => void;
  empty?: ReactNode;
  compact?: boolean;
}) {
  if (!items.length) return <div className="qa-gallery-empty">{empty}</div>;
  return (
    <ul className={`qa-gallery ${compact ? "compact" : ""}`}>
      {items.map((item) => {
        const portrait = item.width && item.height ? item.height > item.width * 1.15 : false;
        return (
          <li key={item.id} className={`qa-gallery-card ${item.selected ? "selected" : ""}`}>
            {item.selectable && onToggle && (
              <button
                type="button"
                className={`qa-gallery-check ${item.selected ? "on" : ""}`}
                aria-pressed={item.selected}
                aria-label={`${item.selected ? "Quitar" : "Seleccionar"} ${item.title}`}
                onClick={() => onToggle(item.id)}
              >
                {item.selected && <Check size={12} />}
              </button>
            )}
            {item.flags && <span className="qa-gallery-flags">{item.flags}</span>}
            <button
              type="button"
              className="qa-gallery-open"
              onClick={() => onOpen(item.id)}
              aria-label={`Abrir ${item.title}`}
            >
              <span
                className={`qa-gallery-image ${portrait ? "portrait" : ""}`}
                style={
                  item.width && item.height
                    ? { aspectRatio: `${item.width} / ${item.height}` }
                    : undefined
                }
              >
                {item.src ? (
                  <img src={item.src} alt="" loading="lazy" decoding="async" draggable={false} />
                ) : (
                  <span className="qa-gallery-placeholder" title={item.unavailable}>
                    <ImageIcon size={18} />
                    {item.unavailable && <small>{item.unavailable}</small>}
                  </span>
                )}
                {item.badge}
              </span>
              <strong title={item.title}>{item.title}</strong>
              <small>{item.meta}</small>
            </button>
            <div className="qa-gallery-footer">{item.footer}</div>
          </li>
        );
      })}
    </ul>
  );
}
