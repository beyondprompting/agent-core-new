import Link from "next/link";
import { ArrowUpRight, FolderOpen } from "lucide-react";

export function CampaignCard({ id, name }: { id: string; name: string }) {
  return (
    <li className="min-w-0">
      <Link
        href={`/workspace/qa-visual/${id}`}
        prefetch={false}
        className="group flex h-full min-h-44 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <FolderOpen className="size-5" aria-hidden />
          </span>
          <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
        </div>
        <h3 className="mt-4 break-words text-base font-semibold text-card-foreground">{name}</h3>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="text-xs text-muted-foreground">Google Drive</span>
          <span className="text-xs font-medium text-primary">Abrir revisión</span>
        </div>
      </Link>
    </li>
  );
}
