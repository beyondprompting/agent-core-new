import { ArrowLeft, Users } from "lucide-react";

import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function CampaignHeader({
  session: { setModal, inventory, reviewer },
}: {
  session: ReviewSession;
}) {
  return (
    <section className="campaign-header">
      <div className="campaign-heading">
        <Link
          className="icon-button review-back"
          href="/workspace"
          aria-label="Volver al espacio de trabajo"
          title="Volver al espacio de trabajo"
        >
          <ArrowLeft size={19} />
        </Link>
        <h1>
          {inventory.campaignName || "Campaña"}{" "}
          <span className="campaign-dot">/</span>
          <span className="heading-subtitle">Revisión de piezas</span>
        </h1>
      </div>
      <div className="campaign-actions">
        <div className="collaborators">
          <Avatar type="you" name={reviewer} small />
        </div>
        <button className="button secondary" onClick={() => setModal("share")}>
          <Users size={15} />
          Compartir
        </button>
      </div>
    </section>
  );
}

import Link from "next/link";
