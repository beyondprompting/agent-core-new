import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  AlertCircle,
  Check,
  Download,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { campaignError } from "@/app/lib/qa-visual/campaign-model";
import type { FolderInspection, SourceSelection } from "./FolderChecklist";

type Mapping = NonNullable<
  Extract<FolderInspection, { folder: unknown }>["mapping"]
>;
type Ready = Extract<Mapping, { status: "ready" }>;
type Problem = Ready["problems"][number];
type Candidate = NonNullable<Problem["candidates"]>[number];
type Review = FunctionReturnType<
  typeof api.qaVisual.campaignRegistration.reviewMapping
>;
type Suggestion = Review["suggestions"][number];
type Edit = FunctionArgs<
  typeof api.qaVisual.campaignRegistration.applyCsvFix
>["edits"][number];
type Choice = {
  csvLine?: number;
  order?: string;
  mode?: "csv" | "same";
  scope?: "campaign" | "client";
};
const PREVIEW = 6;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Row and order values arrive as a list: Convex field names cannot be «CAMPAÑA». */
const valueOf = (
  values: { column: string; value: string }[] | undefined,
  column: string,
) => values?.find((item) => item.column === column)?.value ?? "";

const rowLabel = (row: Ready["freeRows"][number]) =>
  [
    `Línea ${row.csvLine}`,
    row.id || "(sin ID)",
    valueOf(row.values, "FORMATO_TIPO"),
    valueOf(row.values, "ANCHO_PX") && valueOf(row.values, "ALTO_PX")
      ? `${valueOf(row.values, "ANCHO_PX")}×${valueOf(row.values, "ALTO_PX")}`
      : "",
    valueOf(row.values, "SLOT_FECHA"),
  ]
    .filter(Boolean)
    .join(" · ");

const orderLabel = (order: Candidate) =>
  [
    `Fila ${order.row}`,
    valueOf(order.values, "FORMATO_TIPO"),
    valueOf(order.values, "MEDIO_PLATAFORMA"),
    order.width && order.height ? `${order.width}×${order.height}` : "",
    order.date,
    order.differences.length
      ? `difiere en ${order.differences.map((d) => d.column).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** Changes of the CSV that the choices of the panel produce. */
function choiceEdits(
  problems: Problem[],
  choices: Record<string, Choice>,
  rows: Ready["freeRows"],
  suggestions: Map<string, Suggestion>,
): Edit[] {
  return problems.flatMap((problem): Edit[] => {
    const choice = choices[problem.piece];
    const suggestion = suggestions.get(problem.piece);
    if (!choice) return [];
    if (choice.csvLine !== undefined) {
      const row = rows.find((r) => r.csvLine === choice.csvLine);
      if (!row) return [];
      const fromAi =
        suggestion?.csvLine === row.csvLine && suggestion.edits.length > 0;
      return [
        {
          csvLine: row.csvLine,
          column: "ID_PIEZA",
          from: row.id,
          to: stem(problem.piece),
          piece: problem.piece,
          reason: fromAi
            ? suggestion.explanation
            : "Fila elegida a mano en el panel.",
          origin: fromAi ? "ai" : "manual",
        },
      ];
    }
    if (choice.order && choice.mode === "csv") {
      const order = problem.candidates?.find((c) => c.row === choice.order);
      const csvLine = problem.csvLines?.[0];
      if (!order || !csvLine) return [];
      const fromAi =
        suggestion?.order === order.row && suggestion.edits.length > 0;
      return order.differences.map((d) => ({
        csvLine,
        column: d.column,
        from: d.csvValue,
        to: d.matrixValue,
        piece: problem.piece,
        reason: fromAi
          ? suggestion.explanation
          : `Se copia el valor del pedido de la fila ${order.row} de la matriz.`,
        origin: fromAi ? ("ai" as const) : ("manual" as const),
        order: order.row,
      }));
    }
    return [];
  });
}

/**
 * «Mapeo de piezas» (§5.5). Code compares the pieces, the CSV and the matrix and shows every
 * difference. For each one the team can choose the CSV row or the matrix order by hand, ask
 * Gemini Neon to explain it and propose a fix, fix the CSV in Drive and update, approve that
 * two values say the same, or exclude the piece. Every change is verified by code and needs
 * an explicit authorization. Only the internal CSV can be modified; the client's matrix never.
 */
export function MappingPanel({
  mapping,
  target,
  selection,
  disabled,
  onBusy,
  onChanged,
}: {
  mapping: Mapping;
  target: { folderUrl: string } | { campaignId: string };
  selection: SourceSelection;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  /** The CSV, the exclusions or the equivalences changed: verify again. */
  onChanged: (inspection?: FolderInspection) => void;
}) {
  const campaignId =
    "campaignId" in target
      ? (target.campaignId as Id<"qaVisualCampaigns">)
      : undefined;
  const where = campaignId
    ? { campaignId }
    : { folderUrl: "folderUrl" in target ? target.folderUrl : "" };
  const reviewMapping = useAction(
    api.qaVisual.campaignRegistration.reviewMapping,
  );
  const check = useAction(api.qaVisual.campaignRegistration.checkCsvFix);
  const apply = useAction(api.qaVisual.campaignRegistration.applyCsvFix);
  const approve = useAction(
    api.qaVisual.campaignRegistration.approveEquivalence,
  );
  const exclude = useMutation(api.qaVisual.overrides.excludePieces);
  const include = useMutation(api.qaVisual.overrides.includePiece);
  const revoke = useMutation(api.qaVisual.equivalences.revoke);
  const exclusions = useQuery(
    api.qaVisual.overrides.exclusions,
    campaignId ? { campaignId } : "skip",
  );
  const equivalences = useQuery(
    api.qaVisual.equivalences.list,
    campaignId ? { campaignId } : "skip",
  );
  const [pending, setPending] = useState<
    "review" | "check" | "apply" | "exclude" | "approve" | "refresh" | null
  >(null);
  const [review, setReview] = useState<Review>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [checked, setChecked] = useState<{
    key: string;
    errors?: string[];
    warnings?: string[];
    next?: string[];
  }>();
  const [authorized, setAuthorized] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fixed, setFixed] = useState<{ name: string; content: string }>();
  const busy = disabled || Boolean(pending);

  const ready = mapping.status === "ready" ? mapping : undefined;
  const suggestions = useMemo(
    () => new Map((review?.suggestions ?? []).map((s) => [s.piece, s])),
    [review],
  );
  const edits = useMemo(
    () =>
      ready
        ? choiceEdits(ready.problems, choices, ready.freeRows, suggestions)
        : [],
    [ready, choices, suggestions],
  );
  const editsKey = JSON.stringify(edits);
  const verified =
    checked?.key === editsKey && !checked.errors?.length ? checked : undefined;
  const takenLines = new Map(
    Object.entries(choices).flatMap(([piece, c]) =>
      c.csvLine !== undefined ? [[c.csvLine, piece] as const] : [],
    ),
  );

  async function run<T>(
    kind: NonNullable<typeof pending>,
    task: () => Promise<T>,
  ) {
    setPending(kind);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      return await task();
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      setPending(null);
      onBusy(false);
    }
  }

  const choose = (piece: string, choice: Choice | undefined) => {
    setChoices((current) => {
      const next = { ...current };
      if (choice) next[piece] = choice;
      else delete next[piece];
      return next;
    });
    setAuthorized(false);
  };

  const reset = () => {
    setReview(undefined);
    setChoices({});
    setChecked(undefined);
    setAuthorized(false);
  };

  const askNeon = () =>
    run("review", async () => {
      setFixed(undefined);
      const result = await reviewMapping({ ...where, ...selection });
      if (result.error) return setError(result.error);
      setReview(result);
      // Neon's verified proposals start chosen; the team can change any of them.
      const next: Record<string, Choice> = {};
      for (const s of result.suggestions)
        if (s.edits.length && s.csvLine !== undefined)
          next[s.piece] = { csvLine: s.csvLine };
        else if (s.order)
          next[s.piece] = {
            order: s.order,
            ...(s.edits.length ? { mode: "csv" as const } : {}),
          };
      setChoices(next);
      setChecked(undefined);
      setAuthorized(false);
    });

  const verifyEdits = () =>
    run("check", async () => {
      if (!ready) return;
      const result = await check({
        ...where,
        ...selection,
        csvVersion: ready.csv.version,
        edits,
      });
      if (result.error) return setError(result.error);
      setChecked({ key: editsKey, ...result });
    });

  const authorize = () =>
    run("apply", async () => {
      if (!ready) return;
      const model = review?.model;
      const result = await apply({
        ...where,
        ...selection,
        csvVersion: ready.csv.version,
        edits,
        ...(model ? { model } : {}),
      });
      if (result.error) {
        setError(result.error);
        if (result.download) setFixed(result.download);
        return;
      }
      reset();
      setNotice(
        `Se aplicaron ${result.applied} ${result.applied === 1 ? "cambio" : "cambios"} en «${ready.csv.name}». Drive guarda la versión anterior.` +
          (campaignId
            ? " La campaña se está actualizando con el CSV corregido."
            : ""),
      );
      onChanged(result.inspection);
    });

  const approveSame = (problem: Problem, choice: Choice) =>
    run("approve", async () => {
      const order = problem.candidates?.find((c) => c.row === choice.order);
      if (!campaignId || !order) return;
      const result = await approve({
        campaignId,
        ...selection,
        piece: problem.piece,
        order: order.row,
        scope: choice.scope ?? "campaign",
        equivalences: order.differences,
      });
      if (result.error) return setError(result.error);
      choose(problem.piece, undefined);
      setNotice(
        `Equivalencia aprobada ${choice.scope === "client" ? "para todas las campañas del cliente" : "para esta campaña"}. El CSV no se modificó. La campaña se está actualizando.`,
      );
      onChanged(result.inspection);
    });

  const refresh = () =>
    run("refresh", async () => {
      reset();
      onChanged();
    });

  const excludeChosen = () =>
    run("exclude", async () => {
      if (!campaignId) return;
      const { excluded } = await exclude({
        campaignId,
        fileNames: chosen,
        note: reason,
      });
      for (const piece of chosen) choose(piece, undefined);
      setChosen([]);
      setReason("");
      setNotice(
        `${excluded} ${excluded === 1 ? "pieza excluida" : "piezas excluidas"} del análisis. La campaña se está actualizando.`,
      );
      onChanged();
    });

  if (!ready)
    return (
      <section className="qc-mapping" aria-label="Mapeo de piezas">
        <div className="qc-callout danger" role="alert">
          <AlertCircle size={16} aria-hidden />
          <div>
            <strong>No se pudo revisar el mapeo de piezas</strong>
            <p>{mapping.status === "error" ? mapping.error : ""}</p>
          </div>
        </div>
      </section>
    );

  const complete = ready.unmapped === 0;
  const byPiece = new Map(ready.problems.map((p) => [p.piece, p]));

  function problemCard(problem: Problem, rows: Ready["freeRows"]) {
    const suggestion = suggestions.get(problem.piece);
    const choice = choices[problem.piece] ?? {};
    const order = problem.candidates?.find((c) => c.row === choice.order);
    return (
      <li key={problem.piece} className="qc-mapping-item">
        <div className="qc-mapping-item-head">
          {campaignId ? (
            <label title="Marcar para excluir del análisis">
              <input
                type="checkbox"
                checked={chosen.includes(problem.piece)}
                disabled={busy}
                onChange={(event) =>
                  setChosen(
                    event.target.checked
                      ? [...chosen, problem.piece]
                      : chosen.filter((p) => p !== problem.piece),
                  )
                }
              />
              <code>{problem.piece}</code>
            </label>
          ) : (
            <code>{problem.piece}</code>
          )}
          {problem.width && problem.height ? (
            <small>
              {problem.width}×{problem.height}
            </small>
          ) : null}
        </div>
        {suggestion && (
          <p className="qc-mapping-explain">
            {suggestion.source === "ai" && (
              <em className="ai">
                <Sparkles size={11} aria-hidden /> Gemini Neon
              </em>
            )}
            {suggestion.explanation}
          </p>
        )}
        {suggestion?.rejected && (
          <p className="qc-mapping-rejected">{suggestion.rejected}</p>
        )}

        {problem.status === "csv_missing" && (
          <label className="qc-mapping-field">
            <span>Fila del CSV de esta pieza</span>
            <select
              value={choice.csvLine ?? ""}
              disabled={busy || !rows.length}
              onChange={(event) =>
                choose(
                  problem.piece,
                  event.target.value
                    ? { csvLine: Number(event.target.value) }
                    : undefined,
                )
              }
            >
              <option value="">
                {rows.length
                  ? "Elegir una fila libre…"
                  : "No hay filas libres en el CSV"}
              </option>
              {rows.map((row) => {
                const owner = takenLines.get(row.csvLine);
                return (
                  <option
                    key={row.csvLine}
                    value={row.csvLine}
                    disabled={Boolean(owner && owner !== problem.piece)}
                  >
                    {rowLabel(row)}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {problem.status === "csv_duplicate" && (
          <p className="qc-mapping-explain">
            Las líneas {problem.csvLines?.join(", ")} repiten este ID. Asigná
            las que sobran a sus piezas desde este panel o borralas en Drive.
          </p>
        )}

        {problem.status === "matrix_missing" && (
          <>
            {problem.csv && (
              <p className="qc-mapping-explain">
                Fila del CSV (línea {problem.csvLines?.[0]}):{" "}
                {[
                  "CAMPAÑA",
                  "FASE",
                  "CANAL",
                  "MEDIO_PLATAFORMA",
                  "FORMATO_TIPO",
                ]
                  .map((column) => valueOf(problem.csv, column))
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <label className="qc-mapping-field">
              <span>Pedido de la matriz que le corresponde</span>
              <select
                value={choice.order ?? ""}
                disabled={busy || !problem.candidates?.length}
                onChange={(event) =>
                  choose(
                    problem.piece,
                    event.target.value
                      ? { order: event.target.value }
                      : undefined,
                  )
                }
              >
                <option value="">
                  {problem.candidates?.length
                    ? "Elegir un pedido…"
                    : "Ningún pedido se parece a esta fila"}
                </option>
                {problem.candidates?.map((candidate) => (
                  <option key={candidate.row} value={candidate.row}>
                    {orderLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
            {order && (
              <div className="qc-mapping-choice">
                <ul className="qc-mapping-diffs">
                  {order.differences.map((d) => (
                    <li key={d.column}>
                      <b>{d.column}</b>: CSV{" "}
                      <del>{d.csvValue || "(vacío)"}</del> · matriz{" "}
                      <ins>{d.matrixValue}</ins>
                    </li>
                  ))}
                </ul>
                <label>
                  <input
                    type="radio"
                    name={`mode-${problem.piece}`}
                    checked={choice.mode === "csv"}
                    disabled={busy}
                    onChange={() =>
                      choose(problem.piece, { ...choice, mode: "csv" })
                    }
                  />
                  Corregir el CSV con los valores del pedido
                </label>
                <label>
                  <input
                    type="radio"
                    name={`mode-${problem.piece}`}
                    checked={choice.mode === "same"}
                    disabled={busy || !campaignId}
                    onChange={() =>
                      choose(problem.piece, {
                        ...choice,
                        mode: "same",
                        scope: choice.scope ?? "campaign",
                      })
                    }
                  />
                  Dicen lo mismo: dejar el CSV como está
                </label>
                {!campaignId && (
                  <small>
                    Para aprobar una equivalencia, primero agregá la campaña.
                  </small>
                )}
                {choice.mode === "same" && campaignId && (
                  <div className="qc-mapping-same">
                    <select
                      value={choice.scope ?? "campaign"}
                      disabled={busy}
                      onChange={(event) =>
                        choose(problem.piece, {
                          ...choice,
                          scope: event.target.value as "campaign" | "client",
                        })
                      }
                    >
                      <option value="campaign">Solo para esta campaña</option>
                      <option value="client" disabled={!equivalences?.canShare}>
                        Para todas las campañas del cliente
                        {equivalences?.canShare
                          ? ""
                          : " (la campaña no tiene cliente)"}
                      </option>
                    </select>
                    <button
                      type="button"
                      className="qc-button secondary small"
                      disabled={busy}
                      onClick={() => void approveSame(problem, choice)}
                    >
                      {pending === "approve" ? (
                        <LoaderCircle
                          size={14}
                          className="qc-spin"
                          aria-hidden
                        />
                      ) : (
                        <Check size={14} aria-hidden />
                      )}
                      Aprobar equivalencia
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {problem.status === "matrix_ambiguous" &&
          (problem.candidates?.length ?? 0) > 0 && (
            <p className="qc-mapping-explain">
              Pedidos posibles:{" "}
              {problem.candidates!.map((c) => orderLabel(c)).join(" / ")}
            </p>
          )}
      </li>
    );
  }

  return (
    <section className="qc-mapping" aria-labelledby="qc-mapping-title">
      <header className="qc-mapping-head">
        <span className={`qc-check-icon ${complete ? "ok" : "choose"}`}>
          {complete ? (
            <Check size={14} aria-hidden />
          ) : (
            <AlertCircle size={14} aria-hidden />
          )}
        </span>
        <div>
          <strong id="qc-mapping-title">
            Mapeo de piezas · {ready.linked} de {ready.total} vinculadas
            {ready.excluded ? ` · ${ready.excluded} excluidas` : ""}
          </strong>
          <p>
            {complete
              ? "Cada pieza tiene su fila en el CSV y su pedido en la matriz."
              : `${ready.unmapped} ${ready.unmapped === 1 ? "pieza no se puede vincular" : "piezas no se pueden vincular"}. ` +
                (campaignId
                  ? "El análisis se habilita cuando todas estén vinculadas o excluidas."
                  : "Podés agregar la campaña igual: el análisis se habilita cuando todas estén vinculadas o excluidas.")}
          </p>
        </div>
      </header>

      {!complete && (
        <div className="qc-check-actions">
          <button
            type="button"
            className="qc-button secondary small"
            disabled={busy}
            onClick={() => void askNeon()}
          >
            {pending === "review" ? (
              <LoaderCircle size={14} className="qc-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}
            {pending === "review"
              ? "Revisando…"
              : review
                ? "Volver a revisar con Gemini Neon"
                : "Revisar con Gemini Neon"}
          </button>
          <button
            type="button"
            className="qc-button ghost small"
            disabled={busy}
            onClick={() => void refresh()}
            title="Después de corregir el CSV en Drive"
          >
            <RefreshCw
              size={14}
              className={pending === "refresh" ? "qc-spin" : undefined}
              aria-hidden
            />
            Actualizar
          </button>
          <p className="qc-mapping-note">
            Gemini Neon explica cada diferencia y propone cómo corregirla, sin
            cambiar nada. También podés elegir a mano o corregir el CSV en Drive
            y tocar «Actualizar». Solo se puede modificar el CSV: la matriz del
            cliente nunca se modifica.
          </p>
        </div>
      )}

      {ready.groups.map((group) => {
        const open = expanded.includes(group.code);
        const shown = open ? group.pieces : group.pieces.slice(0, PREVIEW);
        return (
          <div key={group.code} className="qc-mapping-group">
            <strong>{group.title}</strong>
            <p>{group.detail}</p>
            <ul className="qc-mapping-list">
              {shown.flatMap((piece) => {
                const problem = byPiece.get(piece);
                return problem ? [problemCard(problem, ready.freeRows)] : [];
              })}
            </ul>
            {group.pieces.length > PREVIEW && (
              <button
                type="button"
                className="qc-link-button"
                onClick={() =>
                  setExpanded(
                    open
                      ? expanded.filter((c) => c !== group.code)
                      : [...expanded, group.code],
                  )
                }
              >
                {open ? "Ver menos" : `Ver las ${group.pieces.length}`}
              </button>
            )}
          </div>
        );
      })}

      {campaignId && chosen.length > 0 && (
        <div className="qc-mapping-exclude">
          <label className="qc-label" htmlFor="qc-exclude-reason">
            Excluir {chosen.length} {chosen.length === 1 ? "pieza" : "piezas"}{" "}
            del análisis
          </label>
          <input
            id="qc-exclude-reason"
            value={reason}
            maxLength={500}
            disabled={busy}
            placeholder="Motivo (por ejemplo: es el logo, no se revisa)"
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            className="qc-button secondary small"
            disabled={busy || !reason.trim()}
            onClick={() => void excludeChosen()}
          >
            {pending === "exclude" ? (
              <LoaderCircle size={14} className="qc-spin" aria-hidden />
            ) : (
              <EyeOff size={14} aria-hidden />
            )}
            Excluir del análisis
          </button>
        </div>
      )}

      {edits.length > 0 && (
        <div className="qc-mapping-proposal">
          <strong>
            {edits.length} {edits.length === 1 ? "cambio" : "cambios"} en «
            {ready.csv.name}»
          </strong>
          <ol className="qc-diff">
            {edits.map((edit) => (
              <li key={`${edit.csvLine}:${edit.column}`}>
                <span className="qc-diff-line">
                  Línea {edit.csvLine} · {edit.column}
                  <em className={edit.origin}>
                    {edit.origin === "ai" ? "Gemini Neon" : "Elegido a mano"}
                  </em>
                </span>
                <del>{edit.from || "(vacío)"}</del>
                <ins>{edit.to}</ins>
                <small>{edit.reason}</small>
              </li>
            ))}
          </ol>
          {checked?.key === editsKey && checked.errors?.length ? (
            <div className="qc-callout danger" role="alert">
              <AlertCircle size={16} aria-hidden />
              <div>
                <strong>Los cambios no pasaron la verificación</strong>
                <ul className="qc-mapping-list">
                  {checked.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {verified && (
            <>
              <p className="qc-mapping-note success">
                <ShieldCheck size={13} aria-hidden /> Verificado: solo cambian
                estas celdas, cada pieza queda con su propia fila del CSV, los
                pedidos elegidos son los que quedan vinculados y ninguna pieza
                vinculada pierde su vínculo.
              </p>
              {verified.warnings?.map((w) => (
                <p key={w} className="qc-mapping-rejected">
                  Revisá antes de autorizar: {w}
                </p>
              ))}
              {verified.next?.map((n) => (
                <p key={n} className="qc-mapping-note">
                  {n} Lo vas a poder resolver en el próximo paso.
                </p>
              ))}
              {!ready.csv.canEdit && (
                <p className="qc-mapping-note">
                  La cuenta de servicio no tiene permiso de <b>Editor</b> sobre
                  «{ready.csv.name}». Si Drive rechaza el cambio, vas a poder
                  descargar el CSV corregido y reemplazarlo a mano.
                </p>
              )}
              <label className="qc-mapping-authorize">
                <input
                  type="checkbox"
                  checked={authorized}
                  disabled={busy}
                  onChange={(event) => setAuthorized(event.target.checked)}
                />
                Autorizo reemplazar el contenido de «{ready.csv.name}» en Drive
                con estos {edits.length} cambios. Drive guarda la versión
                anterior.
              </label>
            </>
          )}
          <div className="qc-check-actions">
            {!verified ? (
              <button
                type="button"
                className="qc-button primary small"
                disabled={busy}
                onClick={() => void verifyEdits()}
              >
                {pending === "check" ? (
                  <LoaderCircle size={14} className="qc-spin" aria-hidden />
                ) : (
                  <ShieldCheck size={14} aria-hidden />
                )}
                {pending === "check" ? "Verificando…" : "Verificar cambios"}
              </button>
            ) : (
              <button
                type="button"
                className="qc-button primary small"
                disabled={busy || !authorized}
                onClick={() => void authorize()}
              >
                {pending === "apply" ? (
                  <LoaderCircle size={14} className="qc-spin" aria-hidden />
                ) : (
                  <Check size={14} aria-hidden />
                )}
                {pending === "apply"
                  ? "Aplicando…"
                  : `Aplicar ${edits.length} ${edits.length === 1 ? "cambio" : "cambios"}`}
              </button>
            )}
            <button
              type="button"
              className="qc-button ghost small"
              disabled={busy}
              onClick={() => {
                setChoices({});
                setChecked(undefined);
                setAuthorized(false);
              }}
            >
              Descartar cambios
            </button>
          </div>
        </div>
      )}

      {fixed && (
        <div className="qc-check-actions">
          <button
            type="button"
            className="qc-button ghost small"
            onClick={() => download(fixed.name, fixed.content)}
          >
            <Download size={14} aria-hidden />
            Descargar CSV corregido
          </button>
        </div>
      )}

      {ready.orphanRows.length > 0 && (
        <div className="qc-mapping-group">
          <strong>
            Aviso: {ready.orphanRows.length}{" "}
            {ready.orphanRows.length === 1
              ? "fila del CSV no corresponde"
              : "filas del CSV no corresponden"}{" "}
            a ninguna pieza de la carpeta
          </strong>
          <p>
            Puede faltar una pieza en la carpeta o sobrar una fila en el CSV. No
            bloquea el análisis.
          </p>
          <ul className="qc-mapping-list">
            {(expanded.includes("orphans")
              ? ready.orphanRows
              : ready.orphanRows.slice(0, PREVIEW)
            ).map((row) => (
              <li key={row.csvLine}>
                <code>
                  Línea {row.csvLine} · {row.id}
                </code>
              </li>
            ))}
          </ul>
          {ready.orphanRows.length > PREVIEW && (
            <button
              type="button"
              className="qc-link-button"
              onClick={() =>
                setExpanded(
                  expanded.includes("orphans")
                    ? expanded.filter((c) => c !== "orphans")
                    : [...expanded, "orphans"],
                )
              }
            >
              {expanded.includes("orphans")
                ? "Ver menos"
                : `Ver las ${ready.orphanRows.length}`}
            </button>
          )}
        </div>
      )}

      {equivalences && equivalences.items.length > 0 && (
        <div className="qc-mapping-group">
          <strong>Equivalencias aprobadas</strong>
          <ul className="qc-mapping-list">
            {equivalences.items.map((row) => (
              <li key={row.id}>
                <code>
                  {row.column}: «{row.csvValue}» = «{row.matrixValue}»
                </code>
                <small>
                  {row.scope === "client"
                    ? "Para todas las campañas del cliente"
                    : "Solo para esta campaña"}
                  {row.fromOtherCampaign ? " · aprobada en otra campaña" : ""}
                </small>
                <button
                  type="button"
                  className="qc-link-button"
                  disabled={busy}
                  onClick={() =>
                    void run("approve", async () => {
                      if (!campaignId) return;
                      await revoke({ campaignId, equivalenceId: row.id });
                      setNotice(
                        "Se quitó la equivalencia. La campaña se está actualizando.",
                      );
                      onChanged();
                    })
                  }
                >
                  <Undo2 size={12} aria-hidden />
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {exclusions && exclusions.length > 0 && (
        <div className="qc-mapping-group">
          <strong>Excluidas del análisis</strong>
          <ul className="qc-mapping-list">
            {exclusions.map((row) => (
              <li key={row.id}>
                <code>{row.name}</code>
                <small>{row.note}</small>
                <button
                  type="button"
                  className="qc-link-button"
                  disabled={busy}
                  onClick={() =>
                    void run("exclude", async () => {
                      await include({ overrideId: row.id });
                      setNotice(
                        `«${row.name}» vuelve a analizarse. La campaña se está actualizando.`,
                      );
                      onChanged();
                    })
                  }
                >
                  <Undo2 size={12} aria-hidden />
                  Volver a incluir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p className="qc-mapping-note success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="qc-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
