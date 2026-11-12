import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { qaVisualEnabled } from "@/app/lib/qa-visual/server/enabled";
import { ClientShell } from "@/app/components/qa-visual/client/ClientShell";
import "@/app/components/qa-visual/review.css";
import "@/app/components/qa-visual/gallery.css";

/** Client portal (§23.6): external users review what the agency sent them. */
export default function ReviewsLayout({ children }: { children: ReactNode }) {
  if (!qaVisualEnabled()) notFound();
  return <ClientShell>{children}</ClientShell>;
}
