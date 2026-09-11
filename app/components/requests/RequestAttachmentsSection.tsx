import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/app/components/ui/Button";

export function RequestAttachmentsSection() {
  return (
    <section aria-labelledby="request-attachments-title" className="mt-8 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="request-attachments-title" className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" aria-hidden="true" />Archivos adjuntos</h3>
        <Button variant="outline" size="sm" disabled aria-describedby="request-attachments-note"><Upload className="h-4 w-4" aria-hidden="true" />Subir archivo</Button>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-5 py-7 text-center">
        <Paperclip className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Archivos de la solicitud</p>
        <p id="request-attachments-note" className="mt-2 text-xs leading-relaxed text-muted-foreground">La consulta y subida de archivos se habilitarán en una próxima etapa.</p>
      </div>
    </section>
  );
}

