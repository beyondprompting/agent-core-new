"use client";

import type { Task } from "./types";
import { formatDate } from "./types";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";

interface InfoItemProps {
  icon: string;
  label: string;
  value: string;
  multiline?: boolean;
}

/**
 * Componente para mostrar un item de información con icono
 */
export function InfoItem({
  icon,
  label,
  value,
  multiline = false,
}: InfoItemProps) {
  return (
    <div className="bg-card rounded-lg p-3 border border-border shadow-sm">
      <div className="flex items-start gap-2">
        <span className="text-lg">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p
            className={`text-sm text-foreground mt-0.5 ${
              multiline ? "whitespace-pre-wrap" : "truncate"
            }`}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

interface TaskBriefContentProps {
  task: Task;
}

/**
 * Contenido del brief de una tarea
 */
export function TaskBriefContent({ task }: TaskBriefContentProps) {
  const convex = useConvex();

  // Handler para abrir archivo
  const handleOpenFile = async (fileId: string) => {
    try {
      const url = await convex.query(api.data.files.getFileUrl, { fileId });
      if (url) {
        window.open(url, "_blank");
      } else {
        console.error("No se pudo obtener la URL del archivo");
        alert("No se pudo abrir el archivo");
      }
    } catch (error) {
      console.error("Error abriendo archivo:", error);
      alert("Error al abrir el archivo");
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-background">
      {/* Título */}
      <div>
        <h3 className="text-xl font-bold text-foreground mb-1">{task.title}</h3>
        <p className="text-xs text-muted-foreground">
          Creado: {formatDate(task._creationTime)}
        </p>
      </div>

      {/* Info Grid */}
      <div className="space-y-3">
        <InfoItem icon="🏷️" label="Tipo" value={task.requestType} />
        <InfoItem icon="🏢" label="Marca" value={task.brand} />
        {task.objective && (
          <InfoItem
            icon="🎯"
            label="Objetivo"
            value={task.objective}
            multiline
          />
        )}
        {task.keyMessage && (
          <InfoItem
            icon="💬"
            label="Mensaje clave"
            value={task.keyMessage}
            multiline
          />
        )}
        {task.kpis && (
          <InfoItem icon="📊" label="KPIs" value={task.kpis} multiline />
        )}
        {task.deadline && (
          <InfoItem icon="📅" label="Timing" value={task.deadline} />
        )}
        {task.budget && (
          <InfoItem icon="💰" label="Presupuesto" value={task.budget} />
        )}
        {task.approvers && (
          <InfoItem icon="👥" label="Aprobadores" value={task.approvers} />
        )}

        {task.description && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Descripción completa
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        )}

        {/* Archivos adjuntos */}
        {task.fileIds && task.fileIds.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              📎 Archivos adjuntos ({task.fileIds.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {task.fileIds.map((fileId, index) => (
                <button
                  key={fileId}
                  onClick={() => handleOpenFile(fileId)}
                  className="bg-muted rounded-lg p-2 flex items-center gap-2 border border-border hover:bg-muted/80 transition-colors cursor-pointer"
                >
                  <span className="text-muted-foreground">📄</span>
                  <span className="text-xs text-foreground truncate">
                    Archivo {index + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface EmptyTaskStateProps {
  onClose?: () => void;
}

/**
 * Estado vacío cuando no hay tarea
 */
export function EmptyTaskState({ onClose }: EmptyTaskStateProps) {
  return (
    <div className="h-full bg-card flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border bg-muted/50">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            📋 Tareas
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Cerrar panel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-background">
        <div className="text-6xl mb-4">📝</div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          Sin requerimiento aún
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          El requerimiento aparecerá aquí una vez que completes la información
          con el asistente y confirmes que deseas guardarlo.
        </p>
      </div>
    </div>
  );
}

/**
 * Estado de carga del panel
 */
export function LoadingTaskState() {
  return (
    <div className="h-full bg-card flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Cargando...</div>
    </div>
  );
}
