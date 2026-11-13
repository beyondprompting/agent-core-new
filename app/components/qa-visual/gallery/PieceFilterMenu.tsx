"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ListFilter, X } from "lucide-react";
import {
  FILTER_GROUPS,
  QUICK_FILTERS,
  toggleFilter,
  type PieceFilterKey,
  type PieceFilters,
} from "@/app/lib/qa-visual/piece-filters";

/** Checkbox filters: quick toggles inline and every state in a popover (OR per group, AND across groups). */
export function PieceFilterMenu({
  filters,
  onChange,
  quick = true,
  align = "left",
}: {
  filters: PieceFilters;
  onChange: (filters: PieceFilterKey[]) => void;
  quick?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState({ maxHeight: 520, above: false });
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const trigger = ref.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const workspace = trigger.closest(".workspace")?.getBoundingClientRect();
      const top = Math.max(0, workspace?.top ?? 0);
      const bottom = Math.min(window.innerHeight, workspace?.bottom ?? window.innerHeight);
      // Leave 6px below the trigger and 12px before the workspace/viewport edge.
      const below = bottom - rect.bottom - 18;
      const above = rect.top - top - 18;
      const opensAbove = below < 240 && above > below;
      const maxHeight = Math.max(0, Math.min(520, opensAbove ? above : below));
      setMenuLayout((previous) =>
        previous.maxHeight === maxHeight && previous.above === opensAbove
          ? previous
          : { maxHeight, above: opensAbove },
      );
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, filters.length]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const quickKeys = new Set(QUICK_FILTERS.map((f) => f.key));
  const detailed = filters.filter((f) => !quickKeys.has(f)).length;
  const check = (key: PieceFilterKey, label: string, title?: string) => (
    <label key={key} className={`qa-filter-check ${filters.includes(key) ? "on" : ""}`} title={title}>
      <input
        type="checkbox"
        checked={filters.includes(key)}
        onChange={() => onChange(toggleFilter(filters, key))}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="qa-filters">
      {quick && QUICK_FILTERS.map((f) => check(f.key, f.label, f.hint))}
      <div className="qa-filter-menu" ref={ref}>
        <button
          type="button"
          className={`qa-filter-button ${detailed ? "on" : ""}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
        >
          <ListFilter size={14} />
          Estados
          {detailed > 0 && <span className="qa-filter-count">{detailed}</span>}
          <ChevronDown size={13} />
        </button>
        {open && (
          <div
            className={`qa-filter-popover ${align}${menuLayout.above ? " above" : ""}`}
            style={{ maxHeight: menuLayout.maxHeight }}
            role="dialog"
            aria-label="Filtrar por estado"
          >
            {!quick && (
              <fieldset>
                <legend>Rápidos</legend>
                {QUICK_FILTERS.map((f) => check(f.key, f.label, f.hint))}
              </fieldset>
            )}
            {FILTER_GROUPS.map((group) => (
              <fieldset key={group.label}>
                <legend>{group.label}</legend>
                {group.options.map((o) => check(o.key, o.label))}
              </fieldset>
            ))}
            <p className="qa-filter-help">
              Dentro de un grupo se suman las opciones; entre grupos se combinan.
            </p>
          </div>
        )}
      </div>
      {filters.length > 0 && (
        <button type="button" className="qa-filter-clear" onClick={() => onChange([])}>
          <X size={12} /> Limpiar filtros
        </button>
      )}
    </div>
  );
}
