"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowUpRight, AlignLeft, X } from "lucide-react";
import type { BoardStage, ExternalRequest } from "./types";
import { useRequestBrief } from "./useRequestBrief";
import { RequestAttachmentsSection } from "./RequestAttachmentsSection";
import { TaskMediaProvider } from "./TaskMediaContext";
import { RequestCommentsSection } from "./RequestCommentsSection";

export function RequestDetailDialog({ request, stage, onClose }: {
  request: ExternalRequest; stage: BoardStage; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const brief = useRequestBrief(request.description);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <TaskMediaProvider taskId={request._id}><dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}
      className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100vw_-_2rem)] max-w-6xl overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
      <div className="flex h-[92dvh] max-h-[92dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold">{stage.label}</span>
          <button type="button" autoFocus onClick={onClose} aria-label="Cerrar detalle de tarea" className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-rows-2 overflow-hidden lg:grid-rows-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 sm:p-8">
            <p className="mb-3 text-xs text-muted-foreground">{[request.clientName, request.brandName, request.subBrandName].filter(Boolean).join(" · ")}</p>
            <h2 id={titleId} className="break-words text-2xl font-bold leading-tight">{request.title}</h2>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <time dateTime={new Date(request.createdAt).toISOString()}>Creada el {new Date(request.createdAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}</time>
              {request.threadId ? <Link href={`/workspace?threadId=${encodeURIComponent(request.threadId)}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Ir al chat <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : <span>Chat no disponible</span>}
            </div>
            <section className="mt-8" aria-label="Descripción de la tarea">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><AlignLeft className="h-4 w-4" aria-hidden="true" />Descripción</h3>
              <div className="whitespace-pre-wrap break-words text-sm leading-7 [&_a]:text-primary [&_a]:underline [&_p]:mb-3 [&_li]:ml-4" dangerouslySetInnerHTML={{ __html: brief.html || "Sin descripción guardada." }} />
            </section>
            <RequestAttachmentsSection taskId={request._id} />
          </div>
          <RequestCommentsSection taskId={request._id} />
        </div>
      </div>
    </dialog></TaskMediaProvider>,
    document.body,
  );
}
