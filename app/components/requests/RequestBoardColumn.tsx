import type { BoardStage, ExternalRequest } from "./types";
import { RequestBoardCard } from "./RequestBoardCard";

export function RequestBoardColumn({ stage, requests }: { stage: BoardStage; requests: ExternalRequest[] }) {
  return (
    <section aria-label={stage.label} className={`flex max-h-full min-h-0 flex-col rounded-xl border border-border border-t-[3px] bg-card/55 ${stage.accent}`}>
      <header className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{stage.label}</h2>
          <span className="rounded-full border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{requests.length}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{stage.subtitle}</p>
      </header>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain p-2.5">
        {requests.length ? requests.map((request) => <RequestBoardCard key={request._id} request={request} />) :
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">Sin tareas en esta etapa</p>}
      </div>
    </section>
  );
}
