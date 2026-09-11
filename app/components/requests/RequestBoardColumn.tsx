import type { BoardStage, ExternalRequest } from "./types";
import { RequestBoardCard } from "./RequestBoardCard";

export function RequestBoardColumn({ stage, requests }: { stage: BoardStage; requests: ExternalRequest[] }) {
  return (
    <section aria-label={stage.label} className={`min-h-[200px] rounded-xl border border-border border-t-[3px] bg-card/55 ${stage.accent}`}>
      <header className="border-b border-border px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{stage.label}</h2>
          <span className="rounded-full border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{requests.length}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{stage.subtitle}</p>
      </header>
      <div className="flex flex-col gap-2.5 p-2.5">
        {requests.length ? requests.map((request) => <RequestBoardCard key={request._id} request={request} stage={stage} />) :
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">Sin solicitudes en esta etapa</p>}
      </div>
    </section>
  );
}

