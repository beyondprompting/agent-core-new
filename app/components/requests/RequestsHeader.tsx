export function RequestsHeader({ clientName }: { clientName?: string }) {
  return (
    <header className="px-4 pb-1 pt-7 sm:px-8">
      <p className="mb-1 text-xs text-muted-foreground">{clientName ?? "Tu espacio de tareas"}</p>
      <h1 className="text-2xl font-bold tracking-tight">Mis tareas</h1>
      <p className="mt-1 text-sm text-muted-foreground">Consultá las tareas que creaste y volvé a sus conversaciones.</p>
    </header>
  );
}

