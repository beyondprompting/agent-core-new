"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { buildAnalysisFeed } from "@/app/lib/qa-visual/analysis-feed";

export type AnalysisContext = {
  campaignId: Id<"qaVisualCampaigns">;
  snapshotId: Id<"qaVisualCampaignSnapshots"> | Id<"qaVisualImports">;
  inputs: { name: string; contextKey: string }[];
};

export function useAgentAnalysis(context?: AnalysisContext) {
  const dashboard = useQuery(
    api.qaVisual.runs.dashboard,
    context
      ? { campaignId: context.campaignId, inputs: context.inputs }
      : "skip",
  );
  const launchDriveAnalysis = useMutation(api.qaVisual.runs.start);
  const stopAnalysis = useMutation(api.qaVisual.runs.cancel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const sending = useRef(false);

  /**
   * batch: "pending" (default) analyzes pieces without a current result; "all" repeats every piece.
   * piece: allowed while a run is active — the backend puts it in front of the queue (§10.4).
   */
  async function launch(
    kind: "batch" | "piece" | "retry",
    names?: string[],
    pieceIds?: Id<"qaVisualPieces">[],
    scope?: "pending" | "all",
  ) {
    if (!context || sending.current) return;
    if (dashboard?.active && kind !== "piece") return;
    sending.current = true;
    setSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await launchDriveAnalysis({
        campaignId: context.campaignId,
        snapshotId: context.snapshotId,
        requestId: crypto.randomUUID(),
        kind,
        names,
        pieceIds: pieceIds?.length ? pieceIds : undefined,
        ...(kind === "batch" && scope ? { scope } : {}),
      });
      if ("error" in result) setError(result.error);
      else if (kind === "piece" && dashboard?.active)
        setNotice("Se agregó al análisis en curso. Se analiza antes que las piezas en cola.");
    } catch {
      setError(
        "Se perdió la conexión al iniciar el análisis. Revisá el progreso antes de reintentar.",
      );
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!context) return;
    try {
      await stopAnalysis({ campaignId: context.campaignId });
      setNotice("Se detuvo el análisis. Las piezas que ya estaban en proceso terminan o se cancelan.");
    } catch {
      setError("No se pudo detener el análisis. Intentá de nuevo.");
    }
  }

  const feed = buildAnalysisFeed(dashboard?.reviews ?? []);

  return {
    dashboard,
    feed,
    busy: submitting || Boolean(dashboard?.active),
    error,
    notice,
    launch,
    cancel,
    available: Boolean(context),
  };
}
