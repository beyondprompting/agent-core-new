import { InternalBoardCard } from "./InternalBoardCard";
import { internalBoardStage, internalBoardStages, isTaskInCOR } from "./internalBoard";
import type { ControlPanelProjectGroup, ControlPanelPublicationTab, FullTask } from "./types";

export function InternalTasksBoard({ projects, publicationTab, onSelectTask }: { projects: ControlPanelProjectGroup[]; publicationTab: ControlPanelPublicationTab; onSelectTask: (task: FullTask) => void }) {
  const rows = projects.flatMap(({ project, tasks }) => tasks.map(task => ({ task, projectName: project.name })));
  const visible = rows.filter(({ task }) => publicationTab === "all" || (publicationTab === "cor" ? isTaskInCOR(task) : !isTaskInCOR(task)));
  return <div role="region" aria-label="Board de tareas internas" tabIndex={0} className="min-h-0 flex-1 overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-ring">
    <div className="grid h-full auto-cols-[280px] grid-flow-col items-start gap-3">
      {internalBoardStages(rows.map(row => row.task)).map(stage => {
        const cards = visible.filter(({ task }) => internalBoardStage(task) === stage.key);
        return <section key={stage.key} aria-label={stage.label} className={`flex max-h-full min-h-0 flex-col rounded-xl border border-border border-t-[3px] bg-muted/40 ${stage.accent}`}>
          <header className="shrink-0 border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{stage.label}</h2><span className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">{cards.length}</span></div>
            <p className="mt-0.5 text-xs text-muted-foreground">{stage.subtitle}</p>
          </header>
          <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain p-2.5">
            {cards.length ? cards.map(({ task, projectName }) => <InternalBoardCard key={task._id} task={task} projectName={projectName} accent={stage.cardAccent} onSelect={onSelectTask} />) : <p className="px-2 py-8 text-center text-xs text-muted-foreground">Sin tareas en esta etapa</p>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
