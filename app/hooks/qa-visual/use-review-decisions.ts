import { useState } from "react";
import type { PieceStatus } from "@/app/lib/qa-visual/review-model";
import type { ReviewDecision } from "@/app/lib/qa-visual/review-state";

export function useReviewDecisions(reviewer: string) {
  const [exception, setException] = useState("");
  const [statuses, setStatuses] = useState<Record<string, PieceStatus>>({});
  const [approvals, setApprovals] = useState<ReviewDecision[]>([]);
  function recordDecision(
    activeId: string,
    version: number,
    status: PieceStatus,
    requiresException: boolean,
  ) {
    if (status === "Aprobada" && requiresException && !exception.trim())
      return false;
    const reason =
      status === "Aprobada" && requiresException ? exception.trim() : "";
    setStatuses((prev) => ({ ...prev, [`${activeId}-${version}`]: status }));
    setApprovals((prev) => [
      ...prev,
      {
        pieceId: activeId,
        version,
        status,
        author: reviewer,
        exception: reason,
        message: `${status}${reason ? ` · Excepción: ${reason}` : ""}`,
      },
    ]);
    return true;
  }

  return { exception, setException, statuses, approvals, recordDecision };
}
