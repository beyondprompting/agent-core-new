import Link from "next/link";
import { ArrowLeft, ScanLine, Users } from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";

export function CampaignHeader({
  campaignName,
  reviewer,
  onShare,
  onAnalyze,
  analyzing,
}: {
  campaignName?: string;
  reviewer: string;
  onShare?: () => void;
  onAnalyze?: () => void;
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
