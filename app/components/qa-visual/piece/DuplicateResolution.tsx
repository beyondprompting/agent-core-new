"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { campaignError } from "@/app/lib/qa-visual/campaign-model";

export function DuplicateResolution({
  pieceId,
}: {
  pieceId: Id<"qaVisualPieces">;
}) {
  const data = useQuery(api.qaVisual.overrides.duplicateOptions, { pieceId });
  const resolve = useMutation(api.qaVisual.overrides.resolveDuplicate);
  const revoke = useMutation(api.qaVisual.overrides.revoke);
  const [kind, setKind] = useState<"keepDuplicate" | "mergeAsVersion">(
    "keepDuplicate",
  );
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return null;
  const disabled = busy || data.busy;
  return (
    <section
      className="qa-duplicate-resolution"
      aria-label="Resolver archivos duplicados"
    >
      <strong>Archivos con el mismo nombre</strong>
      <p>
        {data.members.length} archivos presentes en Drive. La confirmación se
        guarda y vuelve a importar el pedido.
      </p>
      {data.resolutions.map((row) => (
        <div key={row.id}>
          <p>
            {row.kind === "keepDuplicate"
              ? "Entrega definitiva confirmada"
              : "Entregas unidas como versiones"}{" "}
            · {row.note}
          </p>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await revoke({ overrideId: row.id });
              } catch (e) {
                setError(campaignError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Revocar confirmación
          </button>
        </div>
      ))}
      {data.members.filter((m) => m.disposition === "active").length > 1 && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled) return;
            setBusy(true);
            setError("");
            try {
              await resolve({
                pieceId,
                expectedImportId: data.importId,
                kind,
                ...(kind === "mergeAsVersion"
                  ? { otherDriveFileId: other }
                  : {}),
                note,
              });
              setNote("");
            } catch (e) {
              setError(campaignError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Cómo resolverlo
            <select
              value={kind}
              disabled={disabled}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="keepDuplicate">
                Marcar esta pieza como definitiva
              </option>
              <option value="mergeAsVersion">Es una versión nueva de…</option>
            </select>
          </label>
          {kind === "mergeAsVersion" && (
            <label>
              Entrega anterior
              <select
                value={other}
                required
                disabled={disabled}
                onChange={(e) => setOther(e.target.value)}
              >
                <option value="">Elegí el archivo anterior</option>
                {data.members
                  .filter((m) => m.driveFileId !== data.currentDriveFileId)
                  .map((m) => (
                    <option key={m.driveFileId} value={m.driveFileId}>
                      {m.name} · {new Date(m.createdAt).toLocaleString("es-AR")}{" "}
                      · {m.driveFileId.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Motivo
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              maxLength={4000}
              disabled={disabled}
            />
          </label>
          <p>
            {kind === "keepDuplicate"
              ? "Los otros archivos quedan excluidos de la revisión; se conservan en Drive y en el historial."
              : "La entrega más reciente será la versión actual. Cada versión conserva su propia revisión."}
          </p>
          <button
            type="submit"
            className="button secondary"
            disabled={
              disabled || !note.trim() || (kind === "mergeAsVersion" && !other)
            }
          >
            {disabled ? "Reprocesando…" : "Guardar confirmación"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
