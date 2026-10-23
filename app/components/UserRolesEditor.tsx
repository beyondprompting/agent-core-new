"use client";

import { useEffect, useId, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "./ui/Button";

type PlatformRole = "user" | "admin" | "super_admin";
type Props = { workRole?: string } & (
  | { kind: "internal"; userId: Id<"users">; platformRole?: PlatformRole }
  | { kind: "external"; approvedExternalUserId: Id<"approvedExternalUsers">; isCoordinator: boolean }
);

export function UserRolesEditor(props: Props) {
  const id = useId();
  const saveInternal = useMutation(api.data.internalUserAdmin.setInternalUserRoles);
  const saveExternal = useMutation(api.data.externalUserAdmin.setExternalUserRoles);
  const initialPlatformRole = props.kind === "internal" ? props.platformRole ?? "user" : "user";
  const initialCoordinator = props.kind === "external" && props.isCoordinator;
  const targetId = props.kind === "internal" ? props.userId : props.approvedExternalUserId;
  const [platformRole, setPlatformRole] = useState<PlatformRole>(initialPlatformRole);
  const [isCoordinator, setIsCoordinator] = useState(initialCoordinator);
  const [workRole, setWorkRole] = useState(props.workRole ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    setPlatformRole(initialPlatformRole);
    setIsCoordinator(initialCoordinator);
    setWorkRole(props.workRole ?? "");
    setFeedback(null);
  }, [targetId, initialPlatformRole, initialCoordinator, props.workRole]);

  const changed = platformRole !== initialPlatformRole || isCoordinator !== initialCoordinator || workRole.trim() !== (props.workRole ?? "");
  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      if (props.kind === "external") {
        await saveExternal({ approvedExternalUserId: props.approvedExternalUserId, isCoordinator, workRole });
      } else {
        await saveInternal({ targetUserId: props.userId, platformRole, workRole });
      }
      setFeedback({ error: false, text: "Roles guardados." });
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "No se pudieron guardar los roles." });
    } finally {
      setSaving(false);
    }
  };

  return <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-card p-4">
    <h3 id={`${id}-title`} className="text-sm font-semibold text-foreground">Roles del usuario</h3>
    <div className="mt-4 space-y-4">
      {props.kind === "internal" ? <div>
        <label htmlFor={`${id}-platform`} className="block text-sm font-medium">Nivel de administración</label>
        <select id={`${id}-platform`} value={platformRole} disabled={saving} onChange={event => setPlatformRole(event.target.value as PlatformRole)} aria-describedby={`${id}-platform-help`} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="user">Usuario</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super admin</option>
        </select>
        <p id={`${id}-platform-help`} className="mt-1 text-xs text-muted-foreground">Este nivel se aplicará en una próxima etapa. Guardarlo todavía no cambia los accesos actuales.</p>
      </div> : <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={isCoordinator} disabled={saving} onChange={event => setIsCoordinator(event.target.checked)} aria-describedby={`${id}-coordinator-help`} className="h-4 w-4" />
          Coordinador externo
        </label>
        <p id={`${id}-coordinator-help`} className="mt-1 text-xs text-muted-foreground">Recibe notificaciones de nuevas tareas de otros usuarios externos, únicamente cuando ya puede verlas. Conserva los mismos permisos y no puede administrar la plataforma.</p>
      </div>}
      <div>
        <label htmlFor={`${id}-work`} className="block text-sm font-medium">Rol de trabajo <span className="font-normal text-muted-foreground">(opcional)</span></label>
        <input id={`${id}-work`} type="text" value={workRole} maxLength={100} disabled={saving} onChange={event => setWorkRole(event.target.value)} aria-describedby={`${id}-work-help`} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <p id={`${id}-work-help`} className="mt-1 text-xs text-muted-foreground">Dejar vacío hasta que se necesite. Por ahora es informativo y no modifica permisos.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={!changed || saving} onClick={save}>{saving ? "Guardando..." : "Guardar roles"}</Button>
        {feedback && <p role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-destructive" : "text-muted-foreground"}`}>{feedback.text}</p>}
      </div>
    </div>
  </section>;
}
