"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Building2, Check, Eye, FileText, LoaderCircle, Send, Settings2, Tag, UserCheck, Users, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const errorText = (error: unknown, fallback: string) => {
  const data = error instanceof ConvexError ? error.data : null;
  return typeof data === "string" ? data : (data?.message ?? fallback);
};

/** Scene 8: configure the client once, then publish a delivery round with internally approved versions. */
export function SendToClientDialog({
  campaignId,
  preselected,
  onClose,
  onSent,
}: {
  campaignId: Id<"qaVisualCampaigns">;
  preselected?: string[];
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const settings = useQuery(api.qaVisual.clientReview.settings, { campaignId });
  const preview = useQuery(api.qaVisual.clientReview.deliveryPreview, { campaignId });
  const [configuring, setConfiguring] = useState(false);
  const needsConfig = settings && (!settings.client || !settings.enabled);
  const showConfig = configuring || Boolean(needsConfig);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="qa-dialog wide"
      aria-labelledby="qa-send-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="qa-dialog-head">
        <div>
          <h2 id="qa-send-title">
            {showConfig
              ? "Revisión del cliente"
              : `Enviar al cliente · Ronda ${preview?.nextRound ?? "…"}`}
          </h2>
          <p>
            {showConfig
              ? "Elegí el cliente que revisa esta campaña. Accede con su usuario externo y solo ve lo que le envíes."
              : "El cliente ve la imagen, la ficha del pedido y las respuestas que le escribas. Nada interno."}
          </p>
        </div>
        <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {!settings || !preview ? (
        <p className="qa-dialog-body qa-muted">
          <LoaderCircle size={14} className="animate-spin" /> Cargando…
        </p>
      ) : showConfig ? (
        <ClientConfig
          campaignId={campaignId}
          settings={settings}
          onDone={() => setConfiguring(false)}
          onCancel={needsConfig ? onClose : () => setConfiguring(false)}
        />
      ) : (
        <DeliveryForm
          campaignId={campaignId}
          preview={preview}
          clientName={settings.client?.name ?? ""}
          preselected={preselected}
          onConfigure={() => setConfiguring(true)}
          onClose={onClose}
          onSent={onSent}
        />
      )}
    </dialog>
  );
}

type Settings = NonNullable<ReturnType<typeof useQuery<typeof api.qaVisual.clientReview.settings>>>;
type Preview = NonNullable<ReturnType<typeof useQuery<typeof api.qaVisual.clientReview.deliveryPreview>>>;

function ClientConfig({
  campaignId,
  settings,
  onDone,
  onCancel,
}: {
  campaignId: Id<"qaVisualCampaigns">;
  settings: Settings;
  onDone: () => void;
  onCancel: () => void;
}) {
  const configure = useMutation(api.qaVisual.clientReview.configure);
  const [clientId, setClientId] = useState<string>(settings.client?.id ?? "");
  const [brandId, setBrandId] = useState<string>(settings.client?.brandId ?? "");
  const [agencyLabel, setAgencyLabel] = useState(settings.agencyLabel);
  const [fields, setFields] = useState<string[]>(settings.briefFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const brands = useQuery(
    api.qaVisual.clientReview.brands,
    clientId ? { campaignId, clientId: clientId as Id<"corClients"> } : "skip",
  );
  const sameClient = clientId === settings.client?.id;
  async function save() {
    if (!clientId) return setError("Elegí el cliente de la campaña.");
    setSaving(true);
    setError("");
    try {
      await configure({
        campaignId,
        clientId: clientId as Id<"corClients">,
        ...(brandId ? { brandId: brandId as Id<"clientBrands"> } : {}),
        enabled: true,
        agencyLabel,
        briefFields: fields,
      });
      onDone();
    } catch (e) {
      setError(errorText(e, "No se pudo guardar la configuración."));
    } finally {
      setSaving(false);
    }
  }
  const people = sameClient ? settings.people : [];
  const approvers = people.filter((p) => p.role === "pieceApproval").length;
  return (
    <>
      <div className="qa-dialog-body qa-config">
        <section className="qa-config-section">
          <header>
            <span className="qa-config-icon"><Building2 size={15} /></span>
            <div>
              <h3>Cliente y marca</h3>
              <p>Solo acceden las personas del cliente asignadas a esta marca.</p>
            </div>
          </header>
          <div className="qa-config-grid">
            <label className="qa-field">
              <span>Cliente</span>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setBrandId("");
                }}
              >
                <option value="">Elegir un cliente…</option>
                {settings.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qa-field">
              <span>Marca <small>· opcional</small></span>
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={!clientId}>
                <option value="">Todo el cliente</option>
                {(brands ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="qa-config-section">
          <header>
            <span className="qa-config-icon"><UserCheck size={15} /></span>
            <div>
              <h3>Quién ve y aprueba</h3>
              <p>
                Personas del cliente con rol de piezas. El rol se asigna en Externos → Roles del usuario.
                {people.length > 0 && !approvers && " Nadie puede dar la aprobación final todavía."}
              </p>
            </div>
          </header>
          {!people.length ? (
            <div className="qa-config-empty">
              <Users size={16} />
              <span>
                {!clientId
                  ? "Elegí un cliente para ver quiénes tienen acceso."
                  : !sameClient
                    ? "Guardá el cliente para ver quiénes tienen acceso."
                    : "Ninguna persona de este cliente tiene rol de piezas. Asignalo desde Externos → Roles del usuario."}
              </span>
            </div>
          ) : (
            <ul className="qa-people">
              {people.map((p) => (
                <li key={p.id}>
                  <div className="qa-person">
                    <span className="qa-person-avatar" aria-hidden>
                      {(p.name || p.email).slice(0, 1).toUpperCase()}
                    </span>
                    <span className="qa-person-copy">
                      <b>{p.name}</b>
                      <small>{p.email}</small>
                    </span>
                    <span className={`qa-role-badge ${p.role === "pieceApproval" ? "approve" : ""}`}>
                      {p.role === "pieceApproval" ? "Aprueba" : "Revisa"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="qa-config-section">
          <header>
            <span className="qa-config-icon"><FileText size={15} /></span>
            <div>
              <h3>Ficha del pedido</h3>
              <p>Datos del pedido que el cliente ve junto a cada pieza.</p>
            </div>
          </header>
          <div className="qa-pill-checks" role="group" aria-label="Campos visibles para el cliente">
            {settings.availableFields.map((f) => {
              const on = fields.includes(f.key);
              return (
                <label key={f.key} className={on ? "on" : ""}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setFields((prev) =>
                        e.target.checked ? [...prev, f.key] : prev.filter((k) => k !== f.key),
                      )
                    }
                  />
                  <span className="qa-pill-box" aria-hidden>{on && <Check size={11} strokeWidth={3} />}</span>
                  {f.label}
                </label>
              );
            })}
          </div>
        </section>

        <section className="qa-config-section">
          <header>
            <span className="qa-config-icon"><Tag size={15} /></span>
            <div>
              <h3>Nombre de la agencia</h3>
              <p>Así firman las respuestas del equipo en el portal del cliente.</p>
            </div>
          </header>
          <label className="qa-field">
            <span className="sr-only">Nombre de la agencia</span>
            <input value={agencyLabel} maxLength={60} placeholder="PTO99" onChange={(e) => setAgencyLabel(e.target.value)} />
          </label>
          <p className="qa-config-preview">
            El cliente ve las respuestas como <b>{agencyLabel.trim() || "Agencia"} · Nombre</b>
          </p>
        </section>
        {error && <p className="qa-error" role="alert">{error}</p>}
      </div>
      <footer className="qa-dialog-foot">
        <button className="button secondary" onClick={onCancel}>Cancelar</button>
        <button className="button primary" onClick={() => void save()} disabled={saving || !clientId}>
          {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
          Guardar configuración
        </button>
      </footer>
    </>
  );
}

function DeliveryForm({
  campaignId,
  preview,
  clientName,
  preselected,
  onConfigure,
  onClose,
  onSent,
}: {
  campaignId: Id<"qaVisualCampaigns">;
  preview: Preview;
  clientName: string;
  preselected?: string[];
  onConfigure: () => void;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const publish = useMutation(api.qaVisual.clientReview.publishDelivery);
  const eligibleIds = useMemo(() => preview.eligible.map((p) => p.pieceVersionId as string), [preview.eligible]);
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        preselected?.length ? preselected.filter((id) => eligibleIds.includes(id)) : eligibleIds,
      ),
  );
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  async function send() {
    setSending(true);
    setError("");
    try {
      await publish({
        campaignId,
        pieceVersionIds: [...chosen] as Id<"qaVisualPieceVersions">[],
        ...(message.trim() ? { message: message.trim() } : {}),
        requestId: requestId.current,
      });
      onSent(`Ronda ${preview.nextRound} enviada al cliente · ${chosen.size} piezas`);
      onClose();
    } catch (e) {
      requestId.current = crypto.randomUUID();
      setError(errorText(e, "No se pudo enviar la ronda. Revisá la lista y volvé a intentar."));
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="qa-dialog-body">
        <div className="qa-section-title">
          <span>Listas para enviar · {preview.eligible.length}</span>
          <span style={{ display: "flex", gap: 12 }}>
            <a className="qa-link" href={`/workspace/reviews/${campaignId}`} target="_blank" rel="noreferrer">
              <Eye size={12} /> Ver como el cliente
            </a>
            <button className="qa-link" onClick={onConfigure}>
              <Settings2 size={12} /> Configuración del cliente
            </button>
          </span>
        </div>
        {!preview.eligible.length ? (
          <p className="qa-muted qa-box">
            Todavía no hay piezas con aprobación interna sin enviar. Aprobá las versiones en el editor y volvé a abrir este diálogo.
          </p>
        ) : (
          <ul className="qa-send-list">
            {preview.eligible.map((p) => (
              <li key={p.pieceVersionId}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(p.pieceVersionId)}
                    onChange={() => toggle(p.pieceVersionId)}
                  />
                  <span>
                    <b>{p.title}</b>
                    <small>
                      v{p.internalVersion} interna → <em>V{p.nextClientVersion} del cliente</em>
                      {p.previousClientState === "changesRequested" && " · responde a los cambios pedidos"}
                      {p.withException && " · aprobada con excepción"}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {preview.blocked.length > 0 && (
          <>
            <div className="qa-section-title">
              <span>No se pueden enviar · {preview.blocked.length}</span>
            </div>
            <ul className="qa-send-list off">
              {preview.blocked.slice(0, 40).map((p) => (
                <li key={p.pieceVersionId}>
                  <span>
                    <b>{p.title}</b>
                    <small>{p.reason}</small>
                  </span>
                </li>
              ))}
              {preview.blocked.length > 40 && <li className="qa-muted">y {preview.blocked.length - 40} más</li>}
            </ul>
          </>
        )}
        <label className="qa-field">
          <span>Mensaje para el cliente <small>(opcional)</small></span>
          <textarea
            value={message}
            maxLength={2000}
            rows={3}
            placeholder="Hola, les compartimos la nueva ronda…"
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <p className="qa-muted">
          <Building2 size={12} /> {clientName} · {preview.recipients}{" "}
          {preview.recipients === 1 ? "persona puede revisarla" : "personas pueden revisarla"}
        </p>
        {error && <p className="qa-error" role="alert">{error}</p>}
      </div>
      <footer className="qa-dialog-foot">
        <span className="qa-muted">{chosen.size} piezas · Ronda {preview.nextRound}</span>
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        <button
          className="button primary"
          disabled={!chosen.size || sending}
          onClick={() => void send()}
        >
          {sending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
          Enviar ronda {preview.nextRound}
        </button>
      </footer>
    </>
  );
}
