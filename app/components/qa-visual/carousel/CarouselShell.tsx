"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCarouselKeys, useSwipe } from "@/app/hooks/qa-visual/use-carousel-keys";

/**
 * Full-screen carousel (§23.9) shared by internal reviewers and the client. Desktop shows a side
 * panel; small screens turn the panel into a bottom sheet. There is no thumbnail strip.
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
}) {
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
      <aside className="qa-carousel-panel">{panel}</aside>
    </div>
  );
}
