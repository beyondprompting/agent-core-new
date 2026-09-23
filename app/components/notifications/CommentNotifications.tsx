"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Bell } from "lucide-react";
import Link from "next/link";

export function CommentUnreadBadge({ taskId }: { taskId: Id<"tasks"> }) {
  const rows = useQuery(api.data.commentNotifications.unread, {});
  const count = rows?.find(row => row.taskId === taskId)?.count ?? 0;
  return count ? <span aria-label={`${count} comentarios nuevos`} className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[#0C66E4] px-1.5 py-0.5 text-[11px] font-semibold text-white">{count > 99 ? "99+" : count}</span> : null;
}

export function CommentNotificationBell() {
  const rows = useQuery(api.data.commentNotifications.unread, {});
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const total = rows?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={root} className="relative">
    <button ref={button} type="button" aria-label={`Notificaciones: ${total} comentarios nuevos`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="relative rounded-lg p-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      <Bell className="h-5 w-5" aria-hidden="true" />
      {total > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#0C66E4] px-1 text-[10px] text-white">{total > 99 ? "99+" : total}</span>}
    </button>
    {open && <section id={id} aria-label="Notificaciones de comentarios" className="absolute right-0 top-full z-[60] mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-card text-foreground shadow-xl">
      <h2 className="border-b border-border p-4 text-sm font-semibold">Comentarios nuevos</h2>
      <div className="max-h-[60dvh] overflow-y-auto">
        {rows === undefined ? <p role="status" className="p-4 text-sm">Cargando…</p> : rows.length ? rows.map(row => <Link key={row.taskId} href={`${row.external ? "/workspace/requests" : "/workspace/control-panel"}?taskId=${encodeURIComponent(row.taskId)}&tab=comments`} onClick={() => setOpen(false)} className="block border-b border-border p-4 last:border-0 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <span className="block text-sm font-semibold">{row.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{row.author} comentó · {row.count} {row.count === 1 ? "nuevo" : "nuevos"}</span>
          <time className="mt-1 block text-xs text-muted-foreground" dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
        </Link>) : <p className="p-5 text-sm text-muted-foreground">No tenés comentarios nuevos.</p>}
      </div>
    </section>}
  </div>;
}
