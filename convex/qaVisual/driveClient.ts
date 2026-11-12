"use node";

import { createHash, createSign } from "node:crypto";
import { normalize } from "./model/normalize";

const tokenUrl = "https://oauth2.googleapis.com/token";
const driveUrl = "https://www.googleapis.com/drive/v3/files";
const fields =
  "id,name,mimeType,size,createdTime,modifiedTime,version,md5Checksum,parents,trashed,capabilities(canListChildren)";
export const folderMime = "application/vnd.google-apps.folder";
export const campaignFolders = ["RECURSOS", "EDITABLES", "DESPLIEGUE"] as const;
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
  capabilities?: { canListChildren?: boolean };
};
type ServiceAccount = { client_email: string; private_key: string };

let token: { value: string; expiresAt: number } | undefined;
let pendingToken: Promise<string> | undefined;

async function issueToken() {
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
    scope: "https://www.googleapis.com/auth/drive.readonly",
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
  token = {
    value: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  return token.value;
}

export async function driveToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  pendingToken ??= issueToken().finally(() => {
    pendingToken = undefined;
  });
  return pendingToken;
}

async function request(url: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${await driveToken()}` },
    signal: AbortSignal.timeout(30_000),
  });
}

async function check(response: Response) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  const reason: unknown = body?.error?.errors?.[0]?.reason;
  const detail =
    typeof reason === "string" && /^[a-zA-Z0-9_]+$/.test(reason)
      ? ` · ${reason}`
      : "";
  throw new Error(`Google Drive respondió HTTP ${response.status}${detail}.`);
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

/** Folder names are compared without case, accents or extra spaces ("Despliegue " = "DESPLIEGUE"). */
export function isCampaignFolder(
  file: DriveFile,
  name: (typeof campaignFolders)[number],
) {
  return file.mimeType === folderMime && normalize(file.name) === name;
}

export function findCampaignFolder(
  files: DriveFile[],
  name: (typeof campaignFolders)[number],
) {
  const matches = files.filter((file) => isCampaignFolder(file, name));
  if (matches.length !== 1)
    throw new Error(`Se esperaba una única carpeta ${name} en Google Drive.`);
  return matches[0];
}
