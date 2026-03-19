"use client";

import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { LoadingScreen } from "../components/LoadingScreen";
import ChatInterface from "../ChatInterface";
import TaskPanel from "../TaskPanel";
import { clientConfig } from "@/config/tenant.config";

export default function WorkspacePage() {
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);
  const [userClosedPanel, setUserClosedPanel] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

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

  // Verificar si el thread actual tiene mensajes
  const hasMessages = useQuery(
    api.messaging.threads.hasThreadMessages,
    currentThreadId ? { threadId: currentThreadId } : "skip",
  );

  // Obtener tareas del thread actual para auto-abrir el panel
  const tasks = useQuery(
    api.data.tasks.listByThread,
    currentThreadId ? { threadId: currentThreadId } : "skip",
  );

  // Estado para evitar múltiples creaciones automáticas
  const [hasAutoCreated, setHasAutoCreated] = useState(false);

  // Seleccionar el primer thread si existe y no hay uno seleccionado
  // O auto-crear uno si el usuario no tiene ningún thread
  useEffect(() => {
    if (threadsStatus === "LoadingFirstPage") return; // Aún cargando

    if (threads.length > 0 && !currentThreadId) {
      // Usuario tiene threads, seleccionar el primero
      setCurrentThreadId(threads[0].threadId);
      setIsInitialized(true);
    } else if (threads.length === 0 && !hasAutoCreated) {
      // Usuario nuevo sin threads - crear uno automáticamente
      setHasAutoCreated(true);
      createThread({ title: "Mi primera conversación" }).then((newThreadId) => {
        setCurrentThreadId(newThreadId);
        setIsInitialized(true);
      });
    } else if (threads.length > 0 && currentThreadId) {
      // Ya tiene thread seleccionado
      setIsInitialized(true);
    }
  }, [threads, currentThreadId, hasAutoCreated, createThread]);

  // Auto-abrir panel cuando se crea una tarea (solo si el usuario no lo cerró manualmente)
  useEffect(() => {
    if (tasks && tasks.length > 0 && !isTaskPanelOpen && !userClosedPanel) {
      setIsTaskPanelOpen(true);
    }
  }, [tasks, isTaskPanelOpen, userClosedPanel]);

  // Reset userClosedPanel cuando cambia de thread
  useEffect(() => {
    setUserClosedPanel(false);
  }, [currentThreadId]);

  const handleNewThread = useCallback(async () => {
    // Si el thread actual está vacío (sin mensajes), no crear uno nuevo
    if (hasMessages === false && currentThreadId) {
      // El thread actual está vacío, simplemente mantenerlo seleccionado
      return;
    }

    const newThreadId = await createThread({
      title: `Nuevo chat • ${new Date().toLocaleString()}`,
    });
    setCurrentThreadId(newThreadId);
  }, [createThread, hasMessages, currentThreadId]);

  const handleSelectThread = useCallback((threadId: string) => {
    setCurrentThreadId(threadId);
  }, []);

  const handleThreadChange = useCallback((threadId: string | null) => {
    if (threadId) {
      setCurrentThreadId(threadId);
    }
  }, []);

  const toggleTaskPanel = useCallback(() => {
    setIsTaskPanelOpen((prev) => {
      const newState = !prev;
      if (!newState) {
        setUserClosedPanel(true);
      }
      return newState;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING: Mostrar pantalla de carga completa hasta que todo esté listo
  // ═══════════════════════════════════════════════════════════════════════════
  if (
    !isInitialized ||
    threadsStatus === "LoadingFirstPage" ||
    !currentThreadId
  ) {
    return <LoadingScreen />;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACE: Solo se muestra cuando threads y currentThreadId están listos
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <WorkspaceLayout
      currentThreadId={currentThreadId}
      onSelectThread={handleSelectThread}
      onNewThread={handleNewThread}
      threads={threads}
      threadsStatus={threadsStatus}
      loadMoreThreads={loadMore}
    >
      <div className="flex h-full overflow-hidden relative">
        {/* Chat Section */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
          <ChatInterface
            key={currentThreadId}
            threadId={currentThreadId}
            onThreadChange={handleThreadChange}
            hideHeader={true}
          />
        </div>

        {/* Toggle Button para Task Panel */}
        {clientConfig.ui.showTaskPanel && (
          <button
            onClick={toggleTaskPanel}
            className={`h-fit z-10 p-2 mt-4 mr-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors shadow-sm ${
              isTaskPanelOpen ? "lg:hidden" : ""
            }`}
            title={
              isTaskPanelOpen
                ? "Cerrar panel de tareas"
                : "Abrir panel de tareas"
            }
          >
            {isTaskPanelOpen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            )}
            {tasks && tasks.length > 0 && !isTaskPanelOpen && (
              <span className="absolute top-1 right-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {tasks.length}
              </span>
            )}
          </button>
        )}

        {/* Task Panel */}
        {clientConfig.ui.showTaskPanel && isTaskPanelOpen && (
          <div className="w-[500px] flex-shrink-0 h-full overflow-hidden border-l border-border bg-card animate-in slide-in-from-right duration-200">
            <TaskPanel threadId={currentThreadId} onClose={toggleTaskPanel} />
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}
