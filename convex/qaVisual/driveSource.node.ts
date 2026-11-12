import { createHash } from "node:crypto";
import type {
  QaFile,
  QaInventory,
  QaPieceFile,
} from "../../app/lib/qa-visual/source";
import { productionByPiece } from "./model/productionCsv";
import { parseClientMatrix } from "./clientMatrix.node";
import {
  campaignFolders,
  csvLimit,
  downloadDriveFile,
  findCampaignFolder,
  folderMime,
  isCampaignFolder,
  getDriveFile,
  listDriveFolder,
  matrixLimit,
  imageLimit,
  type DriveFile,
} from "./driveClient";

export function toQaFile(file: DriveFile): QaFile {
  return {
    name: file.name,
    bytes: Number(file.size ?? 0),
    updatedAt: Date.parse(file.modifiedTime ?? "") || 0,
  };
}

export function imageMime(file: DriveFile) {
  if (file.mimeType === "image/png" && /\.png$/i.test(file.name))
    return "image/png";
  if (file.mimeType === "image/jpeg" && /\.jpe?g$/i.test(file.name))
    return "image/jpeg";
  return null;
}

async function readCampaignRoot(id: string) {
  const root = await getDriveFile(id);
  if (
    !root ||
    root.trashed ||
    root.mimeType !== folderMime ||
    !root.capabilities?.canListChildren
  )
    throw new DriveFolderError(
      "No se pudo abrir la carpeta. Compartila como Lector con la cuenta de servicio de QA Visual.",
    );
  return { root, children: await listDriveFolder(id) };
}

export class DriveFolderError extends Error {
  constructor(
    message: string,
    readonly code?: "sources",
  ) {
    super(message);
  }
}

export type SourceSelection = { excelFileId?: string; csvFileId?: string };

function matrixCandidates(files: DriveFile[]) {
  return files.filter(
    (file) => !file.name.startsWith("~$") && /\.xlsx$/i.test(file.name),
  );
}
function csvCandidatesOf(files: DriveFile[]) {
  const csvFiles = files.filter(
    (file) => !file.name.startsWith("~$") && /\.csv$/i.test(file.name),
  );
  const converted = csvFiles.filter((file) =>
    /_CONVERTED(?:_v\d+)?\.csv$/i.test(file.name),
  );
  return converted.length
    ? converted
    : csvFiles.filter((file) => !/^_?BUILDER(?:_|\.)/i.test(file.name));
}
function pick(candidates: DriveFile[], chosen?: string) {
  if (chosen) return candidates.find((file) => file.id === chosen) ?? null;
  if (candidates.length === 1) return candidates[0];
  return null;
}

export type FolderCheck = {
  key: "folder" | "RECURSOS" | "EDITABLES" | "DESPLIEGUE" | "ignored";
  status: "ok" | "missing" | "choose" | "info";
  title: string;
  detail?: string;
};
export type FolderInspection =
  | { ok: false; error: string }
  | {
      ok: boolean;
      folder: { id: string; name: string };
      checks: FolderCheck[];
      matrices: { id: string; name: string }[];
      csvs: { id: string; name: string }[];
      images: number;
      selection: SourceSelection;
    };

/** Read-only preview used by the two-step registration dialog. Nothing is written. */
export async function inspectDriveFolder(
  url: string,
  selection: SourceSelection = {},
): Promise<FolderInspection> {
  let id: string;
  try {
    id = parseFolderUrl(url);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  let root: DriveFile, children: DriveFile[];
  try {
    ({ root, children } = await readCampaignRoot(id));
  } catch (error) {
    if (error instanceof DriveFolderError)
      return { ok: false, error: error.message };
    throw error;
  }
  const checks: FolderCheck[] = [
    {
      key: "folder",
      status: "ok",
      title: root.name,
      detail: "Accesible como Lector. QA Visual nunca modifica la carpeta.",
    },
  ];
  const listings = new Map<string, DriveFile[]>();
  for (const name of campaignFolders) {
    const matches = children.filter((file) => isCampaignFolder(file, name));
    if (matches.length !== 1 || !matches[0].capabilities?.canListChildren) {
      checks.push({
        key: name,
        status: "missing",
        title:
          matches.length > 1
            ? `Hay ${matches.length} carpetas ${name}`
            : `Falta la carpeta ${name}`,
        detail:
          matches.length > 1
            ? `Dejá una sola carpeta ${name}.`
            : matches.length
              ? `La carpeta ${name} no se puede leer. Revisá que esté compartida.`
              : `Creá la subcarpeta ${name} o revisá su nombre. Se aceptan mayúsculas, minúsculas y tildes.`,
      });
      continue;
    }
    try {
      listings.set(name, await listDriveFolder(matches[0].id));
    } catch {
      checks.push({
        key: name,
        status: "missing",
        title: `No se pudo leer ${name}`,
        detail: "Revisá que esté compartida como Lector y volvé a verificar.",
      });
    }
  }
  const matrices = matrixCandidates(listings.get("RECURSOS") ?? []);
  const csvs = csvCandidatesOf(listings.get("EDITABLES") ?? []);
  const deployment = listings.get("DESPLIEGUE") ?? [];
  const images = deployment.filter((file) => file.version && imageMime(file));
  if (listings.has("RECURSOS"))
    checks.push(
      matrices.length === 0
        ? {
            key: "RECURSOS",
            status: "missing",
            title: "RECURSOS · falta la matriz Excel",
            detail: "Subí la matriz del cliente en formato .xlsx.",
          }
        : pick(matrices, selection.excelFileId)
          ? {
              key: "RECURSOS",
              status: "ok",
              title: "RECURSOS · matriz del cliente",
              detail: pick(matrices, selection.excelFileId)!.name,
            }
          : {
              key: "RECURSOS",
              status: "choose",
              title: selection.excelFileId
                ? "RECURSOS · la matriz elegida ya no está disponible"
                : `RECURSOS · ${matrices.length} matrices Excel`,
              detail: "Elegí la que corresponde al pedido de esta campaña.",
            },
    );
  if (listings.has("EDITABLES"))
    checks.push(
      csvs.length === 0
        ? {
            key: "EDITABLES",
            status: "missing",
            title: "EDITABLES · falta el CSV de producción",
            detail:
              "Subí el CSV de producción (idealmente con sufijo _CONVERTED).",
          }
        : pick(csvs, selection.csvFileId)
          ? {
              key: "EDITABLES",
              status: "ok",
              title: "EDITABLES · CSV de producción",
              detail: pick(csvs, selection.csvFileId)!.name,
            }
          : {
              key: "EDITABLES",
              status: "choose",
              title: selection.csvFileId
                ? "EDITABLES · el CSV elegido ya no está disponible"
                : `EDITABLES · ${csvs.length} CSV candidatos`,
              detail: "Elegí el CSV de producción de esta campaña.",
            },
    );
  if (listings.has("DESPLIEGUE"))
    checks.push(
      images.length
        ? {
            key: "DESPLIEGUE",
            status: images.length > 1000 ? "missing" : "ok",
            title: `DESPLIEGUE · ${images.length} ${images.length === 1 ? "imagen" : "imágenes"} PNG o JPEG`,
            detail:
              images.length > 1000
                ? "Supera el límite de 1000 piezas por campaña."
                : "Se preparan miniaturas e imágenes de análisis después de importar.",
          }
        : {
            key: "DESPLIEGUE",
            status: "info",
            title: "DESPLIEGUE · todavía no hay imágenes",
            detail:
              "Podés registrar la campaña igual; las piezas aparecen al actualizar desde Drive.",
          },
    );
  const ignored = deployment.filter(
    (file) => !(file.version && imageMime(file)),
  );
  if (ignored.length)
    checks.push({
      key: "ignored",
      status: "info",
      title: `${ignored.length} ${ignored.length === 1 ? "archivo" : "archivos"} de DESPLIEGUE no se analizan`,
      detail:
        "Solo se revisan imágenes PNG y JPEG. Las subcarpetas y otros formatos se ignoran.",
    });
  return {
    ok:
      checks.every(
        (check) => check.status === "ok" || check.status === "info",
      ) && images.length <= 1000,
    folder: { id: root.id, name: root.name },
    checks,
    matrices: matrices.map(({ id, name }) => ({ id, name })),
    csvs: csvs.map(({ id, name }) => ({ id, name })),
    images: images.length,
    selection: {
      ...(pick(matrices, selection.excelFileId)
        ? { excelFileId: pick(matrices, selection.excelFileId)!.id }
        : {}),
      ...(pick(csvs, selection.csvFileId)
        ? { csvFileId: pick(csvs, selection.csvFileId)!.id }
        : {}),
    },
  };
}

function parseFolderUrl(url: string) {
  let id: string | undefined;
  try {
    if (url.length > 2048) throw new Error();
    const link = new URL(url.trim());
    if (
      link.origin === "https://drive.google.com" &&
      !link.username &&
      !link.password
    ) {
      id = link.pathname.match(
        /^\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{1,150})\/?$/,
      )?.[1];
    }
  } catch {
    // Invalid URLs use the same message as unsupported Drive links.
  }
  if (!id)
    throw new DriveFolderError("Pegá un enlace de carpeta de Google Drive.");
  return id;
}

export async function validateDriveFolder(url: string) {
  const id = parseFolderUrl(url);
  const { root, children } = await readCampaignRoot(id);
  const unavailable = campaignFolders.filter((name) => {
    const matches = children.filter((file) => isCampaignFolder(file, name));
    return matches.length !== 1 || !matches[0].capabilities?.canListChildren;
  });
  if (unavailable.length)
    throw new DriveFolderError(
      `Verificá que la carpeta tenga una subcarpeta accesible por cada nombre: ${unavailable.join(", ")}.`,
    );
  return { name: root.name, driveFolderId: root.id };
}

export async function listDriveCampaign(
  id: string,
  selection: SourceSelection = {},
) {
  const { root, children } = await readCampaignRoot(id);
  const notices: string[] = [];
  const results = await Promise.allSettled(
    campaignFolders.map(async (name) => {
      const folder = findCampaignFolder(children, name);
      const files = await listDriveFolder(folder.id);
      return {
        folderId: folder.id,
        files: files.sort((a, b) => a.name.localeCompare(b.name, "es")),
      };
    }),
  );
  const [resources, editables, deployment] = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`QA Visual: ${campaignFolders[index]}`, result.reason);
    notices.push(`No se pudo leer ${campaignFolders[index]} en Google Drive.`);
    return null;
  });

  const matrices = matrixCandidates(resources?.files ?? []);
  const csvCandidates = csvCandidatesOf(editables?.files ?? []);
  const matrix = pick(matrices, selection.excelFileId);
  const csv = pick(csvCandidates, selection.csvFileId);
  if (resources && !matrix)
    notices.push(
      matrices.length
        ? selection.excelFileId
          ? "La matriz elegida ya no está en RECURSOS. Elegí cuál usar desde «Elegir fuentes»."
          : "Hay más de una matriz Excel en RECURSOS. Elegí cuál usar desde «Elegir fuentes»."
        : "No se encontró una matriz Excel en RECURSOS.",
    );
  if (editables && !csv)
    notices.push(
      csvCandidates.length
        ? selection.csvFileId
          ? "El CSV elegido ya no está en EDITABLES. Elegí cuál usar desde «Elegir fuentes»."
          : "Hay más de un CSV candidato en EDITABLES. Elegí cuál usar desde «Elegir fuentes»."
        : "No se encontró el CSV de producción en EDITABLES.",
    );

  const pieces: QaPieceFile[] = [];
  // Same-name files are kept (§6.1): the oldest keeps the base identity.
  const images = (deployment?.files ?? [])
    .filter((file) => file.version && imageMime(file))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "es") ||
        (Date.parse(a.createdTime ?? "") || 0) -
          (Date.parse(b.createdTime ?? "") || 0) ||
        a.id.localeCompare(b.id),
    );
  for (const file of images) {
    if (!file.version) continue;
    const contentHash =
      file.md5Checksum ??
      createHash("sha256")
        .update(await downloadDriveFile(file, imageLimit))
        .digest("hex");
    pieces.push({
      ...toQaFile(file),
      driveId: file.id,
      driveVersion: file.version,
      contentHash,
    });
  }

  const inventory: QaInventory = {
    campaignName: root.name,
    matrix: matrix && toQaFile(matrix),
    csv: csv && toQaFile(csv),
    pieces,
    notices,
  };
  const needsSources = Boolean(
    (resources && matrices.length && !matrix) ||
    (editables && csvCandidates.length && !csv),
  );
  return {
    folderId: root.id,
    inventory,
    matrix,
    csv,
    deployment,
    needsSources,
  };
}

export async function loadDriveCsv(csv: DriveFile) {
  const bytes = await downloadDriveFile(csv, csvLimit);
  return parseDriveCsv(bytes);
}

export function parseDriveCsv(bytes: Buffer) {
  let text: string, encodingNotice: string | undefined;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
    encodingNotice =
      "El CSV usa Windows-1252; se convirtió a UTF-8 para interpretar sus datos.";
  }
  return { bytes, production: productionByPiece(text), encodingNotice };
}

export async function loadDriveMatrix(matrix: DriveFile) {
  return parseClientMatrix(
    matrix.name,
    await downloadDriveFile(matrix, matrixLimit),
  );
}
