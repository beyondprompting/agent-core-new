import { History } from "lucide-react";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

export function PieceHistory({ session }: { session: ReviewSession }) {
  const data = session.detail;
  const events: { id: string; at: number; title: string; body: string }[] = [];
  const version = data?.versions.find((v) => v.number === session.version);
  if (version)
    events.push({
      id: version.id,
      at: version.at,
      title: `Versión ${version.number} incorporada`,
      body: version.fileName,
    });
  for (const review of data?.reviewHistory ?? [])
    events.push({
      id: review.id,
      at: review.at,
      title: "Revisión de IA",
      body:
        review.error ??
        {
          validated: "Validada",
          findings: "Con hallazgos",
          partial: "Incompleta",
        }[review.verdict ?? "partial"],
    });
  for (const d of data?.decisions ?? [])
    events.push({
      id: d._id,
      at: d._creationTime,
      title: `${d.author} ${d.decision === "approved" ? "aprobó la versión" : d.decision === "revoked" ? "revocó la decisión" : "solicitó cambios"}`,
      body: d.note ?? d.exception?.note ?? "",
    });
  for (const thread of data?.threads ?? [])
    for (const c of thread.comments)
      events.push({
        id: c._id,
        at: c._creationTime,
        title: `${c.author} ${c.event === "resolved" ? "resolvió el hilo" : c.event === "reopened" ? "reabrió el hilo" : "comentó"}`,
        body: c.event ? "" : c.body,
      });
  return (
    <div className="history-scroll">
      <h3>Actividad de esta versión</h3>
      <p className="history-intro">
        Decisiones y comentarios guardados en la campaña.
      </p>
      {(data?.moreReviews ||
        data?.moreDecisions ||
        data?.moreThreads ||
        data?.threads.some((t) => t.moreComments)) && (
        <p className="info-note">
          Vista parcial: hay más actividad guardada que la cargada en este
          panel.
        </p>
      )}
      <div className="timeline">
        {events
          .sort((a, b) => b.at - a.at)
          .map((event) => (
            <div key={event.id}>
              <span className="timeline-icon">
                <History size={13} />
              </span>
              <strong>{event.title}</strong>
              {event.body && <p>{event.body}</p>}
              <small>
                {new Date(event.at).toLocaleString()} · Versión{" "}
                {session.version}
              </small>
            </div>
          ))}
      </div>
      {!data && <p>Cargando historial…</p>}
    </div>
  );
}
