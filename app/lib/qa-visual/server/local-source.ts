// This adapter is imported only by Next.js server entry points.
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import type { QaFile, QaInventory, QaSource } from "@/app/lib/qa-visual/source";

import { productionByPiece } from "@/app/lib/qa-visual/production-csv";

const folders = {
  resources: "RECURSOS",
  editables: "EDITABLES",
  pieces: "DESPLIEGUE",
};
const imageName = /\.(png|jpe?g)$/i;
function folderNotice(name: string, error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM")
    return `${name}: macOS denegó el acceso al proceso de Next.js. Iniciá el servidor desde una terminal con acceso a la carpeta de Drive.`;
  if (code === "ENOENT" || code === "ENOTDIR")
    return `${name}: no se encontró la carpeta. Verificá que Google Drive para escritorio esté abierto y sincronizado.`;
  return `No se pudo leer ${name}. Revisá que la carpeta esté disponible en Drive para escritorio.`;
}

function selectProductionCsv(files: QaFile[]) {
  const converted = files.filter((file) =>
    /_CONVERTED(?:_v\d+)?\.csv$/i.test(file.name),
  );
  const candidates = converted.length
    ? converted
    : files.filter((file) => !/^_?BUILDER(?:_|\.)/i.test(file.name));
  return {
    file: candidates.length === 1 ? candidates[0] : null,
    ambiguous: candidates.length > 1,
  };
}

export function localQaSource(root: string): QaSource {
  async function folder(name: string) {
    const path = join(await realpath(root), name);
    if ((await realpath(path)) !== path) throw new Error("Invalid folder");
    return path;
  }

  async function files(path: string, matches: (name: string) => boolean) {
    const entries = await readdir(path, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && matches(entry.name))
        .map(async (entry) => {
          try {
            const stat = await lstat(join(path, entry.name));
            return stat.isFile()
              ? { name: entry.name, bytes: stat.size, updatedAt: stat.mtimeMs }
              : null;
          } catch {
            return null;
          }
        }),
    );
    return result
      .filter((file): file is QaFile => file !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  return {
    async list(): Promise<QaInventory> {
      try {
        await realpath(root);
      } catch (error) {
        return {
          matrix: null,
          csv: null,
          pieces: [],
          notices: [folderNotice("Carpeta de la campaña", error)],
        };
      }
      const [resources, editables, pieces] = await Promise.allSettled([
        folder(folders.resources).then((path) =>
          files(
            path,
            (name) => !name.startsWith("~$") && /\.xlsx$/i.test(name),
          ),
        ),
        folder(folders.editables).then((path) =>
          files(path, (name) => !name.startsWith("~$") && /\.csv$/i.test(name)),
        ),
        folder(folders.pieces).then((path) =>
          files(path, (name) => imageName.test(name)),
        ),
      ]);
      const notices: string[] = [];
      const matrices = resources.status === "fulfilled" ? resources.value : [];
      const { file: csv, ambiguous } = selectProductionCsv(
        editables.status === "fulfilled" ? editables.value : [],
      );
      if (matrices.length !== 1)
        notices.push(
          resources.status === "rejected"
            ? folderNotice(folders.resources, resources.reason)
            : matrices.length
              ? "Hay más de una matriz Excel en RECURSOS."
              : "No se encontró una matriz Excel en RECURSOS.",
        );
      if (!csv)
        notices.push(
          editables.status === "rejected"
            ? folderNotice(folders.editables, editables.reason)
            : ambiguous
              ? "Hay más de un CSV candidato en EDITABLES. Dejá un único CSV de producción para vincular las piezas."
              : "No se encontró el CSV de producción en EDITABLES.",
        );
      if (pieces.status === "rejected")
        notices.push(folderNotice(folders.pieces, pieces.reason));
      let production;
      if (csv && csv.bytes > 2 * 1024 * 1024)
        notices.push("El CSV de producción supera el tamaño admitido.");
      if (csv && csv.bytes <= 2 * 1024 * 1024) {
        try {
          const path = join(await folder(folders.editables), csv.name);
          const stat = await lstat(path);
          if (stat.isFile() && stat.size <= 2 * 1024 * 1024)
            production = productionByPiece(await readFile(path, "utf8"));
        } catch {
          notices.push("No se pudieron leer los datos del CSV de producción.");
        }
      }
      return {
        campaignName: basename(root),
        production,
        matrix: matrices.length === 1 ? matrices[0] : null,
        csv,
        pieces: pieces.status === "fulfilled" ? pieces.value : [],
        notices,
      };
    },
    async readPiece(name) {
      if (
        basename(name) !== name ||
        name.includes("\\") ||
        name.includes("\0") ||
        !imageName.test(name)
      )
        return null;
      try {
        const path = join(await folder(folders.pieces), name);
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
        const bytes = await readFile(path);
        const png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!png && !jpg) return null;
        return {
          bytes: Uint8Array.from(bytes),
          mime: png ? "image/png" : "image/jpeg",
        };
      } catch {
        return null;
      }
    },
  };
}
