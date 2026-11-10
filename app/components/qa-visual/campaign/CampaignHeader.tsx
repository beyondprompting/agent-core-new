import Link from "next/link";
import { ArrowLeft, RefreshCw, ScanLine, Users } from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";

export function CampaignHeader({
  campaignName,
  reviewer,
  onShare,
  onAnalyze,
  onRefresh,
  refreshing = false,
  analyzing,
}: {
  campaignName?: string;
  reviewer: string;
  onShare?: () => void;
  onAnalyze?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  analyzing: boolean;
}) {
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
        {onAnalyze && (
          <button
            type="button"
            className="button primary"
            disabled={analyzing}
            onClick={onAnalyze}
          >
            <ScanLine size={15} />
            Analizar piezas
          </button>
        )}
      </div>
    </section>
  );
}
