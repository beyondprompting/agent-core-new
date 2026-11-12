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
export function newPieceKey(
  fileName: string,
  driveFileId: string,
  duplicate: boolean,
) {
  const key = pieceKey(fileName);
  return duplicate
    ? `${key}#${driveFileId.slice(0, 6)}`
    : `${key}:${driveFileId}`;
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
    if (input.issues?.some((existing) => existing.id === issue.id))
      return input;
    return { ...input, issues: [...(input.issues ?? []), issue] };
  });
}

export type IdentityFile = {
  driveId: string;
  name: string;
  contentHash?: string;
  createdAt?: number;
};
export type IdentityPiece = {
  id: string;
  key: string;
  baseKey: string;
  driveFileId: string;
  status: string;
  createdAt: number;
  duplicateOf?: string;
};
export type IdentityVersion = {
  id?: string;
  pieceId: string;
  originalPieceId?: string;
  driveFileId: string;
  contentHash: string;
};
export type DuplicateOverride = {
  kind: "keepDuplicate" | "mergeAsVersion";
  baseKey: string;
  keepDriveFileId?: string;
  olderDriveFileId?: string;
  newerDriveFileId?: string;
};
export type ResolvedIdentity = {
  key: string;
  baseKey: string;
  pieceId?: string;
  duplicateOfKey?: string;
  disposition: "active" | "excluded" | "historical";
  duplicate: boolean;
  sourceVersionId?: string;
};

/** Resolve the complete inventory before any writes. Drive ownership precedes names. */
export function resolveIdentities(
  files: IdentityFile[],
  pieces: IdentityPiece[],
  versions: IdentityVersion[],
  overrides: DuplicateOverride[] = [],
) {
  const present = new Set(files.map((f) => f.driveId));
  const ordered = [...files].sort(
    (a, b) =>
      (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
      a.driveId.localeCompare(b.driveId),
  );
  const known = [...pieces]
    .filter((p) => p.status !== "staged")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const byId = new Map(known.map((p) => [p.id, p]));
  const byDrive = new Map<string, IdentityPiece>();
  for (const p of known)
    for (const ver of versions.filter(
      (v) => (v.originalPieceId ?? v.pieceId) === p.id,
    ))
      if (!byDrive.has(ver.driveFileId)) byDrive.set(ver.driveFileId, p);
  for (const p of known) byDrive.set(p.driveFileId, p);
  const owned = new Map<string, string>();
  for (const p of known) {
    const candidates = ordered.filter(
      (f) => byDrive.get(f.driveId)?.id === p.id,
    );
    const first =
      candidates.find((f) => f.driveId === p.driveFileId) ?? candidates[0];
    if (first) owned.set(p.id, first.driveId);
  }
  const groups = new Map<string, IdentityFile[]>();
  for (const f of ordered) {
    const base = byDrive.get(f.driveId)?.baseKey ?? pieceKey(f.name);
    groups.set(base, [...(groups.get(base) ?? []), f]);
  }
  const identities = new Map<string, ResolvedIdentity>();
  const excludedPieceIds = new Set<string>();
  const usedKeys = new Set(known.map((p) => p.key));
  const suffix = (base: string, id: string) => {
    let n = 6,
      key = `${base}#${id.slice(0, n)}`;
    while (usedKeys.has(key) && n < id.length)
      key = `${base}#${id.slice(0, ++n)}`;
    // IDs with a short common prefix remain distinct, including synthetic fixtures.
    if (usedKeys.has(key)) key = `${base}#${id}`;
    usedKeys.add(key);
    return key;
  };
  for (const [base, group] of groups) {
    const basePiece =
      known.find(
        (p) =>
          p.baseKey === base &&
          !p.duplicateOf &&
          (p.key === base || !p.key.includes("#")),
      ) ?? known.find((p) => p.baseKey === base && !p.duplicateOf);
    const baseKey = basePiece?.key ?? base;
    const allOwnedFiles = basePiece
      ? versions
          .filter((v) => (v.originalPieceId ?? v.pieceId) === basePiece.id)
          .map((v) => v.driveFileId)
          .concat(basePiece.driveFileId)
      : [];
    let baseTaken = allOwnedFiles.some((id) => present.has(id));
    for (const f of group) {
      const owner = byDrive.get(f.driveId);
      const belongs = owner && owned.get(owner.id) === f.driveId;
      if (belongs) {
        identities.set(f.driveId, {
          key: owner.key,
          baseKey: base,
          pieceId: owner.id,
          ...(owner.duplicateOf && byId.has(owner.duplicateOf)
            ? { duplicateOfKey: byId.get(owner.duplicateOf)!.key }
            : {}),
          disposition: "active",
          duplicate: false,
        });
      } else if (!baseTaken) {
        identities.set(f.driveId, {
          key: baseKey,
          baseKey: base,
          ...(basePiece ? { pieceId: basePiece.id } : {}),
          disposition: "active",
          duplicate: false,
        });
        usedKeys.add(baseKey);
        baseTaken = true;
      } else {
        identities.set(f.driveId, {
          key: suffix(base, f.driveId),
          baseKey: base,
          duplicateOfKey: baseKey,
          disposition: "active",
          duplicate: false,
        });
      }
    }
    const resolutions = overrides.filter((o) => o.baseKey === base);
    const keep = resolutions.findLast(
      (o) =>
        o.kind === "keepDuplicate" &&
        group.some((f) => f.driveId === o.keepDriveFileId),
    );
    if (keep) {
      for (const f of group)
        identities.get(f.driveId)!.disposition =
          f.driveId === keep.keepDriveFileId ? "active" : "excluded";
    } else {
      // Merge connected deliveries as one version chain (A → B → C), even
      // when an older file has since left Drive. The newest present file wins.
      const parent = new Map<string, string>();
      const root = (id: string): string => {
        const p = parent.get(id);
        return p && p !== id ? root(p) : id;
      };
      for (const merge of resolutions.filter(
        (o) => o.kind === "mergeAsVersion",
      )) {
        if (merge.olderDriveFileId && merge.newerDriveFileId)
          parent.set(
            root(merge.newerDriveFileId),
            root(merge.olderDriveFileId),
          );
      }
      const chains = new Map<string, IdentityFile[]>();
      for (const f of group) {
        const key = root(f.driveId);
        chains.set(key, [...(chains.get(key) ?? []), f]);
      }
      for (const [chainRoot, chain] of chains) {
        if (
          !resolutions.some(
            (o) =>
              o.kind === "mergeAsVersion" &&
              root(o.olderDriveFileId!) === chainRoot,
          )
        )
          continue;
        const originalOwners = [
          ...new Set(
            [...parent.keys(), chainRoot]
              .filter((id) => root(id) === chainRoot)
              .map((id) => byDrive.get(id))
              .filter((p): p is IdentityPiece => Boolean(p)),
          ),
        ];
        const destinationPiece =
          originalOwners.find((p) => p.id === basePiece?.id) ??
          originalOwners.sort(
            (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
          )[0];
        const destination = destinationPiece
          ? {
              key: destinationPiece.key,
              baseKey: base,
              pieceId: destinationPiece.id,
            }
          : identities.get(chain[0].driveId)!;
        for (const owner of originalOwners)
          if (owner.id !== destination.pieceId) excludedPieceIds.add(owner.id);
        for (const f of chain)
          identities.set(f.driveId, {
            ...destination,
            disposition: f === chain.at(-1) ? "active" : "historical",
            duplicate: false,
          });
      }
      const live = group.filter(
        (f) => identities.get(f.driveId)!.disposition === "active",
      );
      const duplicate = live.length > 1;
      for (const f of live) identities.get(f.driveId)!.duplicate = duplicate;
    }
  }
  // On a merge or its revocation, reuse the existing creative version and its
  // decisions. Its original owner lets a revoked confirmation split it back.
  for (const f of ordered) {
    const identity = identities.get(f.driveId)!;
    const source = versions.find(
      (v) => v.driveFileId === f.driveId && v.contentHash === f.contentHash,
    );
    if (source?.id && source.pieceId !== identity.pieceId)
      identity.sourceVersionId = source.id;
  }
  return {
    entries: ordered.map((file) => ({
      file,
      identity: identities.get(file.driveId)!,
    })),
    excludedPieceIds: [...excludedPieceIds],
  };
}
