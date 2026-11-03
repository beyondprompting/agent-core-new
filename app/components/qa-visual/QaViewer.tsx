"use client";

import { useMemo, useTransition } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { WorkspaceLayout } from "@/app/components/WorkspaceLayout";
import { useRouter } from "next/navigation";
import { CheckCircle2, ScanLine, X } from "lucide-react";
import { useTheme } from "@/app/hooks/useTheme";
import { CampaignHeader } from "@/app/components/qa-visual/campaign/CampaignHeader";
import { FilesPanel } from "@/app/components/qa-visual/campaign/FilesPanel";
import { PiecePanel } from "@/app/components/qa-visual/piece/PiecePanel";
import { ReviewCanvas } from "@/app/components/qa-visual/viewer/ReviewCanvas";
import { ReviewDialogs } from "@/app/components/qa-visual/piece/ReviewDialogs";
import { ViewerToolbar } from "@/app/components/qa-visual/viewer/ViewerToolbar";
import ImageCommentPopover from "@/app/components/qa-visual/comments/image-comment-popover";
import { toReviewPieces } from "@/app/lib/qa-visual/piece-inventory";
import {
  emptyReviewFeed,
  type Piece,
  type ReviewFeed,
} from "@/app/lib/qa-visual/review-model";
import { useUser } from "@/app/UserContextProvider";
import type { QaInventory } from "@/app/lib/qa-visual/source";
import { useReviewSession } from "@/app/hooks/qa-visual/use-review-session";
import "./review.css";

export function QaViewer({
  inventory,
  feed = emptyReviewFeed,
}: {
  inventory: QaInventory;
  feed?: ReviewFeed;
}) {
  const { user } = useUser();
  const reviewer = user?.name || user?.email || "Revisor";
  const pieces = useMemo(() => toReviewPieces(inventory), [inventory]);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const {
    results: threads,
    status: threadsStatus,
    loadMore,
  } = usePaginatedQuery(
    api.messaging.threads.getMyThreads,
    {},
    { initialNumItems: 20 },
  );
  const createThread = useMutation(api.messaging.threads.createThread);

  function openThread(threadId: string) {
    router.push("/workspace?" + new URLSearchParams({ threadId }));
  }

  async function newThread() {
    const threadId = await createThread({
      title: `Nuevo chat • ${new Date().toLocaleString()}`,
    });
    openThread(threadId);
  }

  return (
    <WorkspaceLayout
      threads={threads}
      threadsStatus={threadsStatus}
      loadMoreThreads={loadMore}
      onSelectThread={openThread}
      onNewThread={newThread}
    >
      <div className="qa-visual">
        <div className={`workspace${dark ? " dark" : ""}`}>
          {inventory.notices.length > 0 && (
            <div className="drive-notices" role="status">
              {inventory.notices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
              <button
                disabled={refreshing}
                onClick={() => startTransition(() => router.refresh())}
              >
                Actualizar desde Drive
              </button>
            </div>
          )}
          {pieces.length ? (
            <ReviewWorkspace
              pieces={pieces}
              inventory={inventory}
              feed={feed}
              reviewer={reviewer}
            />
          ) : (
            <section className="empty-state">
              <ScanLine size={28} />
              <p>No hay piezas disponibles para revisar.</p>
            </section>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}

function ReviewWorkspace({
  pieces,
  inventory,
  feed,
  reviewer,
}: {
  feed: ReviewFeed;
  reviewer: string;
  pieces: Piece[];
  inventory: QaInventory;
}) {
  const session = useReviewSession(pieces, inventory, feed, reviewer);
  const {
    leftOpen,
    rightOpen,
    pendingPin,
    artboardRef,
    piece,
    zoom,
    pan,
    rightTab,
    toast,
  } = session;
  return (
    <>
      <CampaignHeader session={session} />
      <section
        aria-label="Revisión visual"
        className={`review-layout ${!leftOpen ? "hide-left" : ""} ${!rightOpen ? "hide-right" : ""}`}
      >
        {leftOpen && <FilesPanel session={session} />}
        <section className="viewer" aria-label="Visor de pieza">
          <ViewerToolbar session={session} />
          <ReviewCanvas session={session} />
        </section>
        {rightOpen && <PiecePanel session={session} />}
      </section>
      {pendingPin && (
        <ImageCommentPopover
          anchor={artboardRef}
          point={pendingPin}
          pieceName={piece.name}
          reviewer={reviewer}
          layoutKey={`${zoom}-${pan.x}-${pan.y}-${leftOpen}-${rightOpen}-${rightTab}`}
          onPublish={session.publishImageComment}
          onCancel={session.cancelImageComment}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
          <button
            aria-label="Cerrar aviso"
            onClick={() => session.setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <ReviewDialogs session={session} />
    </>
  );
}
