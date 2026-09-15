"use client";
import { TaskFieldButtonsContext } from "./TaskFieldButton";
import type { ReactNode } from "react";
import styles from "./TaskMetadataSection.module.css";
export function TaskMetadataSection({ collapsible, children }: { collapsible: boolean; children: ReactNode }) {
  if (!collapsible) return <>{children}</>;
  return <TaskFieldButtonsContext.Provider value={true}><section aria-label="Datos de la tarea" className={styles.fields}>{children}</section></TaskFieldButtonsContext.Provider>;
}
