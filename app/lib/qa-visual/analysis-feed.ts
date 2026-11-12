import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { Comment, ReviewFeed } from "./review-model";

type Dashboard = NonNullable<FunctionReturnType<typeof api.qaVisual.runs.dashboard>>;

// Match the persisted preparation notice, including results from earlier runs.
const missingReferenceNotice =
  "Falta una referencia confirmada para esta pieza.";
const referenceLabels: Readonly<Record<string, string>> = {
  date: "Vigencia",
  cta: "Llamado a la acción (CTA)",
  product: "Producto",
  price: "Precio",
};

export function buildAnalysisFeed(reviews: Dashboard["reviews"]): ReviewFeed {
  const results: Record<
    string,
    Record<number, NonNullable<ReviewFeed["results"][string][number]>>
  > = {};
  const comments: Comment[] = [];
  for (const row of reviews) {
    if (!row || row.status === "stale") continue;
    const verdict =
      row.verdict ?? (row.status === "failed" ? "failed" : "analyzing");
    results[row.name] = { 1: verdict };
    for (const notice of new Map((row.notices ?? []).map((item) => [item.id, item])).values()) {
      comments.push({
        id: `${row.resultId ?? row.name}:notice:${notice.id}`,
        pieceId: row.name,
        version: 1,
        author: "QA Visual",
        role: "Aviso del Excel",
        kind: "agent",
        time: row.resultAt ? new Date(row.resultAt).toLocaleString() : "",
        body: notice.message,
        source: notice.source,
        resolved: false,
      });
    }
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

  return { results, comments };
}
