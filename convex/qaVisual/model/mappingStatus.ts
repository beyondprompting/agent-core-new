import type { Issue } from "./contracts";

/** Mapping state of a piece (§5.5), read from the issues of its import input. */
export type MappingStatus =
  | "linked"
  | "excluded"
  | "csv_missing"
  | "csv_duplicate"
  | "matrix_missing"
  | "matrix_ambiguous";

export const EXCLUDED_ISSUE = "piece_excluded";

export function pieceMappingStatus(
  issues: Pick<Issue, "code" | "affects">[] | undefined,
): MappingStatus {
  const codes = new Set(
    (issues ?? [])
      // An identical repeated row is harmless (info, no affected rules).
      .filter((i) => i.code !== "csv_duplicate_id" || i.affects.length)
      .map((i) => i.code),
  );
  if (codes.has(EXCLUDED_ISSUE)) return "excluded";
  if (codes.has("csv_row_missing")) return "csv_missing";
  if (codes.has("csv_duplicate_id")) return "csv_duplicate";
  if (codes.has("excel_row_ambiguous")) return "matrix_ambiguous";
  if (codes.has("excel_row_missing")) return "matrix_missing";
  return "linked";
}

export const isUnmapped = (status: MappingStatus) =>
  status !== "linked" && status !== "excluded";

/**
 * The editor of a new campaign opens only when every piece is linked to the CSV and the matrix,
 * or was excluded. Once that happened, new unlinked pieces wait apart without locking it.
 */
export const mappingLocked = (campaign: {
  mappingCompletedAt?: number;
  mappingCheck?: { unmapped: number };
}) =>
  !campaign.mappingCompletedAt && (campaign.mappingCheck?.unmapped ?? 0) > 0;
