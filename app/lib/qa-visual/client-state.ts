import type { PieceClientStatus } from "@/convex/qaVisual/clientReview";

export type ClientState = "sent" | "viewed" | "changesRequested" | "approved";
export type ClientTone = "neutral" | "client" | "danger" | "success";

/** Internal label of the third (definitive) review (§23.4). */
export function internalClientState(status: PieceClientStatus | null | undefined): {
  key: "none" | ClientState;
  label: string;
  short: string;
  detail: string;
  tone: ClientTone;
} {
  if (!status)
    return { key: "none", label: "Sin enviar al cliente", short: "Sin enviar", detail: "Todavía no se envió al cliente", tone: "neutral" };
  const round = `Ronda ${status.deliveryNumber} · V${status.clientVersion}`;
  const extra = status.changedAfterApproval
    ? " · Cambió después de la aprobación del cliente"
    : status.internalAhead
      ? " · Hay una versión interna más nueva sin enviar"
      : "";
  switch (status.state) {
    case "approved":
      return { key: "approved", label: "Aprobada por el cliente", short: "Aprobada", detail: round + extra, tone: "success" };
    case "changesRequested":
      return { key: "changesRequested", label: "El cliente pidió cambios", short: "Cambios", detail: round + extra, tone: "danger" };
    case "viewed":
      return { key: "viewed", label: "Vista por el cliente", short: "Vista", detail: round + extra, tone: "client" };
    default:
      return { key: "sent", label: "Enviada al cliente", short: "Enviada", detail: round + extra, tone: "client" };
  }
}

/** Client-facing label: the client never needs to see "viewed". */
export function portalClientState(state: ClientState) {
  if (state === "approved") return { label: "Aprobada", tone: "success" as const };
  if (state === "changesRequested") return { label: "Cambios solicitados", tone: "danger" as const };
  return { label: "Por revisar", tone: "client" as const };
}

export const previewSrc = (thumbnail?: string) =>
  thumbnail?.replace("variant=thumbnail", "variant=preview");
