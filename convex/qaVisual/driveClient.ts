"use node";

import { createHash, createSign, randomUUID } from "node:crypto";
import { normalize } from "./model/normalize";

const tokenUrl = "https://oauth2.googleapis.com/token";
const driveUrl = "https://www.googleapis.com/drive/v3/files";
const fields =
  "id,name,mimeType,size,createdTime,modifiedTime,version,md5Checksum,parents,trashed,capabilities(canListChildren,canAddChildren,canEdit),shortcutDetails(targetId,targetMimeType),imageMediaMetadata(width,height)";
export const folderMime = "application/vnd.google-apps.folder";
/** Roles of the campaign subfolders. DESPLIEGUE also accepts the name VISUALES. */
export const campaignFolders = ["RECURSOS", "EDITABLES", "DESPLIEGUE"] as const;
export type CampaignFolder = (typeof campaignFolders)[number];
export const campaignFolderNames: Record<CampaignFolder, readonly string[]> = {
  RECURSOS: ["RECURSOS"],
  EDITABLES: ["EDITABLES"],
  DESPLIEGUE: ["DESPLIEGUE", "VISUALES"],
};
export const matrixLimit = 15 * 1024 * 1024;
export const csvLimit = 2 * 1024 * 1024;
export const imageLimit = 20 * 1024 * 1024;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  version?: string;
  md5Checksum?: string;
  parents?: string[];
  trashed?: boolean;
  capabilities?: {
    canListChildren?: boolean;
    canAddChildren?: boolean;
    canEdit?: boolean;
  };
  shortcutDetails?: { targetId: string; targetMimeType: string };
  imageMediaMetadata?: { width?: number; height?: number };
};
type ServiceAccount = { client_email: string; private_key: string };

const readScope = "https://www.googleapis.com/auth/drive.readonly";
// Only used to save a generated or corrected CSV; Drive still enforces the folder's sharing (Editor).
const writeScope = "https://www.googleapis.com/auth/drive";
const tokens = new Map<string, { value: string; expiresAt: number }>();
const pendingTokens = new Map<string, Promise<string>>();

async function issueToken(scope: string) {
  let account: ServiceAccount;
  try {
    account = JSON.parse(
      process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    );
    if (!account?.client_email || !account.private_key) throw new Error();
  } catch {
    throw new Error(
      "La cuenta de servicio de QA Visual no está configurada en Convex.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = encode({
    iss: account.client_email,
    scope,
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.private_key, "base64url");
  const response = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Google rechazó la autenticación de QA Visual (HTTP ${response.status}).`,
    );
  const result: { access_token: string; expires_in: number } =
    await response.json();
  const issued = {
    value: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  tokens.set(scope, issued);
  return issued.value;
}

function scopedToken(scope: string) {
  const cached = tokens.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000)
    return Promise.resolve(cached.value);
  let pending = pendingTokens.get(scope);
  if (!pending) {
    pending = issueToken(scope).finally(() => pendingTokens.delete(scope));
    pendingTokens.set(scope, pending);
  }
  return pending;
}

export function driveToken() {
  return scopedToken(readScope);
}

async function request(url: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${await driveToken()}` },
    signal: AbortSignal.timeout(30_000),
  });
}

export class DriveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}

async function check(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  const reason: unknown = body?.error?.errors?.[0]?.reason;
  const detail =
    typeof reason === "string" && /^[a-zA-Z0-9_]+$/.test(reason)
      ? ` · ${reason}`
      : "";
  throw new DriveRequestError(
    `Google Drive respondió HTTP ${response.status}${detail}.`,
    response.status,
    detail ? (reason as string) : undefined,
  );
}

export function driveContentUrl(id: string) {
  return `${driveUrl}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
}

export async function getDriveFile(id: string): Promise<DriveFile | null> {
  const response = await request(
    `${driveUrl}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
  );
  if (response.status === 404) return null;
  await check(response);
  return response.json();
}

export async function listDriveFolder(id: string) {
  const files: DriveFile[] = [];
  const params = new URLSearchParams({
    q: `'${id}' in parents and trashed = false`,
    fields: `nextPageToken,files(${fields})`,
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  do {
    const response = await request(`${driveUrl}?${params}`);
    await check(response);
    const page: { files: DriveFile[]; nextPageToken?: string } =
      await response.json();
    files.push(...page.files);
    if (!page.nextPageToken) return files;
    params.set("pageToken", page.nextPageToken);
  } while (true);
}

export async function downloadDriveFile(file: DriveFile, maxBytes: number) {
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes)
    throw new Error(
      "El archivo de Drive supera el tamaño admitido o está vacío.",
    );
  const response = await request(driveContentUrl(file.id));
  await check(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length !== size ||
    (file.md5Checksum &&
      createHash("md5").update(bytes).digest("hex") !== file.md5Checksum)
  )
    throw new Error("El archivo de Drive cambió durante la lectura.");
  return bytes;
}

/** Uploads a new file. Requires the service account to be Editor of the folder. */
export async function createDriveFile(
  folderId: string,
  name: string,
  mimeType: string,
  bytes: Buffer,
): Promise<DriveFile> {
  const boundary = `qa-visual-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        { name, mimeType, parents: [folderId] },
      )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const params = new URLSearchParams({
    uploadType: "multipart",
    supportsAllDrives: "true",
    fields,
  });
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?${params}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await scopedToken(writeScope)}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  await check(response);
  return response.json();
}

/**
 * Replaces the content of an existing file (a new revision: Drive keeps the previous ones in
 * «Administrar versiones»). Requires the service account to be Editor of the file. When
 * `expectedVersion` is given, the write is refused if the file changed since it was read.
 */
export async function updateDriveFileContent(
  file: DriveFile,
  bytes: Buffer,
  expectedVersion?: string,
): Promise<DriveFile> {
  if (expectedVersion) {
    const current = await getDriveFile(file.id);
    if (current?.version !== expectedVersion)
      throw new DriveRequestError(
        "El archivo cambió en Drive desde que se leyó.",
        409,
        "versionChanged",
      );
  }
  const params = new URLSearchParams({
    uploadType: "media",
    supportsAllDrives: "true",
    fields,
  });
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?${params}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${await scopedToken(writeScope)}`,
        "Content-Type": file.mimeType || "text/csv",
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
    },
  );
  await check(response);
  return response.json();
}

const isFolder = (file: DriveFile) =>
  file.mimeType === folderMime ||
  file.shortcutDetails?.targetMimeType === folderMime;

/**
 * Folder names are compared without case, accents or extra spaces ("Despliegue " = "DESPLIEGUE").
 * DESPLIEGUE also matches a folder called VISUALES.
 */
export function isCampaignFolder(file: DriveFile, role: CampaignFolder) {
  return (
    isFolder(file) && campaignFolderNames[role].includes(normalize(file.name))
  );
}

export function isDriveFolder(file: DriveFile) {
  return isFolder(file);
}

export async function resolveFolderShortcut(file: DriveFile | null) {
  const seen = new Set<string>();
  while (file?.mimeType === "application/vnd.google-apps.shortcut") {
    if (
      file.trashed ||
      !file.shortcutDetails ||
      file.shortcutDetails.targetMimeType !== folderMime ||
      seen.has(file.id) ||
      seen.size >= 4
    )
      return null;
    seen.add(file.id);
    file = await getDriveFile(file.shortcutDetails.targetId);
  }
  return file;
}
