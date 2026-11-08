"use client";

import { useState, type MouseEvent } from "react";
import { useQuery } from "convex/react";
import { FolderOpen, LoaderCircle, Plus, ScanLine } from "lucide-react";
import { Button } from "@/app/components/ui/Button";
import { api } from "@/convex/_generated/api";
import { CampaignCard } from "./CampaignCard";
import { CampaignForm } from "./CampaignForm";

export function CampaignsPage() {
  const campaigns = useQuery(api.qaVisual.campaigns.list, {});
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  function openForm(event: MouseEvent<HTMLButtonElement>) {
    event.currentTarget.focus();
    setNotice("");
    setAdding(true);
  }

  function closeForm() {
    setAdding(false);
  }

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <ScanLine className="size-4" aria-hidden />
              QA Visual
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Campañas</h1>
            <p className="mt-1 text-sm text-muted-foreground">Abrí una campaña para revisar sus piezas y resultados.</p>
          </div>
          <Button
            onClick={openForm}
            aria-haspopup="dialog"
          >
            <Plus aria-hidden />
            Agregar campaña
          </Button>
        </div>
      </header>
      <div className="px-6 py-7">
        {notice && <p role="status" className="mb-5 text-sm text-foreground">{notice}</p>}
        {campaigns === undefined ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Cargando campañas…
          </p>
        ) : campaigns.length ? (
          <section aria-labelledby="qa-campaign-list">
            <h2 id="qa-campaign-list" className="mb-4 text-sm font-semibold">
              Campañas activas <span className="ml-1 text-muted-foreground">{campaigns.length}</span>
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {campaigns.map(({ _id, name }) => <CampaignCard key={_id} id={_id} name={name} />)}
            </ul>
          </section>
        ) : (
          <section className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderOpen className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-base font-semibold">Todavía no hay campañas</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Agregá una carpeta de Google Drive para empezar a revisar sus piezas.
            </p>
            <Button onClick={openForm} aria-haspopup="dialog" variant="outline" className="mt-5">
              Agregar primera campaña
            </Button>
          </section>
        )}
      </div>
      {adding && (
        <CampaignForm
          onClose={closeForm}
          onCreated={(name) => {
            setNotice(`Se agregó la campaña ${name}.`);
            closeForm();
          }}
        />
      )}
    </div>
  );
}
