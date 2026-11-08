"use client";

import type { ReactNode } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { WorkspaceLayout } from "@/app/components/WorkspaceLayout";
import { api } from "@/convex/_generated/api";

export function QaWorkspace({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { results: threads, status, loadMore } = usePaginatedQuery(
    api.messaging.threads.getMyThreads, {}, { initialNumItems: 20 },
  );
  const createThread = useMutation(api.messaging.threads.createThread);

  function openThread(threadId: string) {
    router.push("/workspace?" + new URLSearchParams({ threadId }));
  }

  async function newThread() {
    const threadId = await createThread({ title: `Nuevo chat • ${new Date().toLocaleString()}` });
    openThread(threadId);
  }

  return (
    <WorkspaceLayout
      threads={threads}
      threadsStatus={status}
      loadMoreThreads={loadMore}
      onSelectThread={openThread}
      onNewThread={newThread}
    >
      {children}
    </WorkspaceLayout>
  );
}
