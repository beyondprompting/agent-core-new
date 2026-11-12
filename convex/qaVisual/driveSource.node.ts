import { createHash } from "node:crypto";
import { pieceKey } from "./model/normalize";
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

export class DriveFolderError extends Error {}

export async function validateDriveFolder(url: string) {
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

  const { root, children } = await readCampaignRoot(id);
  const unavailable = campaignFolders.filter((name) => {
    const matches = children.filter(
      (file) => file.name === name && file.mimeType === folderMime,
    );
    return matches.length !== 1 || !matches[0].capabilities?.canListChildren;
  });
  if (unavailable.length)
    throw new DriveFolderError(
      `Verificá que la carpeta tenga una subcarpeta accesible por cada nombre: ${unavailable.join(", ")}.`,
    );
  return { name: root.name, driveFolderId: root.id };
}

export async function listDriveCampaign(id: string) {
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

  const matrices =
    resources?.files.filter(
      (file) => !file.name.startsWith("~$") && /\.xlsx$/i.test(file.name),
    ) ?? [];
  const csvFiles =
    editables?.files.filter(
      (file) => !file.name.startsWith("~$") && /\.csv$/i.test(file.name),
    ) ?? [];
  const converted = csvFiles.filter((file) =>
    /_CONVERTED(?:_v\d+)?\.csv$/i.test(file.name),
  );
  const csvCandidates = converted.length
    ? converted
    : csvFiles.filter((file) => !/^_?BUILDER(?:_|\.)/i.test(file.name));
  const matrix = matrices.length === 1 ? matrices[0] : null;
  const csv = csvCandidates.length === 1 ? csvCandidates[0] : null;
  if (resources && !matrix)
    notices.push(
      matrices.length
        ? "Hay más de una matriz Excel en RECURSOS."
        : "No se encontró una matriz Excel en RECURSOS.",
    );
  if (editables && !csv)
    notices.push(
      csvCandidates.length
        ? "Hay más de un CSV candidato en EDITABLES."
        : "No se encontró el CSV de producción en EDITABLES.",
    );

  const pieces: QaPieceFile[] = [];
  const names = new Set<string>();
  for (const file of deployment?.files ?? []) {
    if (!file.version || !imageMime(file)) continue;
    if (names.has(pieceKey(file.name)))
      throw new Error("Hay piezas con nombres duplicados en DESPLIEGUE.");
    names.add(pieceKey(file.name));
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
  return { folderId: root.id, inventory, matrix, csv, deployment };
}

export async function loadDriveCsv(csv: DriveFile) {
  const bytes = await downloadDriveFile(csv, csvLimit);
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
