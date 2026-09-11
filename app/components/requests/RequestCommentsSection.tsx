"use client";
import { useState } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { TaskCommentBody } from "./TaskCommentBody";
import { Button } from "@/app/components/ui/Button";
import type { Id } from "@/convex/_generated/dataModel";
import { CommentEditor } from "./comment-editor/CommentEditor";
import { useTaskPanelActivity, useTaskPanelSubmit } from "./useTaskPanelActivity";

export function RequestCommentsSection({ taskId }: { taskId: Id<"tasks"> }) {
  const data = useTaskPanelActivity(taskId);
  const [editorKey, setEditorKey] = useState(0);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const submission = useTaskPanelSubmit(taskId);
  const needsReview = data?.entries.some(e => e.trelloState === "needs_review" || e.corState === "needs_review");
  const pending = data?.entries.some(e => ["waiting", "sending"].includes(e.trelloState) || ["waiting", "sending"].includes(e.corState));
  return <aside aria-labelledby="request-comments-title" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain border-t border-border bg-muted/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
    <h3 id="request-comments-title" className="mb-5 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" />Comentarios</h3>
    <form onSubmit={async e => { e.preventDefault(); if (await submission.save(text, files)) { setText(""); setFiles([]); setEditorKey(key => key + 1); } }} className="rounded-xl border border-border bg-card p-3">
      <CommentEditor key={editorKey} disabled={submission.busy} onChange={(value, selected) => { setText(value); setFiles(selected); }} />
      <Button type="submit" size="sm" className="mt-3" disabled={submission.busy || (!text.trim() || text.length > 10000)}>{submission.busy && <Loader2 className="h-4 w-4 animate-spin" />}Comentar</Button>
      {text.length > 10000 && <p role="alert" className="mt-2 text-xs text-destructive">El comentario supera los 10.000 caracteres.</p>}
      {submission.error && <p role="alert" className="mt-3 text-xs text-destructive">{submission.error}</p>}
    </form>
    {needsReview && <p role="status" className="mt-3 text-xs text-destructive">Hay contenido guardado cuya sincronización requiere revisión. No se reenvía automáticamente para evitar duplicados.</p>}
    {pending && <p role="status" className="mt-3 text-xs text-muted-foreground">Hay contenido guardado pendiente de sincronización o de publicación de la tarea.</p>}
    <div className="mt-6 space-y-4">{data === undefined ? <p role="status" className="text-xs text-muted-foreground">Cargando comentarios…</p> : data.comments.length ? data.comments.map(comment => <article key={comment.id} className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold">{comment.own ? "Vos" : comment.authorName || "Comentario"}</p>
      <time className="mt-1 block text-[11px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("es")}</time>
      <TaskCommentBody text={comment.text} />
    </article>) : <p className="text-xs text-muted-foreground">Todavía no hay comentarios.</p>}</div>
  </aside>;
}
