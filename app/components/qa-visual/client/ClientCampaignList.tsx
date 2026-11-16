"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderOpen,
  ImageIcon,
  MessageSquareText,
  MousePointerClick,
  RotateCcw,
  ThumbsUp,
} from "lucide-react";
import { api } from "@/convex/_generated/api";

const thumb = (item: string) =>
  `/workspace/reviews/media?${new URLSearchParams({ item, variant: "thumbnail" })}`;

/** Client home (§23.6): greeting, overall progress, campaigns with previews and how to review. */
export function ClientCampaignList() {
  const data = useQuery(api.qaVisual.clientPortal.campaigns);
  if (!data) return null;
  const totals = data.campaigns.reduce(
    (t, c) => ({
      total: t.total + c.counts.total,
      pending: t.pending + c.counts.pending,
      changes: t.changes + c.counts.changes,
      approved: t.approved + c.counts.approved,
    }),
    { total: 0, pending: 0, changes: 0, approved: 0 },
  );
  const pendingCampaigns = data.campaigns.filter((c) => c.counts.pending > 0).length;
  return (
    <div className="qa-home">
      <section className="qa-home-hero">
        <div>
          <span className="qa-portal-eyebrow">Revisión de piezas</span>
          <h1>Hola{data.viewerName ? `, ${data.viewerName}` : ""}</h1>
          <p>
            {!data.campaigns.length
              ? "Cuando la agencia te envíe piezas para revisar, las vas a ver acá."
              : totals.pending
                ? `Tenés ${totals.pending} ${totals.pending === 1 ? "pieza" : "piezas"} por revisar en ${pendingCampaigns} ${pendingCampaigns === 1 ? "campaña" : "campañas"}.`
                : "Estás al día: no hay piezas pendientes de revisión."}
          </p>
        </div>
        <div className="qa-home-stats">
          <Stat icon={<Clock3 size={16} />} tone="client" value={totals.pending} label="Por revisar" />
          <Stat icon={<RotateCcw size={16} />} tone="danger" value={totals.changes} label="Con cambios pedidos" />
          <Stat icon={<CheckCircle2 size={16} />} tone="success" value={totals.approved} label="Aprobadas" />
        </div>
      </section>

      <div className="qa-home-body">
        <section className="qa-home-main" aria-labelledby="qa-home-campaigns">
          <header className="qa-home-section-head">
            <h2 id="qa-home-campaigns">Campañas</h2>
            <span>{data.campaigns.length}</span>
          </header>
          {!data.campaigns.length ? (
            <div className="qa-home-empty">
              <span className="qa-home-empty-icon"><FolderOpen size={22} /></span>
              <b>Todavía no hay piezas para revisar</b>
              <p>Cuando la agencia te envíe una ronda, la vas a ver acá.</p>
            </div>
          ) : (
            <ul className="qa-home-campaigns">
              {data.campaigns.map((c) => {
                const pct = (n: number) => `${c.counts.total ? (n / c.counts.total) * 100 : 0}%`;
                return (
                  <li key={c.id}>
                    <Link href={`/workspace/reviews/${c.id}`} className="qa-home-card">
                      <span className={`qa-home-mosaic n${Math.min(c.previews.length, 4)}`} aria-hidden>
                        {c.previews.length ? (
                          c.previews.map((id) => <img key={id} src={thumb(id)} alt="" loading="lazy" />)
                        ) : (
                          <span className="qa-home-mosaic-empty"><ImageIcon size={20} /></span>
                        )}
                        {c.counts.pending > 0 && (
                          <span className="qa-home-badge">{c.counts.pending} por revisar</span>
                        )}
                      </span>
                      <span className="qa-home-card-body">
                        <span className="qa-home-card-meta">
                          {c.agencyLabel}
                          {c.lastRound ? ` · Ronda ${c.lastRound}` : ""}
                          {c.lastDeliveryAt ? ` · ${new Date(c.lastDeliveryAt).toLocaleDateString()}` : ""}
                        </span>
                        <b>{c.name}</b>
                        <span className="qa-home-progress" aria-label={`${c.counts.approved} de ${c.counts.total} aprobadas`}>
                          <i style={{ width: pct(c.counts.approved), background: "var(--success)" }} />
                          <i style={{ width: pct(c.counts.changes), background: "var(--danger)" }} />
                        </span>
                        <span className="qa-home-card-counts">
                          <span><i className="dot success" />{c.counts.approved} aprobadas</span>
                          <span><i className="dot danger" />{c.counts.changes} con cambios</span>
                          <span><i className="dot client" />{c.counts.pending} por revisar</span>
                        </span>
                        <span className={`qa-home-cta ${c.counts.pending ? "primary" : ""}`}>
                          {c.counts.pending ? `Revisar ${c.counts.pending} ${c.counts.pending === 1 ? "pieza" : "piezas"}` : "Ver campaña"}
                          <ArrowRight size={14} />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="qa-home-aside" aria-label="Cómo revisar">
          <h2>Cómo revisar</h2>
          <ol className="qa-home-steps">
            <li>
              <span><MousePointerClick size={15} /></span>
              <div>
                <b>Abrí una pieza</b>
                <p>Recorré las piezas con las flechas del teclado o deslizando.</p>
              </div>
            </li>
            <li>
              <span><MessageSquareText size={15} /></span>
              <div>
                <b>Comentá lo que haya que cambiar</b>
                <p>Marcá un punto o un área de la imagen. Cada comentario es un pedido de cambio para la agencia.</p>
              </div>
            </li>
            <li>
              <span><ThumbsUp size={15} /></span>
              <div>
                <b>Aprobá cuando esté lista</b>
                <p>Tu aprobación es la final: la pieza queda lista para publicar.</p>
              </div>
            </li>
          </ol>
          {totals.total > 0 && (
            <div className="qa-home-overall">
              <span>Progreso total</span>
              <b>
                {totals.approved} de {totals.total} aprobadas
              </b>
              <span className="qa-home-progress">
                <i style={{ width: `${(totals.approved / totals.total) * 100}%`, background: "var(--success)" }} />
                <i style={{ width: `${(totals.changes / totals.total) * 100}%`, background: "var(--danger)" }} />
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: "client" | "danger" | "success";
  value: number;
  label: string;
}) {
  return (
    <div className={`qa-home-stat tone-${tone}`}>
      <span>{icon}</span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}
