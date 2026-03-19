"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Plus,
  Trash2,
  MoreVertical,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { UserMenu } from "./UserMenu";
import { SwitchThemeButton } from "./ui/SwitchThemeButton";
import { Button } from "./ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import { Tooltip } from "./ui/Tooltip";
import { clientConfig } from "@/config/tenant.config";

interface Thread {
  _id: string;
  threadId: string;
  title?: string;
  updatedAt: number;
}

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  currentThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  onNewThread?: () => void;
  threads: Thread[];
  threadsStatus:
    | "LoadingFirstPage"
    | "CanLoadMore"
    | "LoadingMore"
    | "Exhausted";
  loadMoreThreads: (numItems: number) => void;
}

export function WorkspaceLayout({
  children,
  currentThreadId,
  onSelectThread,
  onNewThread,
  threads,
  threadsStatus,
  loadMoreThreads,
}: WorkspaceLayoutProps) {
  const deleteThread = useMutation(api.messaging.threads.deleteThread);
  const updateThreadTitle = useMutation(
    api.messaging.threads.updateThreadTitle,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const threadsContainerRef = useRef<HTMLDivElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingThreadId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingThreadId]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const container = threadsContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

    if (isNearBottom && threadsStatus === "CanLoadMore") {
      loadMoreThreads(20);
    }
  }, [threadsStatus, loadMoreThreads]);

  useEffect(() => {
    const container = threadsContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  const handleStartEdit = (
    threadId: string,
    currentTitle: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setEditingThreadId(threadId);
    setEditingTitle(currentTitle || "Sin título");
  };

  const handleSaveEdit = async (threadId: string) => {
    if (editingTitle.trim()) {
      await updateThreadTitle({ threadId, title: editingTitle.trim() });
    }
    setEditingThreadId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingThreadId(null);
    setEditingTitle("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, threadId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit(threadId);
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("¿Estás seguro de eliminar esta conversación?")) {
      await deleteThread({ threadId });

      // Si eliminamos el thread actual, cargar el más reciente (el primero de la lista que no sea el eliminado)
      if (currentThreadId === threadId && threads.length > 0) {
        const remainingThreads = threads.filter((t) => t.threadId !== threadId);
        if (remainingThreads.length > 0) {
          onSelectThread?.(remainingThreads[0].threadId);
        }
      }
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Hoy";
    if (days === 1) return "Ayer";
    if (days < 7) return `Hace ${days} días`;
    return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  };

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Sidebar - Fijo */}
      <aside
        className={`${
          isSidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 border-r border-border bg-card flex flex-col overflow-hidden flex-shrink-0`}
      >
        {/* Sidebar Header - Logo centrado */}
        <div className="py-6 border-b border-border flex justify-center">
          <BrandLogo />
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <Button
            onClick={onNewThread}
            className="w-full justify-start gap-2"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            Nueva conversación
          </Button>
        </div>

        {/* Threads List */}
        <div ref={threadsContainerRef} className="flex-1 overflow-y-auto">
          <div className="px-3 py-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Mis Chats
            </h3>
            <div className="space-y-1">
              {threads.length === 0 ? (
                <div className="px-2 py-4 text-center text-muted-foreground text-sm">
                  No hay conversaciones
                </div>
              ) : (
                <>
                  {threads.map((thread) => (
                    <div
                      key={thread._id}
                      onClick={() => {
                        if (editingThreadId !== thread.threadId) {
                          onSelectThread?.(thread.threadId);
                        }
                      }}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        currentThreadId === thread.threadId
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent text-foreground"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 flex-shrink-0" />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        {editingThreadId === thread.threadId ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) =>
                              handleEditKeyDown(e, thread.threadId)
                            }
                            onBlur={handleCancelEdit}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-sm font-medium bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-foreground"
                          />
                        ) : (
                          <Tooltip content={thread.title || "Sin título"}>
                            <p className="text-sm font-medium truncate max-w-full">
                              {thread.title || "Sin título"}
                            </p>
                          </Tooltip>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatDate(thread.updatedAt)}
                        </p>
                      </div>
                      {editingThreadId !== thread.threadId && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-opacity"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) =>
                                handleStartEdit(
                                  thread.threadId,
                                  thread.title || "",
                                  e,
                                )
                              }
                              className="cursor-pointer"
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) =>
                                handleDeleteThread(thread.threadId, e)
                              }
                              className="text-destructive cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}
                  {threadsStatus === "LoadingMore" && (
                    <div className="px-2 py-3 text-center text-muted-foreground text-sm">
                      Cargando más...
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Footer - User controls */}
        <div className="border-t border-border p-3 flex items-center justify-between gap-2 bg-card">
          <UserMenu />
          <SwitchThemeButton />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header - Fijo */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-accent rounded-lg transition-colors lg:hidden"
            >
              <MessageSquare className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold text-foreground">
              {clientConfig.brand.name}
            </h2>
          </div>
        </header>

        {/* Content - Área con scroll controlado */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
