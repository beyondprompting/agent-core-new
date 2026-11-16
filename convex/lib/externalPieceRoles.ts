/**
 * Piece review roles of external users, stored in `approvedExternalUsers.workRole`.
 * Empty workRole keeps the current behavior (chat and briefs). A piece role gives access
 * to every QA Visual campaign of the clients the user is already assigned to.
 */
export const EXTERNAL_PIECE_ROLES = ["pieceReview", "pieceApproval"] as const;
export type ExternalPieceRole = (typeof EXTERNAL_PIECE_ROLES)[number];

export const EXTERNAL_PIECE_ROLE_LABELS: Record<ExternalPieceRole, string> = {
  pieceReview: "Revisa piezas",
  pieceApproval: "Aprueba piezas",
};

export function externalPieceRole(workRole: string | undefined | null): ExternalPieceRole | null {
  return EXTERNAL_PIECE_ROLES.find((role) => role === workRole?.trim()) ?? null;
}

/** Only an empty value or one of the piece roles is valid for an external user. */
export function normalizeExternalWorkRole(value: string | undefined) {
  const role = value?.trim();
  if (!role) return undefined;
  const pieceRole = externalPieceRole(role);
  if (!pieceRole) throw new Error("Rol externo no válido. Usá «pieceReview» o «pieceApproval».");
  return pieceRole;
}
