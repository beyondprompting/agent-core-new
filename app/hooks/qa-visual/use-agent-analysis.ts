"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import type { Comment, ReviewFeed } from "@/app/lib/qa-visual/review-model";

// Match the persisted preparation notice, including results from earlier runs.
const missingReferenceNotice =
  "Falta una referencia confirmada para esta pieza.";
const referenceLabels: Readonly<Record<string, string>> = {
  date: "Vigencia",
  cta: "Llamado a la acción (CTA)",
  product: "Producto",
  price: "Precio",
};

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

  const results: Record<
    string,
    Record<number, NonNullable<ReviewFeed["results"][string][number]>>
  > = {};
  const comments: Comment[] = [];
  for (const row of dashboard?.reviews ?? []) {
    if (!row || row.status === "stale") continue;
    const verdict =
      row.verdict ?? (row.status === "failed" ? "failed" : "analyzing");
    results[row.name] = { 1: verdict };
    const missingReferences = new Set<string>();
    for (const [index, finding] of (row.findings ?? []).entries()) {
      if (finding.outcome !== "fail" && finding.outcome !== "unverifiable")
        continue;
      if (
        finding.outcome === "unverifiable" &&
        finding.observed === missingReferenceNotice
      ) {
        const label = Object.hasOwn(referenceLabels, finding.ruleId)
          ? referenceLabels[finding.ruleId]
          : finding.expected;
        missingReferences.add(label);
        continue;
      }
      const region = finding.region && {
        x: finding.region.x * 100,
        y: finding.region.y * 100,
        width: finding.region.width * 100,
        height: finding.region.height * 100,
      };
      comments.push({
        id: `${row.resultId}-${finding.ruleId}`,
        marker: index + 1,
        pieceId: row.name,
        version: 1,
        author: "Agente QA Visual",
        role:
          finding.outcome === "unverifiable"
            ? "No verificable"
            : finding.severity === "blocking"
              ? "Hallazgo bloqueante"
              : "Hallazgo",
        kind: "agent",
        time: row.resultAt ? new Date(row.resultAt).toLocaleString() : "",
        body: finding.observed,
        source: finding.source,
        expected: finding.expected,
        observed: finding.observed,
        severity: finding.outcome === "fail" ? "warning" : undefined,
        resolved: false,
        ...(region
          ? {
              region,
              pin: {
                x: region.x + region.width / 2,
                y: region.y + region.height / 2,
              },
            }
          : {}),
      });
    }
    if (missingReferences.size) {
      comments.push({
        id: `${row.resultId}:missing-references`,
        pieceId: row.name,
        version: 1,
        author: "Agente QA Visual",
        role: "No verificable",
        kind: "agent",
        time: row.resultAt ? new Date(row.resultAt).toLocaleString() : "",
        body: `Controles pendientes por falta de referencias confirmadas. ${[...missingReferences].join(" · ")}.`,
        resolved: false,
      });
    }
  }

  return {
    dashboard,
    feed: { results, comments } satisfies ReviewFeed,
    busy: submitting || Boolean(dashboard?.active),
    error,
    launch,
    available: Boolean(context),
  };
}
