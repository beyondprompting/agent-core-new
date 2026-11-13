"use client";

import { useEffect, useRef, useState } from "react";
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
  const ref = useRef<HTMLDivElement>(null);
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
          <div className={`qa-filter-popover ${align}`} role="dialog" aria-label="Filtrar por estado">
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
