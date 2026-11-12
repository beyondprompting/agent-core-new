"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { FolderOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ProgressSummary } from "./ProgressSummary";

export function ClientCampaignList() {
  const data = useQuery(api.qaVisual.clientPortal.campaigns);
  if (!data) return null;
  if (!data.campaigns.length)
    return (
      <div className="qa-portal-empty">
        <FolderOpen size={28} />
        <b>Todavía no hay piezas para revisar</b>
        <p>Cuando la agencia te envíe una ronda, la vas a ver acá y te va a llegar un aviso.</p>
      </div>
    );
  return (
    <ul className="qa-portal-list">
      {data.campaigns.map((c) => (
        <li key={c.id}>
          <Link href={`/workspace/reviews/${c.id}`}>
            <b style={{ fontSize: 16 }}>{c.name}</b>
            {c.lastDeliveryAt && (
              <span className="qa-muted">
                Última ronda: {new Date(c.lastDeliveryAt).toLocaleDateString()}
              </span>
            )}
            <ProgressSummary counts={c.counts} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
