import { useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  FilePlus2,
  FolderOpen,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type FolderInspection = FunctionReturnType<
  typeof api.qaVisual.campaignRegistration.inspect
>;
export type SourceSelection = {
  excelFileId?: string;
  csvFileId?: string;
  resourcesFolderId?: string;
  editablesFolderId?: string;
  deploymentFolderId?: string;
};
export type CsvDownload = { name: string; content: string };

type Role = "RECURSOS" | "EDITABLES" | "DESPLIEGUE";
const roles: Record<
  Role,
  {
    folderKey: "resourcesFolderId" | "editablesFolderId" | "deploymentFolderId";
    fileKey?: "excelFileId" | "csvFileId";
    label: string;
    names: string;
  }
> = {
  RECURSOS: {
    folderKey: "resourcesFolderId",
    fileKey: "excelFileId",
    label: "Carpeta de la matriz Excel",
    names: "RECURSOS",
  },
  EDITABLES: {
    folderKey: "editablesFolderId",
    fileKey: "csvFileId",
    label: "Carpeta del CSV de producción",
    names: "EDITABLES",
  },
  DESPLIEGUE: {
    folderKey: "deploymentFolderId",
    label: "Carpeta de las piezas",
    names: "DESPLIEGUE o VISUALES",
  },
};
const isRole = (key: string): key is Role => key in roles;

export function FolderChecklist({
  inspection,
  selection,
  disabled,
  creatingCsv,
  csvDownload,
  onSelect,
  onCreateCsv,
}: {
  inspection: Extract<FolderInspection, { folder: unknown }>;
  selection: SourceSelection;
  disabled: boolean;
  creatingCsv: boolean;
  csvDownload?: CsvDownload;
  onSelect: (selection: SourceSelection) => void;
  onCreateCsv: () => void;
}) {
  const [changing, setChanging] = useState<Role[]>([]);
  const order = ["folder", "RECURSOS", "EDITABLES", "DESPLIEGUE", "ignored"];

  function chooseFolder(role: Role, folderId: string) {
    const { folderKey, fileKey } = roles[role];
    const next = { ...selection };
    if (folderId) next[folderKey] = folderId;
    else delete next[folderKey];
    // Files are chosen again inside the new folder.
    if (fileKey) delete next[fileKey];
    onSelect(next);
  }

  function download(file: CsvDownload) {
    const url = URL.createObjectURL(
      new Blob([file.content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
          const role = isRole(check.key) ? check.key : null;
          const source = role ? roles[role].fileKey : undefined;
          const candidates =
            source === "excelFileId"
              ? inspection.matrices
              : source === "csvFileId"
                ? inspection.csvs
                : [];
          const showFolder =
            role &&
            (!["ok", "info"].includes(check.status) ||
              Boolean(selection[roles[role].folderKey]) ||
              changing.includes(role));
          const createCsv = role === "EDITABLES" && inspection.canCreateCsv;
          return (
            <li key={check.key} className="qc-check">
              <span className={`qc-check-icon ${check.status}`}>
                <Icon size={14} aria-hidden />
              </span>
              <div>
                <strong>{check.title}</strong>
                {check.detail && <p>{check.detail}</p>}
                {role && showFolder && (
                  <select
                    aria-label={roles[role].label}
                    value={selection[roles[role].folderKey] ?? ""}
                    disabled={disabled}
                    onChange={(event) => chooseFolder(role, event.target.value)}
                  >
                    <option value="">
                      Buscar por nombre ({roles[role].names})
                    </option>
                    {inspection.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                )}
                {source &&
                  (candidates.length > 1 || check.status === "choose") &&
                  candidates.length > 0 && (
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
                {(createCsv || (role === "EDITABLES" && csvDownload)) && (
                  <div className="qc-check-actions">
                    {createCsv && (
                      <button
                        type="button"
                        className="qc-button secondary small"
                        disabled={disabled}
                        onClick={onCreateCsv}
                      >
                        {creatingCsv ? (
                          <LoaderCircle
                            size={14}
                            className="qc-spin"
                            aria-hidden
                          />
                        ) : (
                          <FilePlus2 size={14} aria-hidden />
                        )}
                        {creatingCsv
                          ? "Creando CSV…"
                          : "Crear CSV desde la matriz"}
                      </button>
                    )}
                    {csvDownload && (
                      <button
                        type="button"
                        className="qc-button ghost small"
                        onClick={() => download(csvDownload)}
                      >
                        <Download size={14} aria-hidden />
                        Descargar CSV
                      </button>
                    )}
                  </div>
                )}
                {createCsv && inspection.csvFolder?.canWrite === false && (
                  <p>
                    Para guardarlo en «{inspection.csvFolder.name}», la cuenta
                    de servicio necesita permiso de <b>Editor</b> en esa
                    carpeta. Si no, podés descargarlo y subirlo vos.
                  </p>
                )}
                {role && !showFolder && (
                  <button
                    type="button"
                    className="qc-link-button"
                    disabled={disabled}
                    onClick={() => setChanging([...changing, role])}
                  >
                    <FolderOpen size={12} aria-hidden />
                    Usar otra carpeta
                  </button>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
