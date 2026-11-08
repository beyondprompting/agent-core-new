import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { QaWorkspace } from "@/app/components/qa-visual/QaWorkspace";
import { canAccessQa } from "@/app/lib/qa-visual/server/access";

export default async function QaVisualLayout({ children }: { children: ReactNode }) {
  if (!(await canAccessQa())) notFound();
  return <QaWorkspace>{children}</QaWorkspace>;
}
