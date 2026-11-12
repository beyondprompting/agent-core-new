import type { Id } from "../../../convex/_generated/dataModel";
import type {
  Issue,
  ReviewResult,
} from "../../../convex/qaVisual/model/contracts";
import { sourceLabel } from "../../../convex/qaVisual/model/contracts";
import type { Comment, ReviewFeed } from "./review-model";

type AnalysisRow = {
  name: string;
  pieceId?: Id<"qaVisualPieces">;
  version?: number;
  status: string;
  verdict?: "validated" | "findings" | "partial";
  result?: ReviewResult;
  resultId?: Id<"qaVisualReviews">;
  resultAt?: number;
  findingThreads?: {
    ruleId: string;
    threadId?: Id<"qaVisualThreads">;
    resolved?: boolean;
  }[];
  issues?: Issue[];
  notices?: { id: string; message: string; source: string }[];
  findings?: {
    ruleId: string;
    outcome: string;
    observed: string;
    expected: string;
    source: string;
    severity: "warning" | "blocking";
    causeIssueId?: string;
    region?: { x: number; y: number; width: number; height: number };
    locationStatus?: string;
  }[];
};
export function buildAnalysisFeed(reviews: (AnalysisRow | null)[]): ReviewFeed {
  const results: Record<
    string,
    Record<number, NonNullable<ReviewFeed["results"][string][number]>>
  > = {};
  const comments: Comment[] = [];
  for (const row of reviews) {
    if (!row) continue;
    const pieceId = row.pieceId ?? row.name,
      version = row.version ?? 1;
    if (row.status !== "pending")
      results[pieceId] = {
        [version]:
          row.status === "stale"
            ? "stale"
            : row.status === "failed"
              ? "failed"
              : row.status !== "completed"
                ? "analyzing"
                : (row.verdict ?? "partial"),
      };
    for (const issue of new Map(
      (row.issues ?? []).map((i) => [i.id, i]),
    ).values())
      comments.push({
        id: `${pieceId}:issue:${issue.id}`,
        pieceId,
        version,
        author: "QA Visual",
        role: "Aviso de fuente",
        kind: "source",
        time: "",
        body: issue.message,
        source: sourceLabel(issue.sources),
        resolved: false,
        issue,
      });
    if (row.status === "stale" || row.status === "pending") continue;
    let marker = 0;
    for (const finding of row.findings ?? []) {
      if (finding.outcome !== "fail" && finding.outcome !== "unverifiable")
        continue;
      if (
        finding.causeIssueId &&
        row.issues?.some((i) => i.id === finding.causeIssueId)
      )
        continue;
      const region = finding.region && {
        x: finding.region.x * 100,
        y: finding.region.y * 100,
        width: finding.region.width * 100,
        height: finding.region.height * 100,
      };
      const discussion = row.findingThreads?.find(
        (t) => t.ruleId === finding.ruleId,
      );
      comments.push({
        id: `${row.resultId}-${finding.ruleId}`,
        ...(region ? { marker: ++marker } : {}),
        pieceId,
        version,
        author: "Agente QA Visual",
        role:
          finding.outcome === "unverifiable"
            ? "No verificable"
            : finding.severity === "blocking"
              ? "Hallazgo bloqueante"
              : "Hallazgo",
        kind: "agent",
        time: row.resultAt ? new Date(row.resultAt).toLocaleString() : "",
        body: `${finding.observed}${finding.locationStatus === "unlocated" ? " · Sin ubicación precisa" : ""}`,
        expected: finding.expected,
        observed: finding.observed,
        source: finding.source,
        resolved: discussion?.resolved ?? false,
        ...(discussion?.threadId ? { threadId: discussion.threadId } : {}),
        ...(row.resultId
          ? { finding: { reviewId: row.resultId, ruleId: finding.ruleId } }
          : {}),
        ...(finding.outcome === "fail" ? { severity: finding.severity } : {}),
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
  }
  return { results, comments };
}
