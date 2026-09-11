"use client";

import Link from "next/link";
import { useState } from "react";
import { RequestDetailDialog } from "./RequestDetailDialog";
import { ArrowUpRight } from "lucide-react";
import type { BoardStage, ExternalRequest } from "./types";
import { useRequestBrief } from "./useRequestBrief";

export function RequestBoardCard({ request, stage }: { request: ExternalRequest; stage: BoardStage }) {
  const brief = useRequestBrief(request.description);
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <article className={`relative rounded-md border border-border border-l-[3px] bg-card p-3 shadow-sm transition-shadow hover:shadow-md ${stage.cardAccent}`}>
      <p className="mb-2 break-words text-[11px] font-semibold text-muted-foreground">
        {[request.clientName, request.brandName, request.subBrandName].filter(Boolean).join(" · ")}
      </p>
      <button type="button" onClick={() => setDetailOpen(true)} aria-haspopup="dialog" className="w-full cursor-pointer break-words rounded text-left text-[13px] font-semibold leading-snug after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{request.title}</button>
      <div className="mt-2 space-y-1 break-words text-xs leading-relaxed text-muted-foreground">
        {brief.requestType && <p><span className="font-medium text-foreground">Tipo:</span> {brief.requestType}</p>}
        {brief.launchDate && <p><span className="font-medium text-foreground">Fecha:</span> {brief.launchDate}</p>}
      </div>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
        <time dateTime={new Date(request.createdAt).toISOString()}>Creada {new Date(request.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</time>
        {request.threadId ? <Link href={`/workspace/requests/chat/${encodeURIComponent(request.threadId)}`} className="relative z-10 inline-flex items-center gap-1 rounded font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">Ir al chat <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link> :
          <span>Chat no disponible</span>}
      </footer>
      {!request.threadId && <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">La conversación ya no está disponible. Abrí el título para consultar tu solicitud.</p>}
      {detailOpen && <RequestDetailDialog request={request} stage={stage} onClose={() => setDetailOpen(false)} />}
    </article>
  );
}
