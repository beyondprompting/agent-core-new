import type { Issue } from "./contracts";
import { pieceKey } from "./normalize";

type Candidate<Id extends string> = {
  _id: Id;
  _creationTime: number;
  driveFileId: string;
  status: string;
};

/**
 * Identity rule for a file that is not yet linked by its Drive ID (§6.1).
 * A piece with the same name is reused only when none of its files is still present:
 * that is a replacement (new version). When the previous file is still present the
 * new file is a simultaneous duplicate and becomes a separate piece.
 */
export function chooseByName<Id extends string>(
  matches: Candidate<Id>[],
  presentDriveIds: ReadonlySet<string>,
): { kind: "version"; pieceId: Id } | { kind: "new"; duplicate: boolean } {
  const replaced = matches
    .filter((piece) => !presentDriveIds.has(piece.driveFileId))
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        b._creationTime - a._creationTime,
    );
  if (replaced[0]) return { kind: "version", pieceId: replaced[0]._id };
  return { kind: "new", duplicate: matches.length > 0 };
}

/** Identity key for a new piece. Duplicates get a stable suffix from their Drive ID. */
export function newPieceKey(fileName: string, driveFileId: string, duplicate: boolean) {
  const key = pieceKey(fileName);
  return duplicate ? `${key}#${driveFileId.slice(0, 6)}` : `${key}:${driveFileId}`;
}

export const duplicateNameIssue = (fileName: string): Issue => ({
  id: `file_duplicate_name:${pieceKey(fileName)}`,
  code: "file_duplicate_name",
  severity: "warning",
  scope: "piece",
  affects: [],
  message:
    "Hay otro archivo con el mismo nombre en DESPLIEGUE. Se revisan como piezas separadas contra la misma fila del pedido; confirmá cuál es la definitiva antes de enviarla al cliente.",
  sources: [{ file: "filename", text: fileName }],
});

/** Adds a single duplicate-name notice to every input whose file shares its name with another one. */
export function markDuplicateNames<T extends { issues?: Issue[] }>(
  files: { name: string }[],
  inputs: T[],
): T[] {
  const counts = new Map<string, number>();
  for (const file of files)
    counts.set(pieceKey(file.name), (counts.get(pieceKey(file.name)) ?? 0) + 1);
  return inputs.map((input, index) => {
    const name = files[index]?.name;
    if (!name || (counts.get(pieceKey(name)) ?? 0) < 2) return input;
    const issue = duplicateNameIssue(name);
    if (input.issues?.some((existing) => existing.id === issue.id)) return input;
    return { ...input, issues: [...(input.issues ?? []), issue] };
  });
}
