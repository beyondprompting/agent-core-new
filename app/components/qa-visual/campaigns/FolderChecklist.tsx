import { AlertCircle, Check, Info, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type FolderInspection = FunctionReturnType<
  typeof api.qaVisual.campaignRegistration.inspect
>;
export type SourceSelection = { excelFileId?: string; csvFileId?: string };

export function FolderChecklist({
  inspection,
  selection,
  disabled,
  onSelect,
}: {
  inspection: Extract<FolderInspection, { folder: unknown }>;
  selection: SourceSelection;
  disabled: boolean;
  onSelect: (selection: SourceSelection) => void;
}) {
  const order = ["folder", "RECURSOS", "EDITABLES", "DESPLIEGUE", "ignored"];
  return (
    <ul className="qc-checklist" aria-label="Resultado de la verificación">
      {[...inspection.checks]
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .map((check) => {
          const Icon =
            check.status === "ok"
              ? Check
              : check.status === "missing"
                ? X
                : check.status === "choose"
                  ? AlertCircle
                  : Info;
          const source =
            check.key === "RECURSOS"
              ? "excelFileId"
              : check.key === "EDITABLES"
                ? "csvFileId"
                : null;
          const candidates =
            source === "excelFileId"
              ? inspection.matrices
              : source === "csvFileId"
                ? inspection.csvs
                : [];
          return (
            <li key={check.key} className="qc-check">
              <span className={`qc-check-icon ${check.status}`}>
                <Icon size={14} aria-hidden />
              </span>
              <div>
                <strong>{check.title}</strong>
                {check.detail && <p>{check.detail}</p>}
                {source &&
                  (candidates.length > 1 || check.status === "choose") && (
                    <select
                      aria-label={
                        source === "excelFileId"
                          ? "Matriz del cliente"
                          : "CSV de producción"
                      }
                      value={selection[source] ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onSelect({ ...selection, [source]: event.target.value })
                      }
                    >
                      <option value="" disabled>
                        Elegí{" "}
                        {source === "excelFileId" ? "una matriz" : "un CSV"}…
                      </option>
                      {candidates.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.name}
                        </option>
                      ))}
                    </select>
                  )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
