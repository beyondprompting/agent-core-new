"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { buildAnalysisFeed } from "@/app/lib/qa-visual/analysis-feed";

export type AnalysisContext = {
  campaignId: Id<"qaVisualCampaigns">;
  snapshotId: Id<"qaVisualCampaignSnapshots">;
  inputs: { name: string; contextKey: string }[];
};

export function useAgentAnalysis(context?: AnalysisContext) {
  const dashboard = useQuery(api.qaVisual.runs.dashboard, context
    ? { campaignId: context.campaignId, inputs: context.inputs }
    : "skip");
  const launchDriveAnalysis = useMutation(api.qaVisual.runs.start);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const sending = useRef(false);

  async function launch(kind: "batch" | "piece" | "retry", names?: string[]) {
    if (!context || sending.current || dashboard?.active) return;
    sending.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await launchDriveAnalysis({
        campaignId: context.campaignId,
        snapshotId: context.snapshotId,
        requestId: crypto.randomUUID(),
        kind,
        names,
      });
      if ("error" in result) setError(result.error);
    } catch {
      setError(
        "Se perdió la conexión al iniciar el análisis. Revisá el progreso antes de reintentar.",
      );
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  const feed = buildAnalysisFeed(dashboard?.reviews ?? []);

  return {
    dashboard,
    feed,
    busy: submitting || Boolean(dashboard?.active),
    error,
    launch,
    available: Boolean(context),
  };
}
