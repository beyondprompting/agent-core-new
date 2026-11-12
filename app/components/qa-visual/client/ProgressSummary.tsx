export function ProgressSummary({
  counts,
}: {
  counts: { total: number; approved: number; changes: number; pending: number };
}) {
  const pct = (n: number) => `${counts.total ? (n / counts.total) * 100 : 0}%`;
  return (
    <div className="qa-progress">
      <b>
        {counts.approved} de {counts.total} aprobadas
      </b>
      <div className="qa-progress-bar" aria-hidden="true">
        <i style={{ width: pct(counts.approved), background: "var(--success)" }} />
        <i style={{ width: pct(counts.changes), background: "var(--danger)" }} />
        <i style={{ width: pct(counts.pending), background: "color-mix(in srgb, var(--client) 55%, var(--surface))" }} />
      </div>
      <div className="qa-progress-legend">
        <span><i style={{ background: "var(--success)" }} />{counts.approved} aprobadas</span>
        <span><i style={{ background: "var(--danger)" }} />{counts.changes} con cambios</span>
        <span><i style={{ background: "color-mix(in srgb, var(--client) 55%, var(--surface))" }} />{counts.pending} por revisar</span>
      </div>
    </div>
  );
}
