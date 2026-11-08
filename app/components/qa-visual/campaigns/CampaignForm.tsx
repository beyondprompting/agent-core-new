import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { Link2, LoaderCircle, X } from "lucide-react";
import { Button } from "@/app/components/ui/Button";
import { api } from "@/convex/_generated/api";

export function CampaignForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAction(api.qaVisual.campaignRegistration.add);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    inputRef.current?.focus();

    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !url.trim()) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await add({ folderUrl: url.trim() });
      if ("error" in result) setError(result.error);
      else onCreated(result.name);
    } catch {
      setError("No se pudo conectar con QA Visual. Intentá de nuevo.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="qa-campaign-form-title"
      aria-describedby="qa-campaign-form-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting.current) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="qa-campaign-form-title" className="text-lg font-semibold">
              Agregar campaña
            </h2>
            <p id="qa-campaign-form-description" className="mt-1 text-sm text-muted-foreground">
              Compartí la carpeta con la cuenta de servicio como Lector y pegá su enlace.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={pending}
            aria-label="Cerrar diálogo"
          >
            <X aria-hidden />
          </Button>
        </div>
        <label htmlFor="qa-drive-folder" className="mt-5 block text-sm font-medium">
          Enlace de la carpeta de Drive
        </label>
        <div className="relative mt-2">
          <Link2 className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <input
            id="qa-drive-folder"
            ref={inputRef}
            type="url"
            required
            maxLength={2048}
            value={url}
            readOnly={pending}
            onChange={(event) => {
              setUrl(event.target.value);
              if (error) setError("");
            }}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "qa-drive-folder-error" : undefined}
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
          />
        </div>
        {error && <p id="qa-drive-folder-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="submit" disabled={pending || !url.trim()}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
            {pending ? "Verificando carpeta…" : "Agregar campaña"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
