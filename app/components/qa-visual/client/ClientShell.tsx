"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BrandLogo } from "@/app/components/BrandLogo";
import { UserMenu } from "@/app/components/UserMenu";
import { SwitchThemeButton } from "@/app/components/ui/SwitchThemeButton";
import { LoadingScreen } from "@/app/components/LoadingScreen";

/** Portal frame: same tokens and components as the internal editor, without internal navigation. */
export function ClientShell({ children }: { children: ReactNode }) {
  const access = useQuery(api.qaVisual.clientPortal.campaigns);
  if (access === undefined) return <LoadingScreen />;
  return (
    <div className="qa-visual">
      <div className="workspace qa-portal">
        <header className="qa-portal-top">
          <Link href="/workspace/reviews" aria-label="Revisiones">
            <BrandLogo />
          </Link>
          <span className="qa-portal-divider" />
          <b>Revisión de piezas</b>
          <span className="qa-grow" />
          {access.mode === "preview" && (
            <span className="qa-chip tone-progress" title="Ves lo mismo que el cliente, sin poder comentar ni decidir">
              Vista previa interna
            </span>
          )}
          <SwitchThemeButton />
          <UserMenu />
        </header>
        {access.mode === null ? (
          <div className="qa-portal-empty">
            <b>No tenés revisiones disponibles</b>
            <p>Si esperabas ver piezas, pedile a la agencia que te asigne a la campaña.</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
