import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Columns3,
  LayoutGrid,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Send,
  Users,
} from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";

export type CampaignView = "review" | "gallery";

export function CampaignHeader({
  campaignName,
  reviewer,
  onShare,
  onAnalyze,
  onRefresh,
  refreshing = false,
  analyzing,
  pendingCount,
  failedCount = 0,
  totalCount,
  hasPreviousAnalysis = false,
  view,
  onViewChange,
  onSendToClient,
  sendCount,
}: {
  campaignName?: string;
  reviewer: string;
  onShare?: () => void;
  /** scope "pending" analyzes pieces without a current result; "all" repeats every piece; "retry" only failed ones. */
  onAnalyze?: (scope: "pending" | "all" | "retry") => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  analyzing: boolean;
  pendingCount?: number;
  failedCount?: number;
  totalCount?: number;
  hasPreviousAnalysis?: boolean;
  view?: CampaignView;
  onViewChange?: (view: CampaignView) => void;
  onSendToClient?: () => void;
  sendCount?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);
  const choose = (scope: "pending" | "all" | "retry") => {
    setMenuOpen(false);
    onAnalyze?.(scope);
  };
  return (
    <section className="campaign-header">
      <div className="campaign-heading">
        <Link
          className="icon-button review-back"
          href="/workspace/qa-visual"
          aria-label="Volver a campañas"
          title="Volver a campañas"
        >
          <ArrowLeft size={19} />
        </Link>
        <h1>
          {campaignName || "Campaña"}{" "}
          <span className="campaign-dot">/</span>
          <span className="heading-subtitle">Revisión de piezas</span>
        </h1>
      </div>
      <div className="campaign-actions">
        {onViewChange && (
          <div className="qa-view-toggle" role="tablist" aria-label="Vista de piezas">
            <button
              role="tab"
              aria-selected={view !== "gallery"}
              className={view !== "gallery" ? "on" : ""}
              onClick={() => onViewChange("review")}
            >
              <Columns3 size={14} />
              Revisión
            </button>
            <button
              role="tab"
              aria-selected={view === "gallery"}
              className={view === "gallery" ? "on" : ""}
              onClick={() => onViewChange("gallery")}
            >
              <LayoutGrid size={14} />
              Galería
            </button>
          </div>
        )}
        <div className="collaborators">
          <Avatar type="you" name={reviewer} small />
        </div>
        {onRefresh && (
          <button
            type="button"
            className="button secondary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Actualizando…" : "Actualizar desde Drive"}
          </button>
        )}
        {onShare && (
          <button className="button secondary" onClick={onShare}>
            <Users size={15} />
            Compartir
          </button>
        )}
        {onSendToClient && (
          <button className="button secondary qa-send-client" onClick={onSendToClient}>
            <Send size={15} />
            Enviar al cliente
            {!!sendCount && <span className="qa-count-badge">{sendCount}</span>}
          </button>
        )}
        {onAnalyze && (
          <div className="qa-split" ref={menuRef}>
            <button
              type="button"
              className="button primary qa-split-main"
              disabled={analyzing || pendingCount === 0}
              title={
                pendingCount === 0
                  ? "Todas las piezas tienen un análisis vigente"
                  : "Analizar piezas sin análisis vigente, desactualizadas o con error"
              }
              onClick={() => choose("pending")}
            >
              <ScanLine size={15} />
              Analizar piezas
              {!!pendingCount && <span className="qa-count-badge on-primary">{pendingCount}</span>}
            </button>
            <button
              type="button"
              className="button primary qa-split-caret"
              aria-label="Más opciones de análisis"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={analyzing}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <ChevronDown size={15} />
            </button>
            {menuOpen && (
              <div className="qa-menu" role="menu">
                <button
                  role="menuitem"
                  disabled={pendingCount === 0}
                  onClick={() => choose("pending")}
                >
                  <Play size={14} />
                  <span>
                    <b>Analizar pendientes y desactualizadas</b>
                    <small>Sin análisis, con un análisis anterior a un cambio o con error.</small>
                  </span>
                  <em>{pendingCount ?? "—"}</em>
                </button>
                <button
                  role="menuitem"
                  disabled={!failedCount}
                  onClick={() => choose("retry")}
                >
                  <RotateCcw size={14} />
                  <span>
                    <b>Reintentar fallidas</b>
                    <small>Solo las piezas con error técnico en el último análisis.</small>
                  </span>
                  <em>{failedCount}</em>
                </button>
                <hr />
                <button
                  role="menuitem"
                  disabled={analyzing || !hasPreviousAnalysis || !totalCount}
                  onClick={() => choose("all")}
                >
                  <ScanLine size={14} />
                  <span>
                    <b>Reanalizar todas</b>
                    <small>
                      {hasPreviousAnalysis
                        ? "Repite el análisis aunque esté vigente. Se conservan los resultados anteriores."
                        : "Disponible después del primer análisis."}
                    </small>
                  </span>
                  <em>{totalCount ?? "—"}</em>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
