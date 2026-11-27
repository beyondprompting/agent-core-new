import { createHash } from "node:crypto";
import type {
  QaFile,
  QaInventory,
  QaPieceFile,
} from "../../app/lib/qa-visual/source";
import { productionByPiece } from "./model/productionCsv";
import { buildProductionCsv } from "./model/productionCsvBuilder";
import { normalize } from "./model/normalize";
import type { LinkOverride } from "./model/contracts";
import {
  mappingReport,
  type MappingImage,
  type MappingReport,
} from "./model/mapping";
import { parseClientMatrix } from "./clientMatrix.node";
import {
  campaignFolders,
  createDriveFile,
  DriveRequestError,
  resolveFolderShortcut,
  csvLimit,
  downloadDriveFile,
  folderMime,
  isCampaignFolder,
  isDriveFolder,
  getDriveFile,
  listDriveFolder,
  matrixLimit,
  imageLimit,
  type CampaignFolder,
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
  if (
    ["image/png", "image/jpeg"].includes(file.mimeType) &&
    /\.png$/i.test(file.name)
  )
    return "image/png";
  if (
    ["image/png", "image/jpeg"].includes(file.mimeType) &&
    /\.jpe?g$/i.test(file.name)
  )
    return "image/jpeg";
  return null;
}

async function readCampaignRoot(id: string) {
  const root = await resolveFolderShortcut(await getDriveFile(id));
  if (!root)
    throw new DriveRequestError(
      "No tenemos acceso a la carpeta. Compartila como Lector con la cuenta de servicio de QA Visual.",
      404,
    );
  if (root.trashed)
    throw new DriveFolderError("La carpeta está en la papelera de Drive.");
  if (root.mimeType !== folderMime)
    throw new DriveFolderError(
      "El enlace es de un archivo; pegá el de la carpeta de la campaña.",
    );
  if (!root.capabilities?.canListChildren)
    throw new DriveRequestError(
      "No tenemos acceso a la carpeta. Compartila como Lector con la cuenta de servicio de QA Visual.",
      403,
    );
  return { root, children: await listDriveFolder(root.id) };
}

export class DriveFolderError extends Error {
  constructor(
    message: string,
    readonly code?: "sources" | "csv_missing",
  ) {
    super(message);
  }
}

export type SourceSelection = {
  excelFileId?: string;
  csvFileId?: string;
  /** Folders chosen by the user when the campaign does not use the usual names. */
  resourcesFolderId?: string;
  editablesFolderId?: string;
  deploymentFolderId?: string;
};

function matrixCandidates(files: DriveFile[]) {
  return files.filter(
    (file) => !file.name.startsWith("~$") && /\.xlsx$/i.test(file.name),
  );
}
function unsupportedMatrix(files: DriveFile[]) {
  return files.some(
    (f) =>
      /\.xls$/i.test(f.name) ||
      f.mimeType === "application/vnd.google-apps.spreadsheet",
  );
}
/** Every CSV of the production folder is a candidate, whatever its name (like the matrices). */
function csvCandidatesOf(files: DriveFile[]) {
  return files.filter(
    (file) => !file.name.startsWith("~$") && /\.csv$/i.test(file.name),
  );
}
function pick(candidates: DriveFile[], chosen?: string) {
  if (chosen) return candidates.find((file) => file.id === chosen) ?? null;
  if (candidates.length === 1) return candidates[0];
  return null;
}

export type FolderCheck = {
  key: "folder" | CampaignFolder | "ignored";
  status: "ok" | "missing" | "choose" | "info";
  title: string;
  detail?: string;
  /** Folder used for this source, preselected in the folder picker. */
  folderId?: string;
};
export type FolderOption = { id: string; name: string };
export type FolderInspection =
  | { ok: false; error: string }
  | {
      ok: boolean;
      folder: { id: string; name: string };
      checks: FolderCheck[];
      /** Folders the user can pick for each source: the shared folder and two levels below. */
      folders: FolderOption[];
      matrices: { id: string; name: string }[];
      csvs: { id: string; name: string }[];
      images: number;
      selection: SourceSelection;
      /** No CSV in the production folder and a matrix is chosen: QA Visual can generate it. */
      canCreateCsv: boolean;
      csvFolder?: { id: string; name: string; canWrite: boolean };
      /** Pieces ↔ CSV ↔ matrix check, once the three sources are found (§5.5). */
      mapping?: FolderMapping;
    };

/** Keys of {@link SourceSelection} that pin the folder of each source. */
export const folderSelectionKey = {
  RECURSOS: "resourcesFolderId",
  EDITABLES: "editablesFolderId",
  DESPLIEGUE: "deploymentFolderId",
} as const satisfies Record<CampaignFolder, keyof SourceSelection>;
const roleName: Record<CampaignFolder, string> = {
  RECURSOS: "RECURSOS",
  EDITABLES: "EDITABLES",
  DESPLIEGUE: "DESPLIEGUE o VISUALES",
};
const roleContent: Record<CampaignFolder, string> = {
  RECURSOS: "la matriz Excel",
  EDITABLES: "el CSV de producción",
  DESPLIEGUE: "las piezas a revisar",
};

type RoleFolder =
  | {
      ok: true;
      id: string;
      name: string;
      chosen: boolean;
      canAddChildren: boolean;
    }
  | {
      ok: false;
      problem:
        | "missing"
        | "ambiguous"
        | "unreadable"
        | "trashed"
        | "chosen_gone";
      count?: number;
    };

const byName = (a: DriveFile, b: DriveFile) =>
  a.name.localeCompare(b.name, "es");

/** Folder listings are shared when the same folder holds more than one source. */
function folderLister() {
  const cache = new Map<string, Promise<DriveFile[]>>();
  return (id: string) => {
    let files = cache.get(id);
    if (!files) {
      files = listDriveFolder(id).then((list) => list.sort(byName));
      cache.set(id, files);
    }
    return files;
  };
}

async function openFolder(
  file: DriveFile,
): Promise<DriveFile | "unreadable" | "trashed"> {
  let folder: DriveFile | null;
  try {
    folder = await resolveFolderShortcut(file);
  } catch {
    return "unreadable";
  }
  if (folder?.trashed) return "trashed";
  if (folder?.mimeType !== folderMime || !folder.capabilities?.canListChildren)
    return "unreadable";
  return folder;
}

/**
 * Finds the folder of a source. A folder chosen by the user wins; it must be the shared folder,
 * one of its subfolders or a folder inside one of them, so a campaign never reads outside its
 * own tree. Without a choice, the subfolder is found by its name (RECURSOS, EDITABLES,
 * DESPLIEGUE or VISUALES).
 */
async function resolveRoleFolder(
  root: DriveFile,
  children: DriveFile[],
  role: CampaignFolder,
  chosenId?: string,
): Promise<RoleFolder> {
  const found = (folder: DriveFile, chosen: boolean, name: string) => ({
    ok: true as const,
    id: folder.id,
    name,
    chosen,
    canAddChildren: Boolean(folder.capabilities?.canAddChildren),
  });
  const subfolders = children.filter(isDriveFolder);
  if (chosenId) {
    if (chosenId === root.id) return found(root, true, root.name);
    let candidate = subfolders.find(
      (f) => f.id === chosenId || f.shortcutDetails?.targetId === chosenId,
    );
    let label = candidate?.name;
    if (!candidate) {
      let file: DriveFile | null = null;
      try {
        file = await getDriveFile(chosenId);
      } catch (error) {
        if (
          !(error instanceof DriveRequestError) ||
          ![403, 404].includes(error.status)
        )
          throw error;
      }
      const parent =
        file &&
        subfolders.find((f) =>
          file.parents?.includes(f.shortcutDetails?.targetId ?? f.id),
        );
      if (file && parent && isDriveFolder(file)) {
        candidate = file;
        label = `${parent.name} / ${file.name}`;
      }
    }
    if (!candidate) return { ok: false, problem: "chosen_gone" };
    const folder = await openFolder(candidate);
    if (typeof folder === "string") return { ok: false, problem: folder };
    return found(folder, true, label!);
  }
  const matches = subfolders.filter((file) => isCampaignFolder(file, role));
  if (matches.length !== 1)
    return {
      ok: false,
      problem: matches.length ? "ambiguous" : "missing",
      count: matches.length,
    };
  const folder = await openFolder(matches[0]);
  if (typeof folder === "string") return { ok: false, problem: folder };
  return found(folder, false, matches[0].name);
}

function folderProblem(
  role: CampaignFolder,
  result: Extract<RoleFolder, { ok: false }>,
) {
  const content = roleContent[role];
  switch (result.problem) {
    case "missing":
      return {
        title: `No se encontró la carpeta ${roleName[role]}`,
        detail: `Elegí la carpeta donde está ${content}.`,
      };
    case "ambiguous":
      return {
        title: `Hay ${result.count} carpetas ${roleName[role]}`,
        detail: `Elegí cuál tiene ${content}.`,
      };
    case "chosen_gone":
      return {
        title: `La carpeta elegida para ${content} ya no está disponible`,
        detail: "Elegí otra carpeta de la campaña.",
      };
    case "trashed":
      return {
        title: `La carpeta de ${content} está en la papelera de Drive`,
        detail: "Restaurala o elegí otra carpeta.",
      };
    default:
      return {
        title: `No se puede leer la carpeta de ${content}`,
        detail:
          "Revisá que esté compartida con la cuenta de servicio o elegí otra carpeta.",
      };
  }
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size)
    results.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return results;
}

async function folderOptions(
  root: DriveFile,
  children: DriveFile[],
  list: (id: string) => Promise<DriveFile[]>,
): Promise<FolderOption[]> {
  const options: FolderOption[] = [
    { id: root.id, name: `${root.name} (carpeta compartida)` },
  ];
  const subfolders = children.filter(isDriveFolder).sort(byName).slice(0, 60);
  const nested = await inBatches(subfolders, 8, async (folder) => {
    const id = folder.shortcutDetails?.targetId ?? folder.id;
    const files = await list(id).catch(() => [] as DriveFile[]);
    return {
      folder,
      id,
      inner: files.filter((f) => f.mimeType === folderMime),
    };
  });
  for (const { folder, id, inner } of nested) {
    options.push({ id, name: folder.name });
    for (const sub of inner.slice(0, 40))
      options.push({ id: sub.id, name: `${folder.name} / ${sub.name}` });
  }
  return options.slice(0, 300);
}

export async function readFolderState(url: string, selection: SourceSelection) {
  let id: string;
  try {
    id = parseFolderUrl(url);
  } catch (error) {
    return { error: (error as Error).message };
  }
  let root: DriveFile, children: DriveFile[];
  try {
    ({ root, children } = await readCampaignRoot(id));
  } catch (error) {
    if (error instanceof DriveFolderError) return { error: error.message };
    if (error instanceof DriveRequestError && [403, 404].includes(error.status))
      return {
        error:
          "No tenemos acceso. Compartí la carpeta como Lector con la cuenta de servicio de QA Visual.",
      };
    throw error;
  }
  const list = folderLister();
  const roles = {} as Record<CampaignFolder, RoleFolder>;
  const listings = new Map<CampaignFolder, DriveFile[]>();
  await Promise.all(
    campaignFolders.map(async (role) => {
      const result = await resolveRoleFolder(
        root,
        children,
        role,
        selection[folderSelectionKey[role]],
      );
      roles[role] = result;
      if (!result.ok) return;
      try {
        listings.set(role, await list(result.id));
      } catch {
        roles[role] = { ok: false, problem: "unreadable" };
      }
    }),
  );
  const matrices = matrixCandidates(listings.get("RECURSOS") ?? []);
  const csvs = csvCandidatesOf(listings.get("EDITABLES") ?? []);
  const deployment = listings.get("DESPLIEGUE") ?? [];
  return {
    root,
    children,
    list,
    roles,
    listings,
    matrices,
    csvs,
    deployment,
    matrix: pick(matrices, selection.excelFileId),
    csv: pick(csvs, selection.csvFileId),
  };
}

/** Read-only preview used by the two-step registration dialog. Nothing is written. */
export async function inspectDriveFolder(
  url: string,
  selection: SourceSelection = {},
  excluded: Set<string> = new Set(),
  overrides: LinkOverride[] = [],
): Promise<FolderInspection> {
  const state = await readFolderState(url, selection);
  if ("error" in state) return { ok: false, error: state.error! };
  const { root, roles, listings, matrices, csvs, deployment, matrix, csv } =
    state;
  const checks: FolderCheck[] = [
    {
      key: "folder",
      status: "ok",
      title: root.name,
      detail:
        "Accesible para QA Visual. Solo se escribe en Drive si pedís crear o corregir el CSV de producción; la matriz del cliente nunca se modifica.",
    },
  ];
  for (const role of campaignFolders) {
    const result = roles[role];
    if (!result.ok)
      checks.push({
        key: role,
        status:
          result.problem === "unreadable" || result.problem === "trashed"
            ? "missing"
            : "choose",
        ...folderProblem(role, result),
      });
  }
  const images = deployment.filter((file) => file.version && imageMime(file));
  const editables = roles.EDITABLES.ok ? roles.EDITABLES : undefined;
  const canCreateCsv = Boolean(
    editables && listings.has("EDITABLES") && !csvs.length && matrix,
  );
  const named = (role: CampaignFolder) => {
    const result = roles[role];
    return result.ok ? result.name : roleName[role];
  };
  const folderId = (role: CampaignFolder) => {
    const result = roles[role];
    return result.ok ? result.id : undefined;
  };
  if (listings.has("RECURSOS"))
    checks.push({
      key: "RECURSOS",
      folderId: folderId("RECURSOS"),
      ...(matrices.length === 0
        ? {
            status: "missing" as const,
            title: `${named("RECURSOS")} · falta la matriz Excel`,
            detail: unsupportedMatrix(listings.get("RECURSOS") ?? [])
              ? "Formato no admitido: convertí la matriz a .xlsx."
              : "Subí la matriz del cliente en formato .xlsx o elegí otra carpeta.",
          }
        : matrix
          ? {
              status: "ok" as const,
              title: `${named("RECURSOS")} · matriz del cliente`,
              detail: matrix.name,
            }
          : {
              status: "choose" as const,
              title: selection.excelFileId
                ? `${named("RECURSOS")} · la matriz elegida ya no está disponible`
                : `${named("RECURSOS")} · ${matrices.length} matrices Excel`,
              detail: "Elegí la que corresponde al pedido de esta campaña.",
            }),
    });
  if (listings.has("EDITABLES"))
    checks.push({
      key: "EDITABLES",
      folderId: folderId("EDITABLES"),
      ...(csvs.length === 0
        ? {
            status: "missing" as const,
            title: `${named("EDITABLES")} · falta el CSV de producción`,
            detail: canCreateCsv
              ? "Podés crearlo a partir de la matriz: QA Visual arma una fila por pedido y lo guarda en esta carpeta."
              : "Subí el CSV de producción. También se puede crear desde la matriz cuando esté elegida.",
          }
        : csv
          ? {
              status: "ok" as const,
              title: `${named("EDITABLES")} · CSV de producción`,
              detail: csv.name,
            }
          : {
              status: "choose" as const,
              title: selection.csvFileId
                ? `${named("EDITABLES")} · el CSV elegido ya no está disponible`
                : `${named("EDITABLES")} · ${csvs.length} CSV`,
              detail: "Elegí el CSV de producción de esta campaña.",
            }),
    });
  if (listings.has("DESPLIEGUE"))
    checks.push({
      key: "DESPLIEGUE",
      folderId: folderId("DESPLIEGUE"),
      ...(images.length
        ? {
            status:
              images.length > 1000 ? ("missing" as const) : ("ok" as const),
            title: `${named("DESPLIEGUE")} · ${images.length} ${images.length === 1 ? "imagen" : "imágenes"} PNG o JPEG`,
            detail:
              images.length > 1000
                ? "Supera el límite de 1000 piezas por campaña."
                : "Se preparan miniaturas e imágenes de análisis después de importar.",
          }
        : {
            status: "info" as const,
            title: `${named("DESPLIEGUE")} · todavía no hay imágenes`,
            detail:
              "Podés registrar la campaña igual; las piezas aparecen al actualizar desde Drive.",
          }),
    });
  const ignored = deployment.filter(
    (file) => !(file.version && imageMime(file)),
  );
  if (ignored.length)
    checks.push({
      key: "ignored",
      status: "info",
      title: `${ignored.length} ${ignored.length === 1 ? "archivo" : "archivos"} de ${named("DESPLIEGUE")} no se analizan`,
      detail:
        "Solo se revisan imágenes PNG y JPEG. Las subcarpetas y otros formatos se ignoran.",
    });
  const chosenFolders: SourceSelection = {};
  for (const role of campaignFolders) {
    const result = roles[role];
    if (result.ok && result.chosen)
      chosenFolders[folderSelectionKey[role]] = result.id;
  }
  return {
    ok:
      checks.every(
        (check) => check.status === "ok" || check.status === "info",
      ) && images.length <= 1000,
    folder: { id: root.id, name: root.name },
    checks,
    folders: await folderOptions(root, state.children, state.list),
    matrices: matrices.map(({ id, name }) => ({ id, name })),
    csvs: csvs.map(({ id, name }) => ({ id, name })),
    images: images.length,
    selection: {
      ...chosenFolders,
      ...(matrix ? { excelFileId: matrix.id } : {}),
      ...(csv ? { csvFileId: csv.id } : {}),
    },
    canCreateCsv,
    mapping: await folderMapping(state, excluded, overrides),
    ...(editables
      ? {
          csvFolder: {
            id: editables.id,
            name: editables.name,
            canWrite: editables.canAddChildren,
          },
        }
      : {}),
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
  const { root } = await readCampaignRoot(id);
  return { name: root.name, driveFolderId: root.id };
}

/** Message stored on the campaign when a source folder cannot be resolved during a sync. */
function folderNotice(
  role: CampaignFolder,
  result: Extract<RoleFolder, { ok: false }>,
) {
  const { title, detail } = folderProblem(role, result);
  return result.problem === "unreadable" || result.problem === "trashed"
    ? `${title}. ${detail}`
    : `${title}. ${detail.replace(/\.$/, "")} desde «Elegir fuentes».`;
}

export async function listDriveCampaign(
  id: string,
  selection: SourceSelection = {},
  strict = false,
) {
  const { root, children } = await readCampaignRoot(id);
  const notices: string[] = [];
  let folderNeedsSources = false;
  const list = folderLister();
  const results = await Promise.allSettled(
    campaignFolders.map(async (role) => {
      const result = await resolveRoleFolder(
        root,
        children,
        role,
        selection[folderSelectionKey[role]],
      );
      if (!result.ok) {
        const message = folderNotice(role, result);
        if (result.problem === "unreadable")
          throw new DriveRequestError(message, 403);
        throw new DriveFolderError(
          message,
          result.problem === "trashed" ? undefined : "sources",
        );
      }
      return {
        folderId: result.id,
        name: result.name,
        files: await list(result.id),
      };
    }),
  );
  const [resources, editables, deployment] = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    if (strict) throw result.reason;
    console.warn(`QA Visual: ${campaignFolders[index]}`, result.reason);
    if (
      result.reason instanceof DriveFolderError &&
      result.reason.code === "sources"
    )
      folderNeedsSources = true;
    notices.push(
      result.reason instanceof DriveFolderError ||
        result.reason instanceof DriveRequestError
        ? result.reason.message
        : `No se pudo leer ${roleName[campaignFolders[index]]} en Google Drive.`,
    );
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
          ? `La matriz elegida ya no está en «${resources.name}». Elegí cuál usar desde «Elegir fuentes».`
          : `Hay más de una matriz Excel en «${resources.name}». Elegí cuál usar desde «Elegir fuentes».`
        : unsupportedMatrix(resources.files)
          ? "Formato no admitido: convertí la matriz a .xlsx."
          : `No se encontró una matriz Excel en «${resources.name}». Subila o elegí otra carpeta desde «Elegir fuentes».`,
    );
  if (editables && !csv)
    notices.push(
      csvCandidates.length
        ? selection.csvFileId
          ? `El CSV elegido ya no está en «${editables.name}». Elegí cuál usar desde «Elegir fuentes».`
          : `Hay más de un CSV en «${editables.name}». Elegí cuál usar desde «Elegir fuentes».`
        : `No se encontró el CSV de producción en «${editables.name}». Podés crearlo a partir de la matriz desde «Elegir fuentes».`,
    );

  if (strict && editables && !csvCandidates.length)
    throw new DriveFolderError(
      `No se encontró el CSV de producción en «${editables.name}». Podés crearlo a partir de la matriz desde «Elegir fuentes».`,
      "csv_missing",
    );
  const pieces = await deploymentPieces(deployment?.files ?? []);

  const inventory: QaInventory = {
    campaignName: root.name,
    matrix: matrix && toQaFile(matrix),
    csv: csv && toQaFile(csv),
    pieces,
    notices,
  };
  const needsSources = Boolean(
    folderNeedsSources ||
    (resources && !matrix && !unsupportedMatrix(resources.files)) ||
    (editables && !csv),
  );
  return {
    folderId: root.id,
    ignoredFiles: (deployment?.files ?? [])
      .filter((file) => !imageMime(file))
      .map((file) => ({
        name: file.name,
        reason:
          file.mimeType === folderMime
            ? "Subcarpeta: no se recorren sus archivos."
            : "Solo se analizan PNG y JPEG.",
      })),
    inventory,
    matrix,
    csv,
    deployment: deployment && {
      folderId: deployment.folderId,
      files: deployment.files,
    },
    needsSources,
  };
}

export type CsvCreation = {
  error?: string;
  created?: {
    id: string;
    name: string;
    orders: number;
    assigned: number;
    unassigned: number;
  };
  /** When Drive refuses the upload, the browser can still download the file. */
  download?: {
    name: string;
    content: string;
    orders: number;
    assigned: number;
    unassigned: number;
  };
};

function csvWriteError(error: DriveRequestError, folder: string) {
  if (error.reason === "storageQuotaExceeded")
    return `Google no deja que la cuenta de servicio guarde archivos propios en «Mi unidad». Descargá el CSV y subilo a «${folder}», o usá una unidad compartida.`;
  if (error.status === 403 || error.status === 404)
    return `La cuenta de servicio no puede escribir en «${folder}». Compartí esa carpeta como Editor o descargá el CSV y subilo manualmente.`;
  return `Google Drive no aceptó el archivo (HTTP ${error.status}). Podés descargar el CSV y subirlo manualmente.`;
}

/**
 * Creates the production CSV from the chosen matrix and saves it in the production folder
 * (EDITABLES or the folder the user chose). The only write QA Visual makes in Drive.
 */
export async function createProductionCsv(
  url: string,
  selection: SourceSelection = {},
): Promise<CsvCreation> {
  const state = await readFolderState(url, selection);
  if ("error" in state) return { error: state.error };
  const folder = state.roles.EDITABLES;
  if (!folder.ok || !state.listings.has("EDITABLES"))
    return { error: "Primero elegí la carpeta donde guardar el CSV." };
  if (state.csvs.length)
    return {
      error: `«${folder.name}» ya tiene un CSV de producción. Elegilo en la lista.`,
    };
  if (!state.matrix)
    return {
      error:
        "Primero elegí la matriz Excel: el CSV se arma a partir de sus pedidos.",
    };
  const matrix = await loadDriveMatrix(state.matrix);
  const built = buildProductionCsv(
    matrix,
    state.deployment
      .filter((file) => file.version && imageMime(file))
      .map((file) => ({
        name: file.name,
        width: file.imageMediaMetadata?.width,
        height: file.imageMediaMetadata?.height,
      })),
  );
  if (!built.orders)
    return {
      error: "No se encontraron pedidos en la pestaña PRODUCCION de la matriz.",
    };
  const bytes = Buffer.from(built.text, "utf8");
  if (bytes.length > csvLimit)
    return { error: "El CSV generado supera el tamaño admitido (2 MiB)." };
  const base =
    normalize(state.root.name).replaceAll(" ", "_").slice(0, 80) || "CAMPANA";
  const summary = {
    name: `${base}_QA_VISUAL.csv`,
    orders: built.orders,
    assigned: built.assigned,
    unassigned: built.unassignedImages.length,
  };
  try {
    const file = await createDriveFile(
      folder.id,
      summary.name,
      "text/csv",
      bytes,
    );
    return { created: { ...summary, id: file.id } };
  } catch (error) {
    if (!(error instanceof DriveRequestError)) throw error;
    console.warn("QA Visual: Drive rechazó el CSV generado", error.message);
    return {
      error: csvWriteError(error, folder.name),
      download: { ...summary, content: built.text },
    };
  }
}

/** Mapping check and CSV repair (§5.5): reading side. */
export type CsvEncoding = "utf-8" | "windows-1252";

export function decodeCsv(bytes: Buffer): {
  text: string;
  encoding: CsvEncoding;
} {
  try {
    // ignoreBOM keeps the BOM in the text, so writing it back keeps the same bytes.
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
    };
  }
}

let cp1252: Map<string, number> | undefined;
export function encodeCsv(text: string, encoding: CsvEncoding) {
  if (encoding === "utf-8") return Buffer.from(text, "utf8");
  if (!cp1252) {
    const decoder = new TextDecoder("windows-1252");
    cp1252 = new Map(
      Array.from({ length: 256 }, (_, byte) => [
        decoder.decode(Uint8Array.of(byte)),
        byte,
      ]),
    );
  }
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = cp1252.get(text[i]);
    if (byte === undefined)
      throw new Error(
        `El CSV usa Windows-1252 y «${text[i]}» no se puede escribir en esa codificación.`,
      );
    bytes[i] = byte;
  }
  return bytes;
}

export const pieceImages = (files: DriveFile[]): MappingImage[] =>
  files
    .filter((file) => file.version && imageMime(file))
    .map((file) => ({
      name: file.name,
      width: file.imageMediaMetadata?.width,
      height: file.imageMediaMetadata?.height,
    }));

type FolderState = Exclude<
  Awaited<ReturnType<typeof readFolderState>>,
  { error: string }
>;

export async function readMappingSources(state: FolderState) {
  if (!state.csv || !state.matrix) return null;
  const [csvBytes, matrix] = await Promise.all([
    downloadDriveFile(state.csv, csvLimit),
    loadDriveMatrix(state.matrix),
  ]);
  return {
    csv: state.csv,
    csvBytes,
    ...decodeCsv(csvBytes),
    matrix,
    images: pieceImages(state.deployment),
  };
}

export type FolderMapping =
  | ({ status: "ready" } & MappingReport & {
        csv: { name: string; canEdit: boolean; version: string };
      })
  | { status: "error"; error: string };

/** Mapping report shown in the folder checklist. Needs the three sources. */
export async function folderMapping(
  state: FolderState,
  excluded: Set<string>,
  overrides: LinkOverride[] = [],
): Promise<FolderMapping | undefined> {
  if (!state.csv || !state.matrix || !state.listings.has("DESPLIEGUE"))
    return undefined;
  try {
    const sources = await readMappingSources(state);
    if (!sources?.images.length) return undefined;
    return {
      status: "ready",
      ...mappingReport({
        images: sources.images,
        csvText: sources.text,
        matrix: sources.matrix,
        excluded,
        overrides,
      }),
      csv: {
        name: sources.csv.name,
        canEdit: Boolean(sources.csv.capabilities?.canEdit),
        version: sources.csv.version ?? "",
      },
    };
  } catch (error) {
    console.warn("QA Visual: no se pudo revisar el mapeo", error);
    return {
      status: "error",
      error:
        error instanceof Error &&
        /CSV|ID_PIEZA|Plantilla|PRODUCCION/.test(error.message)
          ? error.message
          : "No se pudo leer el CSV o la matriz para revisar el mapeo.",
    };
  }
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

export async function deploymentPieces(files: DriveFile[]) {
  const pieces: QaPieceFile[] = [];
  // Same-name files are kept (§6.1): the oldest keeps the base identity.
  const images = files
    .filter((file) => file.version && imageMime(file))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "es") ||
        (Date.parse(a.createdTime ?? "") || 0) -
          (Date.parse(b.createdTime ?? "") || 0) ||
        a.id.localeCompare(b.id),
    );
  if (images.length > 1000)
    throw new DriveFolderError("La campaña supera el límite de 1000 piezas.");
  for (const file of images) {
    if (!file.version) continue;
    const contentHash =
      file.md5Checksum ??
      (Number(file.size) > imageLimit
        ? `oversized:${file.id}:${file.version}`
        : undefined) ??
      createHash("sha256")
        .update(await downloadDriveFile(file, imageLimit))
        .digest("hex");
    pieces.push({
      ...toQaFile(file),
      createdAt: Date.parse(file.createdTime ?? "") || 0,
      mimeType: file.mimeType,
      driveId: file.id,
      driveVersion: file.version,
      contentHash,
    });
  }

  return pieces;
}
