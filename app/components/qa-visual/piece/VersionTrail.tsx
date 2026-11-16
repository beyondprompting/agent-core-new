import { Bot, Building2, MessageSquareQuote, ShieldCheck } from "lucide-react";
import type { ReviewSession } from "@/app/hooks/qa-visual/use-review-session";

type Detail = NonNullable<ReviewSession["detail"]>;
type VersionRow = Detail["versions"][number];

const AI = {
  validated: { label: "Validada", tone: "success" },
  findings: { label: "Con hallazgos", tone: "warning" },
  partial: { label: "Incompleta", tone: "warning" },
} as const;
const CLIENT = {
  sent: { label: "Enviada", tone: "client" },
  viewed: { label: "Vista", tone: "client" },
  changesRequested: { label: "Pidió cambios", tone: "danger" },
  approved: { label: "Aprobada", tone: "success" },
} as const;
const HUMAN: Record<string, "success" | "danger" | "neutral"> = {
  Aprobada: "success",
  "Cambios solicitados": "danger",
};

/** The three approvals of one version: each version keeps its own AI, team and client result. */
export function VersionApprovals({ version }: { version: VersionRow }) {
  const ai = version.aiVerdict ? AI[version.aiVerdict] : null;
  const client = version.client ? CLIENT[version.client.state] : null;
  return (
    <span className="qa-version-approvals">
      <span className={`qa-chip tone-${ai?.tone ?? "neutral"}`} title="Revisión IA de esta versión">
        <Bot size={11} /> {ai?.label ?? "Sin análisis"}
      </span>
      <span className={`qa-chip tone-${HUMAN[version.humanStatus] ?? "neutral"}`} title="Aprobación del equipo">
        <ShieldCheck size={11} /> {version.humanStatus}
      </span>
      <span className={`qa-chip tone-${client?.tone ?? "neutral"}`} title="Revisión del cliente">
        <Building2 size={11} /> {client ? `${client.label} · V${version.client!.clientVersion}` : "Sin enviar"}
      </span>
    </span>
  );
}

/** What the client asked on the previous version; the AI analysis of this version uses it. */
export function ClientAsks({ asks }: { asks: Detail["clientAsks"] }) {
  if (!asks) return null;
  return (
    <section className="qa-client-asks" aria-label="Cambios pedidos por el cliente">
      <header>
        <MessageSquareQuote size={14} />
        <b>
          Cambios que pidió el cliente
          {asks.internalVersion ? ` en la v${asks.internalVersion}` : ""}
        </b>
      </header>
      <ul>
        {asks.asks.map((ask, i) => (
          <li key={i}>{ask}</li>
        ))}
      </ul>
      <small>La revisión IA de esta versión los toma como parte del pedido.</small>
    </section>
  );
}

/** Compact chain of versions (v1 → v2…) with the current one highlighted. */
export function VersionTrail({ session }: { session: ReviewSession }) {
  const versions = [...(session.detail?.versions ?? [])].sort((a, b) => a.number - b.number);
  if (versions.length < 2) return null;
  return (
    <ol className="qa-version-trail" aria-label="Versiones de la pieza">
      {versions.map((v) => {
        const client = v.client ? CLIENT[v.client.state] : null;
        return (
          <li key={v.id} className={session.version === v.number ? "on" : ""}>
            <button type="button" onClick={() => session.changeVersion(v.number)} title={v.fileName}>
              <b>v{v.number}</b>
              <span className={`tone-${client?.tone ?? HUMAN[v.humanStatus] ?? "neutral"}`}>
                {client ? client.label : v.humanStatus}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
