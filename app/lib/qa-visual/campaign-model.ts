import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type CampaignCardData = FunctionReturnType<
  typeof api.qaVisual.campaigns.list
>["page"][number];
export type PieceSummary = FunctionReturnType<
  typeof api.qaVisual.campaigns.pieceSummaries
>["page"][number];

export function summarizeCampaignPieces(
  pieces: PieceSummary[],
  noticeKeys: string[],
) {
  const counts = {
    pieces: pieces.length,
    validated: 0,
    findings: 0,
    partial: 0,
    failed: 0,
    approved: 0,
    done: 0,
    notices: 0,
  };
  const notices = new Set(noticeKeys);
  for (const piece of pieces) {
    if (piece.verdict) counts[piece.verdict]++;
    if (piece.failed) counts.failed++;
    if (piece.approved) counts.approved++;
    for (const key of piece.issueKeys) notices.add(key);
  }
  counts.done =
    counts.validated + counts.findings + counts.partial + counts.failed;
  counts.notices = notices.size;
  return counts;
}

export function campaignError(error: unknown) {
  if (error instanceof ConvexError) {
    if (typeof error.data === "string") return error.data;
    if (
      error.data &&
      typeof error.data === "object" &&
      "message" in error.data &&
      typeof error.data.message === "string"
    )
      return error.data.message;
  }
  return "No se pudo conectar con QA Visual. Intentá de nuevo.";
}

export function campaignDate(timestamp: number) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
