"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCarouselKeys, useSwipe } from "@/app/hooks/qa-visual/use-carousel-keys";

/**
 * Full-screen carousel (§23.9) shared by internal reviewers and the client. Desktop shows a side
 * panel; small screens turn the panel into a bottom sheet. There is no thumbnail strip.
 * The sheet can be minimized (tap or drag its handle) to see the piece larger; children marked
 * with `qa-sheet-peek` stay visible while minimized.
 */
export function CarouselShell({
  title,
  subtitle,
  position,
  total,
  onPrev,
  onNext,
  onClose,
  onComment,
  toolbar,
  stage,
  panel,
  closeLabel = "Cerrar carrusel",
  closeIcon,
  panelClassName,
  forcePanelOpen = false,
}: {
  title: string;
  subtitle?: string;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onComment?: () => void;
  toolbar?: ReactNode;
  stage: ReactNode;
  panel: ReactNode;
  closeLabel?: string;
  closeIcon?: ReactNode;
  panelClassName?: string;
  /** Keeps the bottom sheet open, e.g. while a comment is being placed. */
  forcePanelOpen?: boolean;
}) {
  const [minimized, setMinimized] = useState(false);
  const collapsed = minimized && !forcePanelOpen;
  const dragStart = useRef<number | null>(null);
  useCarouselKeys({ enabled: true, onPrev, onNext, onClose, onComment });
  const swipe = useSwipe(onPrev, onNext);
  const dots = Math.min(total, 9);
  const active = total <= 9 ? position : Math.round((position / Math.max(1, total - 1)) * (dots - 1));
  return (
    <div className="qa-carousel" role="dialog" aria-modal="true" aria-label={`${title}, ${position + 1} de ${total}`}>
      <section className="qa-carousel-stage">
        <header className="qa-carousel-top">
          <button className="qa-carousel-icon" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            {closeIcon ?? <X size={18} />}
          </button>
          <div className="qa-carousel-title">
            <b>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <span className="qa-carousel-count">
            {position + 1} de {total}
          </span>
          {toolbar}
        </header>
        <div className="qa-carousel-main" {...swipe}>
          <button className="qa-carousel-nav prev" onClick={onPrev} disabled={total < 2} aria-label="Pieza anterior">
            <ChevronLeft size={22} />
          </button>
          {stage}
          <button className="qa-carousel-nav next" onClick={onNext} disabled={total < 2} aria-label="Pieza siguiente">
            <ChevronRight size={22} />
          </button>
        </div>
        <footer className="qa-carousel-foot">
          <span className="qa-dots" aria-hidden="true">
            {Array.from({ length: dots }, (_, i) => (
              <i key={i} className={i === active ? "on" : ""} />
            ))}
          </span>
          <span className="qa-carousel-keys">
            <kbd>←</kbd>
            <kbd>→</kbd> navegar{onComment && (<> · <kbd>C</kbd> comentar</>)} · <kbd>Esc</kbd> cerrar
          </span>
        </footer>
      </section>
      <aside className={`qa-carousel-panel ${collapsed ? "collapsed" : ""} ${panelClassName ?? ""}`}>
        {/* Bottom-sheet handle (small screens only): tap to toggle, drag down to minimize or up to open. */}
        <button
          type="button"
          className="qa-sheet-grip"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Ver detalle" : "Minimizar panel"}
          title={collapsed ? "Ver detalle" : "Minimizar panel"}
          onPointerDown={(e) => {
            dragStart.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragStart.current = null;
          }}
          onPointerUp={(e) => {
            if (dragStart.current === null) return;
            const dy = e.clientY - dragStart.current;
            dragStart.current = null;
            if (dy > 24) setMinimized(true);
            else if (dy < -24) setMinimized(false);
            else setMinimized(!collapsed);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setMinimized(!collapsed);
            }
          }}
          onClick={(e) => e.preventDefault()}
        >
          <span aria-hidden />
        </button>
        {panel}
      </aside>
    </div>
  );
}
