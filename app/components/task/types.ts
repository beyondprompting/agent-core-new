import { Id } from "@/convex/_generated/dataModel";

// Tipos compartidos para TaskPanel
export type Task = {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  description?: string;
  requestType: string;
  brand: string;
  objective?: string;
  keyMessage?: string;
  kpis?: string;
  deadline?: string;
  budget?: string;
  approvers?: string;
  status: string;
  priority?: string;
  threadId: string;
  fileIds?: string[];
  createdBy?: string;
};

export type MessagePart = {
  type: "text" | "file";
  text?: string;
  url?: string;
};

export type EvaluationMessage = {
  key: string;
  role: "user" | "assistant";
  content: string | MessagePart[];
  text?: string;
  agentName?: string;
  status?: string;
};

export type SelectedFile = {
  base64: string;
  name: string;
  type: string;
};

// Utilidades
export const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    nueva:
      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    en_revision:
      "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    aprobada:
      "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    rechazada:
      "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
    completada:
      "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  };
  return colors[status] || "bg-muted text-muted-foreground border-border";
};

export const getPriorityConfig = (priority?: string) => {
  if (!priority) return null;
  const badges: Record<string, { color: string; icon: string }> = {
    baja: { color: "text-muted-foreground", icon: "▽" },
    media: { color: "text-amber-600 dark:text-amber-400", icon: "◆" },
    alta: { color: "text-orange-600 dark:text-orange-400", icon: "△" },
    urgente: { color: "text-red-600 dark:text-red-400", icon: "⚡" },
  };
  return badges[priority.toLowerCase()] || badges.media;
};

// Tipos de archivo soportados para evaluación
export const SUPPORTED_EVAL_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export const MAX_FILES = 3;

// Obtener icono según tipo de archivo
export const getFileIcon = (type: string) => {
  if (type.startsWith("image/")) return "🖼️";
  if (type === "application/pdf") return "📄";
  if (type.includes("word") || type === "application/msword") return "📝";
  return "📎";
};
