import { MessageSquare, Paperclip } from "lucide-react";
import { Button } from "@/app/components/ui/Button";

export function RequestCommentsSection() {
  return (
    <aside aria-labelledby="request-comments-title" className="border-t border-border bg-muted/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
      <h3 id="request-comments-title" className="mb-5 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" aria-hidden="true" />Comentarios y actividad</h3>
      <div className="rounded-xl border border-border bg-card p-3">
        <label htmlFor="request-comment" className="sr-only">Escribir un comentario</label>
        <textarea id="request-comment" disabled placeholder="Escribí un comentario…" rows={4} aria-describedby="request-comments-note" className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" disabled><Paperclip className="h-4 w-4" aria-hidden="true" />Adjuntar</Button>
          <Button size="sm" disabled>Comentar</Button>
        </div>
      </div>
      <p id="request-comments-note" className="mt-3 text-xs leading-relaxed text-muted-foreground">Los comentarios y sus archivos todavía no están habilitados.</p>
      <div className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">Aquí podrás consultar los comentarios y la actividad cuando se conecte esta sección.</div>
    </aside>
  );
}

