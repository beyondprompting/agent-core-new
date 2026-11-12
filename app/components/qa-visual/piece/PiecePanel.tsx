import { CommentsPanel } from "@/app/components/qa-visual/comments/CommentsPanel";

import { PieceDetails, type PieceFinding } from "./PieceDetails";
import { PieceHistory } from "./PieceHistory";
import { PieceVersions } from "./PieceVersions";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function PiecePanel({
  session,
  findings,
}: {
  session: ReviewSession;
  findings?: PieceFinding[];
}) {
  const {
    version,
    setLeftTab,
    rightTab,
    setRightTab,
    setLeftOpen,
    piece,
    currentStatus,
    pieceComments,
    aiReview,
    humanReview,
  } = session;
  return (
    <aside className="comments-panel" aria-label="Comentarios y hallazgos">
      <div className="panel-tabs right-tabs">
        {(["Comentarios", "Detalles", "Versiones", "Historial"] as const).map(
          (tab) => (
            <button
              key={tab}
              className={rightTab === tab ? "active" : ""}
              onClick={() => setRightTab(tab)}
            >
              {tab}
              {tab === "Comentarios" && <span>{pieceComments.length}</span>}
            </button>
          ),
        )}
      </div>
      {rightTab === "Comentarios" ? (
        <CommentsPanel session={session} />
      ) : rightTab === "Detalles" ? (
        <PieceDetails
          piece={piece}
          findings={findings}
          version={version}
          status={currentStatus}
          aiReview={aiReview}
          humanReview={humanReview}
          onOpenResources={() => {
            setLeftOpen(true);
            setLeftTab("Recursos");
          }}
        />
      ) : rightTab === "Versiones" ? (
        <PieceVersions session={session} />
      ) : (
        <PieceHistory session={session} />
      )}
    </aside>
  );
}
