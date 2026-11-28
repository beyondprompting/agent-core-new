import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleCheck,
  CircleDashed,
  Download,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { campaignError } from "@/app/lib/qa-visual/campaign-model";
import {
  foldName as fold,
  nameWords as words,
  rankRows,
} from "@/convex/qaVisual/model/similarity";
import type { FolderInspection, SourceSelection } from "./FolderChecklist";

type Mapping = NonNullable<
  Extract<FolderInspection, { folder: unknown }>["mapping"]
>;
type Ready = Extract<Mapping, { status: "ready" }>;
type Problem = Ready["problems"][number];
type Candidate = NonNullable<Problem["candidates"]>[number];
type Row = Ready["freeRows"][number];
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
type PieceState = "pending" | "chosen" | "approve" | "exclude";
type View =
  | { kind: "piece"; piece: string }
  | { kind: "changes" | "orphans" | "equivalences" | "exclusions" };

/** Names of the identity columns for people. */
const columnName: Record<string, string> = {
  CAMPAÑA: "Campaña",
  FASE: "Fase",
  CANAL: "Canal",
  MEDIO_PLATAFORMA: "Plataforma",
  FORMATO_TIPO: "Formato",
};
/** «FECHAS_HOY.ai» → «HOY»: the date slot as the team says it. */
const shortDate = (slot: string) =>
  slot.replace(/^FECHAS?_/i, "").replace(/\.ai$/i, "");
const statusName: Record<Problem["status"], string> = {
  csv_missing: "Sin fila en el CSV",
  csv_duplicate: "ID repetido en el CSV",
  matrix_missing: "Sin pedido en la matriz",
  matrix_ambiguous: "Más de un pedido posible",
};
const stateName: Record<PieceState, string> = {
  pending: "Pendiente",
  chosen: "Cambio elegido",
  approve: "Falta aprobar",
  exclude: "Para excluir",
};

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
/** Pieces per request to Gemini and requests at the same time (REVIEW_BATCH on the server). */
const BATCH = 15;
const PARALLEL = 3;

/** Start shared by every name, cut at an underscore, shown once above the list. */
function commonPrefix(names: string[]) {
  if (names.length < 2) return "";
  let prefix = names[0];
  for (const name of names) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  const cut = prefix.lastIndexOf("_");
  return cut >= 7 ? prefix.slice(0, cut + 1) : "";
}

/** Row and order values arrive as a list: Convex field names cannot be «CAMPAÑA». */
const valueOf = (
  values: { column: string; value: string }[] | undefined,
  column: string,
) => values?.find((item) => item.column === column)?.value ?? "";

const rowSize = (row: Row) => {
  const width = Number(valueOf(row.values, "ANCHO_PX"));
  const height = Number(valueOf(row.values, "ALTO_PX"));
  return width && height ? { width, height } : undefined;
};

/**
 * A file name or an ID that wraps between its words. Words that are not in `other` are
 * highlighted, so two long names can be compared at a glance.
 */
function Name({
  text,
  other,
  prefix = "",
}: {
  text: string;
  other?: Set<string>;
  prefix?: string;
}) {
  const shown =
    prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
  const parts = shown.split(/([^\p{L}\p{N}]+)/u);
  return (
    <>
      {prefix && text.startsWith(prefix) && (
        <span className="qc-name-prefix">
          {prefix.split("_").map((part, i, all) => (
            <Fragment key={i}>
              {part}
              {i < all.length - 1 && (
                <>
                  _<wbr />
                </>
              )}
            </Fragment>
          ))}
        </span>
      )}
      {parts.map((part, i) =>
        i % 2 ? (
          <Fragment key={i}>
            {part}
            <wbr />
          </Fragment>
        ) : part && other && !other.has(fold(part)) ? (
          <mark key={i} className="qc-diff-word">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

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

/** One line in «Fuentes»: how many pieces are linked; the details are in «Piezas». */
export function MappingSummary({
  mapping,
  canContinue,
  onOpen,
}: {
  mapping: Mapping;
  canContinue: boolean;
  onOpen: () => void;
}) {
  const complete = mapping.status === "ready" && mapping.unmapped === 0;
  return (
    <div className="qc-mapping-summary-card">
      <span
        className={`qc-check-icon ${mapping.status === "error" ? "missing" : complete ? "ok" : "choose"}`}
      >
        {complete ? (
          <Check size={14} aria-hidden />
        ) : (
          <AlertCircle size={14} aria-hidden />
        )}
      </span>
      <div>
        <strong>
          Mapeo de piezas
          {mapping.status === "ready"
            ? ` · ${mapping.linked} de ${mapping.total} vinculadas`
            : ""}
        </strong>
        <p>
          {mapping.status === "error"
            ? mapping.error
            : complete
              ? "Cada pieza tiene su fila en el CSV y su pedido en la matriz."
              : `${mapping.unmapped} ${mapping.unmapped === 1 ? "pieza para revisar" : "piezas para revisar"} en el paso siguiente.`}
        </p>
      </div>
      {canContinue && mapping.status === "ready" && (
        <button
          type="button"
          className="qc-button secondary small"
          onClick={onOpen}
        >
          {complete ? "Ver piezas" : "Revisar piezas"}
          <ArrowRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * «Mapeo de piezas» (§5.5). Code compares the pieces, the CSV and the matrix and shows every
 * difference. For each one the team can choose the CSV row or the matrix order by hand, ask
 * Gemini to explain it and propose a fix, fix the CSV in Drive and update, approve that
 * two values say the same, or exclude the piece. Every change is verified by code and needs
 * an explicit authorization. Only the internal CSV can be modified; the client's matrix never.
 *
 * Layout: the pieces to solve on the left, the selected one (or the changes to apply) on the
 * right, and a bar with what is ready to apply or exclude.
 */
export function MappingPanel({
  mapping,
  target,
  selection,
  disabled,
  loading = false,
  onBusy,
  onChanged,
}: {
  mapping: Mapping;
  target: { folderUrl: string } | { campaignId: string };
  selection: SourceSelection;
  disabled: boolean;
  /** The folder is being inspected again. */
  loading?: boolean;
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
    "check" | "apply" | "exclude" | "approve" | "refresh" | null
  >(null);
  // Gemini answers arrive by batches and are shown as they come.
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(
    () => new Map(),
  );
  const [reviewing, setReviewing] = useState<{
    queue: Set<string>;
    done: number;
    total: number;
  }>();
  const [aiModel, setAiModel] = useState<string>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [checked, setChecked] = useState<{
    key: string;
    errors?: string[];
    warnings?: string[];
    next?: string[];
  }>();
  const [authorized, setAuthorized] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fixed, setFixed] = useState<{ name: string; content: string }>();
  const [view, setView] = useState<View>();
  const [query, setQuery] = useState("");
  // Search and «Ver todas» of the rows offered to one piece.
  const [picker, setPicker] = useState({ piece: "", text: "", all: false });
  const busy = disabled || Boolean(pending);
  // While Gemini reviews, pieces can be browsed and chosen, but nothing is verified or written.
  const locked = busy || Boolean(reviewing);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  // Pieces whose choice came from Gemini: a new review may replace it, a manual one never.
  const fromGemini = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    onBusy(Boolean(pending) || Boolean(reviewing));
  }, [pending, reviewing, onBusy]);

  const ready = mapping.status === "ready" ? mapping : undefined;
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
    setError("");
    setNotice("");
    try {
      return await task();
    } catch (cause) {
      setError(campaignError(cause));
    } finally {
      setPending(null);
    }
  }

  const choose = (piece: string, choice: Choice | undefined) => {
    fromGemini.current.delete(piece);
    setChoices((current) => {
      const next = { ...current };
      if (choice) next[piece] = choice;
      else delete next[piece];
      return next;
    });
    setAuthorized(false);
  };

  const reset = () => {
    setSuggestions(new Map());
    fromGemini.current.clear();
    setChoices({});
    setChecked(undefined);
    setAuthorized(false);
  };

  /** Adds the answers of one batch; Gemini's verified proposals start chosen. */
  function mergeReview(batch: Suggestion[]) {
    const next = { ...choicesRef.current };
    const taken = new Map(
      Object.entries(next).flatMap(([piece, c]) =>
        c.csvLine !== undefined ? [[c.csvLine, piece] as const] : [],
      ),
    );
    const added = batch.map((s) => {
      const replaceable = !next[s.piece] || fromGemini.current.has(s.piece);
      if (!replaceable) return s;
      if (s.edits.length && s.csvLine !== undefined) {
        const owner = taken.get(s.csvLine);
        // Another batch already proposed this row for another piece.
        if (owner && owner !== s.piece)
          return {
            ...s,
            edits: [],
            csvLine: undefined,
            rejected: `La fila de la línea ${s.csvLine} ya está elegida para otra pieza. Elegí la fila a mano.`,
          };
        next[s.piece] = { csvLine: s.csvLine };
        taken.set(s.csvLine, s.piece);
        fromGemini.current.add(s.piece);
      } else if (s.order) {
        next[s.piece] = {
          order: s.order,
          ...(s.edits.length ? { mode: "csv" as const } : {}),
        };
        fromGemini.current.add(s.piece);
      }
      return s;
    });
    choicesRef.current = next;
    setChoices(next);
    setSuggestions((current) => {
      const merged = new Map(current);
      for (const s of added) merged.set(s.piece, s);
      return merged;
    });
    setChecked(undefined);
    setAuthorized(false);
  }

  /** Reviews the pieces in batches, several at a time, and shows each batch as it arrives. */
  async function askGemini() {
    if (!ready || reviewing) return;
    const pieces = ready.groups.flatMap((g) => g.pieces);
    if (!pieces.length) return;
    setError("");
    setNotice("");
    setFixed(undefined);
    setSuggestions(new Map());
    const batches: string[][] = [];
    for (let i = 0; i < pieces.length; i += BATCH)
      batches.push(pieces.slice(i, i + BATCH));
    setReviewing({ queue: new Set(pieces), done: 0, total: pieces.length });
    let stop = "";
    const worker = async () => {
      for (let batch = batches.shift(); batch; batch = batches.shift()) {
        if (!alive.current || stop) return;
        let result: Awaited<ReturnType<typeof reviewMapping>> | undefined;
        try {
          result = await reviewMapping({
            ...where,
            ...selection,
            pieces: batch,
          });
        } catch (cause) {
          stop = campaignError(cause);
        }
        if (!alive.current) return;
        if (result?.error) stop = result.error;
        if (result && !result.error) {
          mergeReview(result.suggestions);
          if (result.model) setAiModel(result.model);
        }
        const finished = batch;
        setReviewing(
          (current) =>
            current && {
              queue: new Set(
                [...current.queue].filter((p) => !finished.includes(p)),
              ),
              done: current.done + finished.length,
              total: current.total,
            },
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, batches.length) }, worker),
    );
    if (!alive.current) return;
    setReviewing(undefined);
    if (stop) setError(stop);
  }

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
      const model = aiModel;
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
      setView(undefined);
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
  // Pieces in the order of the groups: the list and «Siguiente» follow it.
  const ordered = ready.groups.flatMap((g) =>
    g.pieces.filter((piece) => byPiece.has(piece)),
  );
  const prefix = commonPrefix(ordered.map(stem));
  const stateOf = (piece: string): PieceState => {
    const choice = choices[piece];
    if (chosen.includes(piece)) return "exclude";
    if (
      choice?.csvLine !== undefined ||
      (choice?.order && choice.mode === "csv")
    )
      return "chosen";
    if (choice?.mode === "same") return "approve";
    return "pending";
  };
  const pendingCount = ordered.filter((p) => stateOf(p) === "pending").length;
  const fallback = ordered.find((p) => stateOf(p) === "pending") ?? ordered[0];
  const current: View | undefined =
    view && (view.kind !== "piece" || byPiece.has(view.piece))
      ? view
      : fallback
        ? { kind: "piece", piece: fallback }
        : undefined;
  const currentPiece = current?.kind === "piece" ? current.piece : undefined;
  const nextPending = (() => {
    const at = currentPiece ? ordered.indexOf(currentPiece) : -1;
    return [...ordered.slice(at + 1), ...ordered.slice(0, at)].find(
      (p) => stateOf(p) === "pending",
    );
  })();
  const needle = fold(query.trim());
  const matches = (piece: string) => !needle || fold(piece).includes(needle);
  const others = [
    {
      kind: "orphans" as const,
      label: "Filas del CSV sin pieza",
      count: ready.orphanRows.length,
    },
    {
      kind: "equivalences" as const,
      label: "Equivalencias aprobadas",
      count: equivalences?.items.length ?? 0,
    },
    {
      kind: "exclusions" as const,
      label: "Piezas excluidas",
      count: exclusions?.length ?? 0,
    },
  ].filter((item) => item.count > 0);
  const percent = (n: number) =>
    `${ready.total ? (n / ready.total) * 100 : 0}%`;

  const toggleChosen = (piece: string, on: boolean) =>
    setChosen((list) =>
      on ? [...list, piece] : list.filter((p) => p !== piece),
    );

  function stateIcon(state: PieceState) {
    if (state === "chosen") return <CircleCheck size={12} aria-hidden />;
    if (state === "exclude") return <EyeOff size={12} aria-hidden />;
    return <CircleDashed size={12} aria-hidden />;
  }

  /** A free row of the CSV, as the team recognizes it: format, size and date. */
  function rowFacts(problem: Problem, row: Row) {
    const size = rowSize(row);
    const format = valueOf(row.values, "FORMATO_TIPO");
    const date = shortDate(valueOf(row.values, "SLOT_FECHA"));
    const otherSize =
      size &&
      problem.width &&
      (size.width !== problem.width || size.height !== problem.height);
    return (
      <span className="qc-tags">
        {format && <span className="qc-tag">{format}</span>}
        {size && (
          <span className={`qc-tag${otherSize ? " warn" : ""}`}>
            {size.width}×{size.height}
            {otherSize ? " · otra medida" : ""}
          </span>
        )}
        {date && <span className="qc-tag">{date}</span>}
      </span>
    );
  }

  function orderFacts(problem: Problem, order: Candidate) {
    const otherSize =
      order.width &&
      problem.width &&
      (order.width !== problem.width || order.height !== problem.height);
    return (
      <span className="qc-tags">
        {valueOf(order.values, "FORMATO_TIPO") && (
          <span className="qc-tag">
            {valueOf(order.values, "FORMATO_TIPO")}
          </span>
        )}
        {valueOf(order.values, "MEDIO_PLATAFORMA") && (
          <span className="qc-tag">
            {valueOf(order.values, "MEDIO_PLATAFORMA")}
          </span>
        )}
        {order.width && order.height ? (
          <span className={`qc-tag${otherSize ? " warn" : ""}`}>
            {order.width}×{order.height}
            {otherSize ? " · otra medida" : ""}
          </span>
        ) : null}
        {order.date && <span className="qc-tag">{order.date}</span>}
      </span>
    );
  }

  /** «¿Cuál es la fila de esta pieza?»: one suggested row and the others on demand. */
  function rowSection(problem: Problem, choice: Choice) {
    const pieceSet = new Set(words(stem(problem.piece)));
    const ranked = rankRows(
      { name: problem.piece, width: problem.width, height: problem.height },
      ready!.freeRows,
      rowSize,
    );
    if (!ranked.length)
      return (
        <div className="qc-callout warning">
          <AlertCircle size={16} aria-hidden />
          <p>
            No quedan filas libres en el CSV. Agregá la fila de esta pieza en
            Drive y tocá «Actualizar», o excluila.
          </p>
        </div>
      );
    const picked = ranked.find(({ row }) => row.csvLine === choice.csvLine);
    if (picked)
      return (
        <div className="qc-done">
          <CircleCheck size={18} aria-hidden />
          <div>
            <strong>Elegiste la línea {picked.row.csvLine} del CSV</strong>
            <p>
              Al aplicar los cambios, el ID de esa fila pasa a ser el nombre de
              esta pieza.
            </p>
            {rowFacts(problem, picked.row)}
          </div>
          <button
            type="button"
            className="qc-link-button"
            disabled={busy}
            onClick={() => choose(problem.piece, undefined)}
          >
            Cambiar
          </button>
        </div>
      );
    const takenBy = (row: Row) => {
      const owner = takenLines.get(row.csvLine);
      return owner && owner !== problem.piece ? owner : undefined;
    };
    const best = ranked.find(({ row }) => !takenBy(row));
    const own = picker.piece === problem.piece;
    const open = own && picker.all;
    const search = fold((own ? picker.text : "").trim());
    const others = ranked
      .filter((item) => item !== best)
      .filter(
        ({ row }) =>
          !search ||
          fold(
            [`${row.csvLine}`, row.id, ...row.values.map((v) => v.value)].join(
              " ",
            ),
          ).includes(search),
      );
    return (
      <section className="qc-detail-section">
        <h4 className="qc-question">
          ¿Cuál es la fila de esta pieza en el CSV?
        </h4>
        {best && (
          <div className="qc-suggest">
            <div className="qc-suggest-head">
              <span className="qc-tag primary">Sugerida</span>
              <b>Línea {best.row.csvLine}</b>
              {rowFacts(problem, best.row)}
            </div>
            <code className="qc-option-id" title="ID actual de la fila">
              <Name text={best.row.id || "(sin ID)"} other={pieceSet} />
            </code>
            <div className="qc-suggest-actions">
              <button
                type="button"
                className="qc-button primary small"
                disabled={busy}
                onClick={() =>
                  choose(problem.piece, { csvLine: best.row.csvLine })
                }
              >
                <Check size={14} aria-hidden />
                Usar esta fila
              </button>
              {!open && ranked.length > 1 && (
                <button
                  type="button"
                  className="qc-link-button"
                  onClick={() =>
                    setPicker({ piece: problem.piece, text: "", all: true })
                  }
                >
                  No es esta: ver otras filas ({ranked.length - 1})
                </button>
              )}
            </div>
          </div>
        )}
        {(open || !best) && (
          <div className="qc-more">
            <label className="qc-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                value={own ? picker.text : ""}
                placeholder="Buscar por nombre, línea o formato"
                aria-label="Buscar una fila del CSV"
                onChange={(event) =>
                  setPicker({
                    piece: problem.piece,
                    text: event.target.value,
                    all: true,
                  })
                }
              />
            </label>
            <ul className="qc-picks">
              {others.map(({ row }) => {
                const owner = takenBy(row);
                return (
                  <li key={row.csvLine}>
                    <div>
                      <span className="qc-pick-title">
                        <b>Línea {row.csvLine}</b>
                        {rowFacts(problem, row)}
                      </span>
                      <code className="qc-option-id">
                        <Name text={row.id || "(sin ID)"} other={pieceSet} />
                      </code>
                    </div>
                    <button
                      type="button"
                      className="qc-button secondary small"
                      disabled={busy || Boolean(owner)}
                      title={owner ? `Elegida para ${owner}` : undefined}
                      onClick={() =>
                        choose(problem.piece, { csvLine: row.csvLine })
                      }
                    >
                      {owner ? "En uso" : "Usar"}
                    </button>
                  </li>
                );
              })}
              {!others.length && (
                <li className="qc-mapping-note">
                  Ninguna fila coincide con la búsqueda.
                </li>
              )}
            </ul>
          </div>
        )}
      </section>
    );
  }

  /** The differences of an order with the CSV row, in plain words. */
  function differenceList(order: Candidate) {
    return (
      <ul className="qc-diffs">
        {order.differences.map((d) => (
          <li key={d.column}>
            <b>{columnName[d.column] ?? d.column}</b>
            <span>
              el CSV dice <del>{d.csvValue || "(vacío)"}</del> y la matriz dice{" "}
              <ins>{d.matrixValue}</ins>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  /** «¿Cómo lo corregimos?»: the suggested order, its differences and two buttons. */
  function orderSection(problem: Problem, choice: Choice) {
    const candidates = problem.candidates ?? [];
    const suggestion = suggestions.get(problem.piece);
    const line = problem.csvLines?.[0];
    if (!candidates.length)
      return (
        <div className="qc-callout warning">
          <AlertCircle size={16} aria-hidden />
          <p>
            Ningún pedido de la matriz se parece a esta fila. Revisala en Drive
            y tocá «Actualizar», o excluí la pieza.
          </p>
        </div>
      );
    const order =
      candidates.find((c) => c.row === choice.order) ??
      candidates.find((c) => c.row === suggestion?.order) ??
      candidates[0];
    const own = picker.piece === problem.piece;
    const open = own && picker.all;

    if (choice.order === order.row && choice.mode === "csv")
      return (
        <div className="qc-done">
          <CircleCheck size={18} aria-hidden />
          <div>
            <strong>Se va a corregir la línea {line} del CSV</strong>
            <p>
              Con los valores del pedido de la fila {order.row} de la matriz:
            </p>
            {differenceList(order)}
          </div>
          <button
            type="button"
            className="qc-link-button"
            disabled={busy}
            onClick={() => choose(problem.piece, { order: order.row })}
          >
            Cambiar
          </button>
        </div>
      );

    if (choice.order === order.row && choice.mode === "same" && campaignId)
      return (
        <section className="qc-detail-section">
          <h4 className="qc-question">
            ¿Para qué campañas valen como iguales?
          </h4>
          <div className="qc-suggest">
            {differenceList(order)}
            <select
              className="qc-select"
              value={choice.scope ?? "campaign"}
              disabled={locked}
              aria-label="Alcance de la equivalencia"
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
                {equivalences?.canShare ? "" : " (la campaña no tiene cliente)"}
              </option>
            </select>
            <div className="qc-suggest-actions">
              <button
                type="button"
                className="qc-button primary small"
                disabled={locked}
                onClick={() => void approveSame(problem, choice)}
              >
                {pending === "approve" ? (
                  <LoaderCircle size={14} className="qc-spin" aria-hidden />
                ) : (
                  <Check size={14} aria-hidden />
                )}
                Aprobar
              </button>
              <button
                type="button"
                className="qc-button ghost small"
                disabled={busy}
                onClick={() => choose(problem.piece, { order: order.row })}
              >
                Cancelar
              </button>
            </div>
            <p className="qc-mapping-note">El CSV no se modifica.</p>
          </div>
        </section>
      );

    return (
      <section className="qc-detail-section">
        <h4 className="qc-question">¿Cómo lo corregimos?</h4>
        <div className="qc-suggest">
          <div className="qc-suggest-head">
            <span className="qc-tag primary">
              {order.row === suggestion?.order
                ? "Sugerido por Gemini"
                : choice.order === order.row
                  ? "Elegido"
                  : "Pedido más parecido"}
            </span>
            <b>Fila {order.row} de la matriz</b>
            {orderFacts(problem, order)}
          </div>
          {differenceList(order)}
          <div className="qc-suggest-actions">
            <button
              type="button"
              className="qc-button primary small"
              disabled={busy}
              onClick={() =>
                choose(problem.piece, { order: order.row, mode: "csv" })
              }
            >
              Corregir el CSV
            </button>
            <button
              type="button"
              className="qc-button secondary small"
              disabled={busy || !campaignId}
              title={
                campaignId
                  ? "El CSV queda como está y los valores se toman como iguales"
                  : "Disponible después de agregar la campaña"
              }
              onClick={() =>
                choose(problem.piece, {
                  order: order.row,
                  mode: "same",
                  scope: choice.scope ?? "campaign",
                })
              }
            >
              Son lo mismo
            </button>
          </div>
          <p className="qc-mapping-note">
            «Corregir el CSV» copia{" "}
            {order.differences.length === 1 ? "el valor" : "los valores"} de la
            matriz en la línea {line}. «Son lo mismo» deja el CSV como está
            {campaignId ? "" : " (disponible después de agregar la campaña)"}.
          </p>
        </div>
        {candidates.length > 1 &&
          (open ? (
            <ul className="qc-picks">
              {candidates
                .filter((c) => c !== order)
                .map((candidate) => (
                  <li key={candidate.row}>
                    <div>
                      <span className="qc-pick-title">
                        <b>Fila {candidate.row}</b>
                        {orderFacts(problem, candidate)}
                      </span>
                      <span className="qc-mapping-note">
                        Distinto en{" "}
                        {candidate.differences
                          .map((d) => columnName[d.column] ?? d.column)
                          .join(" y ")}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="qc-button secondary small"
                      disabled={busy}
                      onClick={() =>
                        choose(problem.piece, { order: candidate.row })
                      }
                    >
                      Elegir
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <button
              type="button"
              className="qc-link-button"
              onClick={() =>
                setPicker({ piece: problem.piece, text: "", all: true })
              }
            >
              No es este pedido: ver otros ({candidates.length - 1})
            </button>
          ))}
      </section>
    );
  }

  function pieceDetail(problem: Problem) {
    const suggestion = suggestions.get(problem.piece);
    const choice = choices[problem.piece] ?? {};
    const state = stateOf(problem.piece);
    const line = problem.csvLines?.[0];
    const summary: Record<Problem["status"], string> = {
      csv_missing: "No hay ninguna fila del CSV con este nombre.",
      csv_duplicate: `Su nombre está repetido en las líneas ${problem.csvLines?.join(", ")} del CSV.`,
      matrix_missing: `Su fila del CSV (línea ${line}) no coincide con ningún pedido de la matriz.`,
      matrix_ambiguous: `Su fila del CSV (línea ${line}) coincide con más de un pedido de la matriz.`,
    };
    // The generic explanation of code repeats what the panel already says: only Gemini's is shown.
    const showGeminiNote =
      suggestion &&
      (suggestion.source === "ai" || suggestion.failed || suggestion.rejected);
    return (
      <article className="qc-detail" key={problem.piece}>
        <header className="qc-detail-head">
          <div className="qc-detail-meta">
            <span className="qc-tag warn">{statusName[problem.status]}</span>
            {problem.width && problem.height ? (
              <span className="qc-tag">
                {problem.width}×{problem.height}
              </span>
            ) : null}
            {campaignId && (
              <button
                type="button"
                className="qc-button ghost small qc-detail-exclude"
                disabled={busy}
                onClick={() => toggleChosen(problem.piece, state !== "exclude")}
              >
                <EyeOff size={14} aria-hidden />
                {state === "exclude" ? "No excluir" : "Excluir del análisis"}
              </button>
            )}
          </div>
          <h3 className="qc-detail-name">
            <Name text={stem(problem.piece)} />
            <span className="qc-name-prefix">
              {problem.piece.slice(stem(problem.piece).length)}
            </span>
          </h3>
          <p className="qc-detail-why">{summary[problem.status]}</p>
        </header>

        {reviewing?.queue.has(problem.piece) && !suggestion && (
          <div className="qc-neon">
            <LoaderCircle size={15} className="qc-spin" aria-hidden />
            <div>
              <strong>Gemini</strong>
              <p>Revisando esta pieza…</p>
            </div>
          </div>
        )}
        {showGeminiNote && (
          <div
            className={`qc-neon${suggestion.source === "ai" ? "" : suggestion.failed ? " failed" : " code"}`}
          >
            {suggestion.failed ? (
              <AlertCircle size={15} aria-hidden />
            ) : (
              <Sparkles size={15} aria-hidden />
            )}
            <div>
              <strong>
                {suggestion.source === "ai"
                  ? "Gemini"
                  : "Revisión automática"}
              </strong>
              <p>{suggestion.explanation}</p>
              {suggestion.rejected && (
                <p className="qc-mapping-rejected">{suggestion.rejected}</p>
              )}
            </div>
          </div>
        )}

        {state === "exclude" ? (
          <div className="qc-done muted">
            <EyeOff size={18} aria-hidden />
            <div>
              <strong>Marcada para excluir del análisis</strong>
              <p>Escribí el motivo en la barra de abajo y tocá «Excluir».</p>
            </div>
          </div>
        ) : (
          <>
            {problem.status === "csv_missing" && rowSection(problem, choice)}
            {problem.status === "csv_duplicate" && (
              <p className="qc-mapping-note">
                Elegí estas filas desde las otras piezas de la lista, o borrá la
                que sobra en Drive y tocá «Actualizar».
              </p>
            )}
            {problem.status === "matrix_missing" &&
              orderSection(problem, choice)}
            {problem.status === "matrix_ambiguous" && (
              <section className="qc-detail-section">
                <p className="qc-mapping-note">
                  Estos pedidos dicen lo mismo y tampoco se distinguen por
                  medidas ni por fecha. Completá en Drive las medidas o la fecha
                  de esta pieza en el CSV y tocá «Actualizar», o excluila.
                </p>
                <ul className="qc-picks">
                  {(problem.candidates ?? []).map((candidate) => (
                    <li key={candidate.row}>
                      <span className="qc-pick-title">
                        <b>Fila {candidate.row}</b>
                        {orderFacts(problem, candidate)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {nextPending && (
          <footer className="qc-detail-nav">
            <span>
              {pendingCount} {pendingCount === 1 ? "pendiente" : "pendientes"}
            </span>
            <button
              type="button"
              className={`qc-button small ${state === "pending" ? "secondary" : "primary"}`}
              onClick={() => setView({ kind: "piece", piece: nextPending })}
            >
              {state === "pending" ? "Saltar" : "Siguiente pieza"}
              <ArrowRight size={14} aria-hidden />
            </button>
          </footer>
        )}
      </article>
    );
  }

  function changesDetail() {
    return (
      <article className="qc-detail">
        <header className="qc-detail-head">
          <h3 className="qc-detail-title">
            {edits.length} {edits.length === 1 ? "cambio" : "cambios"} en «
            {ready!.csv.name}»
          </h3>
          <p className="qc-detail-why">
            Solo cambian estas celdas del CSV interno. La matriz del cliente no
            se modifica.
          </p>
        </header>
        {edits.length > 0 ? (
          <ol className="qc-changes">
            {edits.map((edit) => (
              <li key={`${edit.csvLine}:${edit.column}`}>
                <div className="qc-change-head">
                  <b>Línea {edit.csvLine}</b>
                  <span>{edit.column}</span>
                  <em className={`qc-tag ${edit.origin === "ai" ? "ai" : ""}`}>
                    {edit.origin === "ai" ? "Gemini" : "Elegido a mano"}
                  </em>
                  <button
                    type="button"
                    className="qc-link-button"
                    onClick={() =>
                      setView({ kind: "piece", piece: edit.piece })
                    }
                  >
                    Ver pieza
                  </button>
                </div>
                <dl className="qc-change-values">
                  <dt>Antes</dt>
                  <dd>
                    <del>
                      {edit.from ? <Name text={edit.from} /> : "(vacío)"}
                    </del>
                  </dd>
                  <dt>Después</dt>
                  <dd>
                    <ins>
                      <Name text={edit.to} />
                    </ins>
                  </dd>
                </dl>
                <p className="qc-change-reason">{edit.reason}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="qc-mapping-note">Todavía no elegiste ningún cambio.</p>
        )}
        {checked?.key === editsKey && checked.errors?.length ? (
          <div className="qc-callout danger" role="alert">
            <AlertCircle size={16} aria-hidden />
            <div>
              <strong>Los cambios no pasaron la verificación</strong>
              <ul className="qc-plain-list">
                {checked.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {verified && (
          <div className="qc-verify">
            <div className="qc-callout success">
              <ShieldCheck size={16} aria-hidden />
              <p>
                Verificado: solo cambian estas celdas, cada pieza queda con su
                propia fila del CSV, los pedidos elegidos son los que quedan
                vinculados y ninguna pieza vinculada pierde su vínculo.
              </p>
            </div>
            {verified.warnings?.map((w) => (
              <div key={w} className="qc-callout warning">
                <AlertCircle size={16} aria-hidden />
                <p>Revisá antes de autorizar: {w}</p>
              </div>
            ))}
            {verified.next?.map((n) => (
              <div key={n} className="qc-callout info">
                <ArrowRight size={16} aria-hidden />
                <p>{n} Lo vas a poder resolver después de aplicar.</p>
              </div>
            ))}
            {!ready!.csv.canEdit && (
              <p className="qc-mapping-note">
                La cuenta de servicio no tiene permiso de <b>Editor</b> sobre «
                {ready!.csv.name}». Si Drive rechaza el cambio, vas a poder
                descargar el CSV corregido y reemplazarlo a mano.
              </p>
            )}
            <label className="qc-authorize">
              <input
                type="checkbox"
                checked={authorized}
                disabled={locked}
                onChange={(event) => setAuthorized(event.target.checked)}
              />
              <span>
                Autorizo reemplazar el contenido de «{ready!.csv.name}» en Drive
                con estos {edits.length} cambios. Drive guarda la versión
                anterior.
              </span>
            </label>
          </div>
        )}
        {edits.length > 0 && (
          <div className="qc-detail-actions">
            {!verified ? (
              <button
                type="button"
                className="qc-button primary small"
                disabled={locked}
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
                disabled={locked || !authorized}
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
              disabled={locked}
              onClick={() => {
                setChoices({});
                setChecked(undefined);
                setAuthorized(false);
                setView(undefined);
              }}
            >
              Descartar cambios
            </button>
          </div>
        )}
        {fixed && (
          <div className="qc-detail-actions">
            <button
              type="button"
              className="qc-button secondary small"
              onClick={() => download(fixed.name, fixed.content)}
            >
              <Download size={14} aria-hidden />
              Descargar CSV corregido
            </button>
          </div>
        )}
      </article>
    );
  }

  function listDetail(kind: "orphans" | "equivalences" | "exclusions") {
    if (kind === "orphans")
      return (
        <article className="qc-detail">
          <header className="qc-detail-head">
            <h3 className="qc-detail-title">
              {ready!.orphanRows.length}{" "}
              {ready!.orphanRows.length === 1
                ? "fila del CSV no corresponde"
                : "filas del CSV no corresponden"}{" "}
              a ninguna pieza
            </h3>
            <p className="qc-detail-why">
              Puede faltar una pieza en la carpeta o sobrar una fila en el CSV.
              Es solo un aviso: no bloquea el análisis. Estas filas se pueden
              elegir para las piezas sin fila.
            </p>
          </header>
          <ul className="qc-rows">
            {ready!.orphanRows.map((row) => (
              <li key={row.csvLine}>
                <b>Línea {row.csvLine}</b>
                <code>
                  <Name text={row.id} />
                </code>
              </li>
            ))}
          </ul>
        </article>
      );
    if (kind === "equivalences")
      return (
        <article className="qc-detail">
          <header className="qc-detail-head">
            <h3 className="qc-detail-title">Equivalencias aprobadas</h3>
            <p className="qc-detail-why">
              Valores del CSV que dicen lo mismo que la matriz. El CSV no se
              modificó.
            </p>
          </header>
          <ul className="qc-rows">
            {(equivalences?.items ?? []).map((row) => (
              <li key={row.id}>
                <b>{row.column}</b>
                <span>
                  «{row.csvValue}» = «{row.matrixValue}»
                </span>
                <small>
                  {row.scope === "client"
                    ? "Para todas las campañas del cliente"
                    : "Solo para esta campaña"}
                  {row.fromOtherCampaign ? " · aprobada en otra campaña" : ""}
                </small>
                <button
                  type="button"
                  className="qc-link-button"
                  disabled={locked}
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
        </article>
      );
    return (
      <article className="qc-detail">
        <header className="qc-detail-head">
          <h3 className="qc-detail-title">Piezas excluidas del análisis</h3>
        </header>
        <ul className="qc-rows">
          {(exclusions ?? []).map((row) => (
            <li key={row.id}>
              <code>
                <Name text={row.name} />
              </code>
              <small>{row.note}</small>
              <button
                type="button"
                className="qc-link-button"
                disabled={locked}
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
      </article>
    );
  }

  const currentProblem = currentPiece ? byPiece.get(currentPiece) : undefined;

  return (
    <section className="qc-mapping" aria-labelledby="qc-mapping-title">
      <header className="qc-mapping-toolbar">
        <div className="qc-mapping-summary">
          <span className={`qc-check-icon ${complete ? "ok" : "choose"}`}>
            {complete ? (
              <Check size={14} aria-hidden />
            ) : (
              <AlertCircle size={14} aria-hidden />
            )}
          </span>
          <div>
            <strong id="qc-mapping-title">
              {ready.linked} de {ready.total} piezas vinculadas
            </strong>
            <p>
              {complete
                ? "Cada pieza tiene su fila en el CSV y su pedido en la matriz."
                : [
                    `${pendingCount} ${pendingCount === 1 ? "pendiente" : "pendientes"}`,
                    edits.length
                      ? `${edits.length} ${edits.length === 1 ? "cambio elegido" : "cambios elegidos"}`
                      : "",
                    ready.excluded
                      ? `${ready.excluded} ${ready.excluded === 1 ? "excluida" : "excluidas"}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
          <div className="qc-progress qc-mapping-progress" aria-hidden>
            <span
              className="validated"
              style={{ width: percent(ready.linked) }}
            />
            <span
              className="partial"
              style={{ width: percent(ready.excluded) }}
            />
          </div>
        </div>
        <div className="qc-mapping-tools">
          {loading && (
            <span className="qc-loading inline" role="status">
              <LoaderCircle size={14} className="qc-spin" aria-hidden />
              Actualizando…
            </span>
          )}
          {!complete && (
            <button
              type="button"
              className="qc-button secondary small"
              disabled={locked}
              onClick={() => void askGemini()}
              title="Explica cada diferencia y propone cómo corregirla, sin cambiar nada"
            >
              {reviewing ? (
                <LoaderCircle size={14} className="qc-spin" aria-hidden />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
              {reviewing
                ? `Revisando… ${reviewing.done} de ${reviewing.total}`
                : suggestions.size
                  ? "Volver a revisar con Gemini"
                  : "Revisar con Gemini"}
            </button>
          )}
          <button
            type="button"
            className="qc-button ghost small"
            disabled={locked}
            onClick={() => void refresh()}
            title="Volver a leer el CSV y la matriz después de corregirlos en Drive"
          >
            <RefreshCw
              size={14}
              className={pending === "refresh" ? "qc-spin" : undefined}
              aria-hidden
            />
            Actualizar
          </button>
        </div>
      </header>
      {!complete && (
        <p className="qc-mapping-note">
          Gemini propone sin cambiar nada. Solo se modifica el CSV, nunca
          la matriz del cliente.
          {!campaignId &&
            " Excluir piezas y aprobar equivalencias se habilita después de agregar la campaña."}
        </p>
      )}
      {notice && (
        <div className="qc-callout success" role="status">
          <CircleCheck size={16} aria-hidden />
          <p>{notice}</p>
        </div>
      )}
      {error && (
        <div className="qc-callout danger" role="alert">
          <AlertCircle size={16} aria-hidden />
          <p>{error}</p>
        </div>
      )}

      <div className="qc-mapping-workspace">
        <nav className="qc-mapping-list-pane" aria-label="Piezas para revisar">
          {ordered.length > 0 && (
            <div className="qc-mapping-list-head">
              <label className="qc-search">
                <Search size={14} aria-hidden />
                <input
                  type="search"
                  value={query}
                  placeholder="Buscar pieza"
                  aria-label="Buscar pieza"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {prefix && (
                <p className="qc-mapping-prefix">
                  Todas empiezan con <code>{prefix}</code>
                </p>
              )}
            </div>
          )}
          <div className="qc-piece-groups">
            {ready.groups.map((group) => {
              const pieces = group.pieces.filter(
                (piece) => byPiece.has(piece) && matches(piece),
              );
              if (!pieces.length) return null;
              return (
                <div key={group.code} className="qc-piece-group">
                  <h3>
                    {statusName[group.code]}
                    <span>{group.pieces.length}</span>
                  </h3>
                  <ul>
                    {pieces.map((piece) => {
                      const problem = byPiece.get(piece)!;
                      const state = stateOf(piece);
                      const active = piece === currentPiece;
                      return (
                        <li
                          key={piece}
                          className={`qc-piece${active ? " active" : ""}`}
                        >
                          {campaignId && (
                            <input
                              type="checkbox"
                              aria-label={`Marcar ${piece} para excluir`}
                              title="Marcar para excluir del análisis"
                              checked={state === "exclude"}
                              disabled={busy}
                              onChange={(event) =>
                                toggleChosen(piece, event.target.checked)
                              }
                            />
                          )}
                          <button
                            type="button"
                            aria-current={active || undefined}
                            onClick={() => setView({ kind: "piece", piece })}
                          >
                            <span className="qc-piece-name">
                              <Name text={stem(piece).slice(prefix.length)} />
                            </span>
                            <span className="qc-piece-meta">
                              <span className={`qc-piece-state ${state}`}>
                                {stateIcon(state)}
                                {stateName[state]}
                              </span>
                              {problem.width && problem.height ? (
                                <span>
                                  {problem.width}×{problem.height}
                                </span>
                              ) : null}
                              {reviewing?.queue.has(piece) &&
                                !suggestions.has(piece) && (
                                  <LoaderCircle
                                    size={11}
                                    className="qc-spin qc-piece-ai"
                                    aria-label="Gemini la está revisando"
                                  />
                                )}
                              {suggestions.get(piece)?.source === "ai" && (
                                <Sparkles
                                  size={11}
                                  className="qc-piece-ai"
                                  aria-label="Revisada por Gemini"
                                />
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {!ordered.length && (
              <p className="qc-mapping-done">
                <CircleCheck size={16} aria-hidden />
                Todas las piezas están vinculadas.
              </p>
            )}
            {ordered.length > 0 && !ordered.some(matches) && (
              <p className="qc-mapping-note qc-mapping-nomatch">
                Ninguna pieza coincide con «{query}».
              </p>
            )}
          </div>
          {others.length > 0 && (
            <div className="qc-mapping-others">
              {others.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  aria-current={current?.kind === item.kind || undefined}
                  onClick={() => setView({ kind: item.kind })}
                >
                  {item.label}
                  <b>{item.count}</b>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="qc-mapping-detail">
          {current?.kind === "changes" ? (
            changesDetail()
          ) : current?.kind === "orphans" ||
            current?.kind === "equivalences" ||
            current?.kind === "exclusions" ? (
            listDetail(current.kind)
          ) : currentProblem ? (
            pieceDetail(currentProblem)
          ) : (
            <div className="qc-mapping-empty">
              <span className="qc-check-icon ok">
                <Check size={16} aria-hidden />
              </span>
              <strong>Las {ready.total} piezas están listas</strong>
              <p>
                Cada pieza tiene su fila en el CSV y su pedido en la matriz
                {ready.excluded
                  ? `, o está excluida del análisis (${ready.excluded})`
                  : ""}
                .
              </p>
            </div>
          )}
        </div>
      </div>

      {((campaignId && chosen.length > 0) || edits.length > 0) && (
        <div className="qc-mapping-bars">
          {campaignId && chosen.length > 0 && (
            <div className="qc-mapping-bar">
              <EyeOff size={15} aria-hidden />
              <strong>
                {chosen.length}{" "}
                {chosen.length === 1
                  ? "pieza para excluir"
                  : "piezas para excluir"}
              </strong>
              <input
                value={reason}
                maxLength={500}
                disabled={busy}
                aria-label="Motivo de la exclusión"
                placeholder="Motivo (por ejemplo: es el logo, no se revisa)"
                onChange={(event) => setReason(event.target.value)}
              />
              <button
                type="button"
                className="qc-button ghost small"
                disabled={busy}
                onClick={() => setChosen([])}
              >
                Desmarcar
              </button>
              <button
                type="button"
                className="qc-button secondary small"
                disabled={locked || !reason.trim()}
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
            <div className="qc-mapping-bar primary">
              <CircleCheck size={15} aria-hidden />
              <strong>
                {edits.length}{" "}
                {edits.length === 1 ? "cambio elegido" : "cambios elegidos"}
              </strong>
              <span className="qc-mapping-bar-text">en «{ready.csv.name}»</span>
              <button
                type="button"
                className="qc-button ghost small"
                disabled={locked}
                onClick={() => {
                  setChoices({});
                  setChecked(undefined);
                  setAuthorized(false);
                  if (current?.kind === "changes") setView(undefined);
                }}
              >
                Descartar
              </button>
              {current?.kind !== "changes" && (
                <button
                  type="button"
                  className="qc-button primary small"
                  disabled={busy}
                  onClick={() => setView({ kind: "changes" })}
                >
                  Revisar y aplicar
                  <ArrowRight size={14} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
