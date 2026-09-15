import type { FullTask } from "./types";
import { formatDeadline, getTaskCategoryLabel } from "./utils";

export function InternalBoardCard({ task, projectName, accent, onSelect }: { task: FullTask; projectName: string; accent: string; onSelect: (task: FullTask) => void }) {
  const deadline = formatDeadline(task.deadline);
  return <button type="button" aria-haspopup="dialog" onClick={() => onSelect(task)} className={`w-full shrink-0 cursor-pointer rounded-md border border-border border-l-[3px] bg-card p-3 text-left shadow-sm hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring ${accent}`}>
    <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{getTaskCategoryLabel(task)}</p>
    <h3 className="break-words text-[13px] font-semibold leading-snug">{task.title}</h3>
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      <p className="break-words">Proyecto: {projectName}</p>
      {deadline && <p>Deadline: {deadline}</p>}
      <p>{task.source === "external" ? "Creada por usuario externo" : "Creada internamente"}{task.createdByName ? ` · ${task.createdByName}` : ""}</p>
      {task.corSyncStatus === "syncing" && <p className="text-primary">Publicando en COR…</p>}
      {task.corSyncStatus === "retrying" && <p className="text-primary">Reintentando sincronización…</p>}
      {task.corSyncStatus === "error" && <p className="text-destructive">Revisar sincronización</p>}
    </div>
    <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">Creada {new Date(task._creationTime).toLocaleDateString("es")}</p>
  </button>;
}
