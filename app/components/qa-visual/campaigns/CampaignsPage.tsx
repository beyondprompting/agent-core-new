"use client";

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  Archive,
  FolderOpen,
  LoaderCircle,
  Plus,
  ScanLine,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { CampaignCardData } from "@/app/lib/qa-visual/campaign-model";
import { CampaignCard } from "./CampaignCard";
import { CampaignForm } from "./CampaignForm";
import "./campaigns.css";

export function CampaignsPage() {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const {
    results: campaigns,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.qaVisual.campaigns.list,
    { status: tab },
    { initialNumItems: 12 },
  );
  const counts = useQuery(api.qaVisual.campaigns.counts, {});
  const [dialog, setDialog] = useState<"new" | CampaignCardData | null>(null);
  const [notice, setNotice] = useState("");
  const adding = dialog === "new";

  function openForm() {
    setNotice("");
    setDialog("new");
  }

  return (
    <div className="qa-campaigns">
      <header className="qc-page-header">
        <div>
          <div className="qc-eyebrow">
            <ScanLine size={14} aria-hidden />
            QA Visual
          </div>
          <h1>Campañas</h1>
          <p>Abrí una campaña para revisar sus piezas y resultados.</p>
        </div>
        <button
          className="qc-button primary"
          onClick={openForm}
          aria-haspopup="dialog"
        >
          <Plus size={16} aria-hidden />
          Agregar campaña
        </button>
      </header>
      <main className="qc-page-body">
        {notice && (
          <p role="status" className="qc-page-notice">
            {notice}
          </p>
        )}
        <div
          className="qc-segmented"
          role="group"
          aria-label="Estado de las campañas"
        >
          {(["active", "archived"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "active" ? "Activas" : "Archivadas"} ·{" "}
              {counts
                ? `${counts[value].value}${counts[value].more ? "+" : ""}`
                : "…"}
            </button>
          ))}
        </div>
        {status === "LoadingFirstPage" ? (
          <p role="status" className="qc-loading">
            <LoaderCircle size={16} className="qc-spin" aria-hidden />
            Cargando campañas…
          </p>
        ) : campaigns.length ? (
          <ul
            className="qc-cards"
            aria-label={
              tab === "active" ? "Campañas activas" : "Campañas archivadas"
            }
          >
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign._id}
                campaign={campaign}
                onChooseSources={setDialog}
              />
            ))}
          </ul>
        ) : (
          <section className="qc-empty">
            <span className="qc-folder-icon">
              {tab === "active" ? (
                <FolderOpen size={22} aria-hidden />
              ) : (
                <Archive size={22} aria-hidden />
              )}
            </span>
            <h2>
              {tab === "active"
                ? "Todavía no hay campañas activas"
                : "No hay campañas archivadas"}
            </h2>
            <p>
              {tab === "active"
                ? "Agregá una carpeta de Google Drive para empezar a revisar sus piezas."
                : "Las campañas archivadas aparecerán acá."}
            </p>
            {tab === "active" && (
              <button
                className="qc-button secondary"
                onClick={openForm}
                aria-haspopup="dialog"
              >
                Agregar primera campaña
              </button>
            )}
          </section>
        )}
        {(status === "CanLoadMore" || status === "LoadingMore") && (
          <div className="qc-load-more">
            <button
              className="qc-button secondary"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(12)}
            >
              {status === "LoadingMore" ? (
                <>
                  <LoaderCircle size={16} className="qc-spin" aria-hidden />
                  Cargando…
                </>
              ) : (
                "Ver más campañas"
              )}
            </button>
          </div>
        )}
      </main>
      {dialog && (
        <CampaignForm
          campaign={typeof dialog === "object" ? dialog : undefined}
          onClose={() => setDialog(null)}
          onCreated={(name) => {
            setNotice(
              adding
                ? `Se agregó la campaña ${name}. La importación está en curso.`
                : `Se guardaron las fuentes de ${name}. La importación está en curso.`,
            );
            setTab("active");
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
