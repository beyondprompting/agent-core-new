import { createHash } from "node:crypto";
import sharp from "sharp";
import { downloadDriveFile, getDriveFile, imageLimit } from "./driveClient";
import { imageMime } from "./driveSource.node";

export async function prepareDriveImage(folderId: string, id: string, version: string) {
  const file = await getDriveFile(id);
  if (!file || file.trashed || !file.parents?.includes(folderId) || file.version !== version || !imageMime(file))
    throw new Error("La pieza cambió o ya no está en DESPLIEGUE.");
  const original = await downloadDriveFile(file, imageLimit);
  const image = sharp(original, { limitInputPixels: 32_000_000 });
  const { width, height, format, orientation } = await image.metadata();
  if (!width || !height || (format !== "png" && format !== "jpeg"))
    throw new Error("La pieza no es una imagen compatible.");
  const render = (size: number, quality: number) =>
    image.clone().rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toBuffer();
  let bytes = await render(1800, 88);
  if (bytes.length > 700_000) bytes = await render(1400, 76);
  if (bytes.length > 750_000) throw new Error("La vista de análisis supera el tamaño admitido.");
  const thumbnail = await image.clone().rotate()
    .resize({ width: 192, height: 192, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  const preview = await image.clone().rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const swapped = orientation !== undefined && orientation >= 5;
  return {
    bytes: Uint8Array.from(bytes).buffer,
    thumbnail: Uint8Array.from(thumbnail).buffer,
    preview: Uint8Array.from(preview).buffer,
    snapshot: {
      hash: createHash("sha256").update(original).digest("hex"),
      width: swapped ? height : width,
      height: swapped ? width : height,
      format,
    },
  };
}
