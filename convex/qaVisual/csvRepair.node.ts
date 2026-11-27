import { generateText, Output } from "ai";
import { z } from "zod";
import {
  DriveRequestError,
  csvLimit,
  updateDriveFileContent,
  type DriveFile,
} from "./driveClient";
import {
  encodeCsv,
  readFolderState,
  readMappingSources,
  type SourceSelection,
} from "./driveSource.node";
import type { LinkOverride } from "./model/contracts";
import {
  mappingReport,
  verifyCsvEdits,
  verifyEquivalences,
  type ColumnValue,
  type CsvEdit,
  type EditRef,
  type Equivalence,
  type MappingProblem,
} from "./model/mapping";
import { rankRows } from "./model/similarity";
import { qaCsvFixer } from "./qaModels";

/** The prompt is JSON for the model, not a Convex value: here columns may be keys again. */
const asObject = (values: ColumnValue[] = []) =>
  Object.fromEntries(values.map(({ column, value }) => [column, value]));
const valueOf = (values: ColumnValue[], column: string) =>
  values.find((item) => item.column === column)?.value ?? "";

/**
 * Free rows sent to the model for each piece without a row: the most similar ones. Sending
 * every free row with every piece made the request too long for large campaigns.
 */
export const ROWS_PER_PIECE = 8;
/** Pieces reviewed per request; the panel sends them in batches and shows each as it arrives. */
export const REVIEW_BATCH = 15;

/**
 * Mapping review and CSV fixes (§5.5). Code detects the differences between the pieces, the
 * CSV and the matrix; Gemini Neon explains them and proposes how to fix them, without changing
 * anything. The model only chooses among what code offers (a free CSV row, a matrix order);
 * the new values are built by code and every change is verified before it is shown. The only
 * document that may be written is the internal production CSV; the client's matrix is read by
 * code and never written.
 */
const reviewSchema = z.object({
  rows: z.array(
    z.object({
      piece: z.string(),
      csvLine: z.number().int().nullable(),
      explanation: z.string(),
    }),
  ),
  orders: z.array(
    z.object({
      piece: z.string(),
      order: z.string().nullable(),
      explanation: z.string(),
    }),
  ),
});

const reviewPrompt = `Sos el asistente de QA Visual que revisa el mapeo de piezas de una campaña antes de analizarlas.
Cada imagen de la carpeta de piezas tiene que tener una fila en el CSV interno de producción cuyo ID_PIEZA sea igual al nombre del archivo sin la extensión, y esa fila tiene que decir lo mismo que un pedido de la matriz del cliente en CAMPAÑA, FASE, CANAL, MEDIO_PLATAFORMA y FORMATO_TIPO.
El código ya detectó las diferencias. Tu trabajo es explicarlas y proponer cómo corregirlas. No modificás nada: una persona decide.

Recibís:
- "sinFila": piezas que no tienen fila en el CSV (o cuyo ID está repetido). Cada una trae "filasPosibles": las filas libres del CSV (que no usa ninguna pieza) más parecidas a su nombre.
- "sinPedido": piezas cuya fila del CSV no coincide con ningún pedido, con los pedidos más parecidos de la matriz y las columnas en las que difieren.
- "variosPedidos": piezas cuya fila coincide con más de un pedido.

Para cada pieza de "sinFila" respondé en "rows": la línea (csvLine) de una de sus "filasPosibles" que le corresponde o null si ninguna corresponde con seguridad, y una explicación.
Para cada pieza de "sinPedido" y "variosPedidos" respondé en "orders": la fila del pedido de la matriz ("order") que le corresponde o null si no se puede saber con seguridad, y una explicación.

Reglas:
- Elegí solo entre las opciones que recibís. Usá cada fila libre como máximo una vez.
- Emparejá solo si los datos son coherentes (formato, medidas, canal, medio, producto, fecha). Si dudás entre dos opciones o las medidas no coinciden, respondé null.
- La explicación es en español, de una sola oración breve (menos de 200 caracteres): qué diferencia hay (citando los valores) y qué tiene que hacer la persona para corregirla en el CSV. Si la diferencia es solo de nombre (por ejemplo «BANNER HOR» frente a «Banner»), decí que puede corregir el CSV o aprobar que dicen lo mismo.
- Nunca propongas cambiar la matriz del cliente.`;

export type MappingSuggestion = {
  piece: string;
  status: MappingProblem["status"];
  explanation: string;
  source: "ai" | "code";
  /** Free CSV row (pieces without a row) or matrix order chosen by the model. */
  csvLine?: number;
  order?: string;
  /** Verified changes of the CSV; empty when nothing can be proposed. */
  edits: CsvEdit[];
  /** Differences with the chosen order that the team may approve as equivalent. */
  equivalences: Equivalence[];
  warnings: string[];
  /** The model proposed something that did not pass the verification. */
  rejected?: string;
  /** Gemini Neon did not answer for this piece (timeout, error or too many differences). */
  failed?: boolean;
};
export type MappingReview = {
  error?: string;
  csv?: { id: string; name: string; version: string; canEdit: boolean };
  suggestions: MappingSuggestion[];
  model?: string;
};

type Context = {
  url: string;
  selection: SourceSelection;
  excluded: Set<string>;
  overrides: LinkOverride[];
};

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

async function load({ url, selection }: Context) {
  const state = await readFolderState(url, selection);
  if ("error" in state) return { error: state.error ?? "" };
  const sources = await readMappingSources(state);
  if (!sources?.csv.version)
    return { error: "Primero elegí la matriz y el CSV de la campaña." };
  return { state, sources };
}

function codeExplanation(problem: MappingProblem) {
  if (problem.status === "csv_missing")
    return "Ningún ID_PIEZA del CSV es igual al nombre de este archivo. Elegí su fila del CSV o corregí el ID en Drive.";
  if (problem.status === "csv_duplicate")
    return `El ID_PIEZA de esta pieza está repetido en las líneas ${problem.csvLines?.join(", ")} del CSV con datos distintos. Dejá una sola fila con este nombre.`;
  const best = problem.candidates?.[0];
  if (problem.status === "matrix_missing" && best)
    return `El pedido más parecido es el de la fila ${best.row} de la matriz. Difiere en ${best.differences
      .map(
        (d) =>
          `${d.column} («${d.csvValue}» en el CSV, «${d.matrixValue}» en la matriz)`,
      )
      .join(" y ")}.`;
  if (problem.status === "matrix_missing")
    return "Ningún pedido de la matriz se parece a esta fila del CSV. Revisá sus columnas CAMPAÑA, FASE, CANAL, MEDIO_PLATAFORMA y FORMATO_TIPO.";
  return `La fila coincide con ${problem.candidates?.length ?? 0} pedidos que no se distinguen por medidas ni por fecha. Completá las medidas o la fecha en el CSV, o excluí la pieza.`;
}

/**
 * «Revisar con Gemini Neon»: an explanation and a verified proposal for every difference, or
 * only for `pieces` (the panel reviews in batches of REVIEW_BATCH). Nothing is written.
 */
export async function reviewMapping(
  context: Context,
  pieces?: string[],
): Promise<MappingReview> {
  const loaded = await load(context);
  if ("error" in loaded) return { error: loaded.error, suggestions: [] };
  const { sources } = loaded;
  const { text, images, matrix } = sources;
  const verify = (edits: EditRef[]) =>
    verifyCsvEdits({
      text,
      edits,
      images,
      matrix,
      overrides: context.overrides,
      excluded: context.excluded,
    });
  const report = mappingReport({
    images,
    csvText: text,
    matrix,
    excluded: context.excluded,
    overrides: context.overrides,
  });
  const csv = {
    id: sources.csv.id,
    name: sources.csv.name,
    version: sources.csv.version!,
    canEdit: Boolean(sources.csv.capabilities?.canEdit),
  };
  const only = pieces && new Set(pieces);
  const problems = only
    ? report.problems.filter((p) => only.has(p.piece))
    : report.problems;
  if (!problems.length) return { csv, suggestions: [] };
  const rowProblems = problems.filter(
    (p) => p.status === "csv_missing" || p.status === "csv_duplicate",
  );
  const orderProblems = problems.filter(
    (p) => p.status === "matrix_missing" || p.status === "matrix_ambiguous",
  );
  const free = new Map(report.freeRows.map((row) => [row.csvLine, row]));
  const rowSize = (row: (typeof report.freeRows)[number]) => {
    const width = Number(valueOf(row.values, "ANCHO_PX"));
    const height = Number(valueOf(row.values, "ALTO_PX"));
    return width && height ? { width, height } : undefined;
  };
  // The rows offered to each piece; the model may only choose among them.
  const offered = new Map(
    rowProblems.map((p) => [
      p.piece,
      rankRows(
        { name: p.piece, width: p.width, height: p.height },
        report.freeRows,
        rowSize,
      )
        .slice(0, ROWS_PER_PIECE)
        .map(({ row }) => row),
    ]),
  );

  let output: z.infer<typeof reviewSchema> | undefined;
  let notice: string | undefined;
  if (problems.length > 300)
    notice =
      "Hay demasiadas diferencias para revisarlas con IA. Revisá la nomenclatura del CSV y de las piezas.";
  else
    try {
      const result = await generateText({
        model: qaCsvFixer.model,
        output: Output.object({ schema: reviewSchema }),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(120_000),
        system: reviewPrompt,
        prompt: JSON.stringify({
          sinFila: rowProblems.map((p) => ({
            archivo: p.piece,
            ...(p.width && p.height
              ? { medidas: `${p.width}x${p.height}` }
              : {}),
            ...(p.csvLines?.length ? { lineasConElMismoId: p.csvLines } : {}),
            filasPosibles: (offered.get(p.piece) ?? []).map((row) => ({
              csvLine: row.csvLine,
              ...asObject(row.values),
            })),
          })),
          // Only the identity, size and date of the candidate orders: read-only data.
          ...Object.fromEntries(
            (["matrix_missing", "matrix_ambiguous"] as const).map((status) => [
              status === "matrix_missing" ? "sinPedido" : "variosPedidos",
              orderProblems
                .filter((p) => p.status === status)
                .map((p) => ({
                  archivo: p.piece,
                  ...(p.width && p.height
                    ? { medidas: `${p.width}x${p.height}` }
                    : {}),
                  filaDelCsv: asObject(p.csv),
                  pedidos: (p.candidates ?? []).map((c) => ({
                    order: c.row,
                    ...asObject(c.values),
                    ...(c.width && c.height
                      ? { medidas: `${c.width}x${c.height}` }
                      : {}),
                    ...(c.date ? { FECHA: c.date } : {}),
                    ...(c.differences.length
                      ? { difiereEn: c.differences.map((d) => d.column) }
                      : {}),
                  })),
                })),
            ]),
          ),
        }),
      });
      output = result.output;
    } catch (error) {
      console.warn("QA Visual: Gemini Neon no pudo revisar el mapeo", error);
      notice =
        "Gemini Neon no pudo revisar las diferencias. Podés resolverlas eligiendo en el panel o intentar de nuevo.";
    }

  const suggestions: MappingSuggestion[] = [];
  const usedLines = new Set<number>();
  for (const problem of rowProblems) {
    const answer = output?.rows.find((r) => r.piece === problem.piece);
    const suggestion: MappingSuggestion = {
      piece: problem.piece,
      status: problem.status,
      explanation:
        answer?.explanation.slice(0, 600) || notice || codeExplanation(problem),
      source: answer ? "ai" : "code",
      edits: [],
      equivalences: [],
      warnings: [],
      ...(notice ? { failed: true } : {}),
    };
    const row =
      answer?.csvLine != null &&
      offered.get(problem.piece)?.some((r) => r.csvLine === answer.csvLine)
        ? free.get(answer.csvLine)
        : undefined;
    if (answer?.csvLine != null && (!row || usedLines.has(row.csvLine)))
      suggestion.rejected =
        "La IA propuso una fila que no está libre en el CSV. Elegí la fila a mano.";
    else if (row) {
      const edit: CsvEdit = {
        csvLine: row.csvLine,
        column: "ID_PIEZA",
        from: row.id,
        to: stem(problem.piece),
        piece: problem.piece,
        reason: suggestion.explanation,
        origin: "ai",
      };
      const verified = verify([edit]);
      if (!verified.ok) suggestion.rejected = verified.errors[0];
      else if (verified.warnings.length)
        // A size that does not match is not a safe proposal of the model.
        suggestion.rejected = `No se propone: ${verified.warnings[0]}`;
      else {
        usedLines.add(row.csvLine);
        suggestion.csvLine = row.csvLine;
        suggestion.edits = [edit];
      }
    }
    suggestions.push(suggestion);
  }
  for (const problem of orderProblems) {
    const answer = output?.orders.find((r) => r.piece === problem.piece);
    const candidate = problem.candidates?.find((c) => c.row === answer?.order);
    const suggestion: MappingSuggestion = {
      piece: problem.piece,
      status: problem.status,
      explanation:
        answer?.explanation.slice(0, 600) || notice || codeExplanation(problem),
      source: answer ? "ai" : "code",
      edits: [],
      equivalences: [],
      warnings: [],
      ...(notice ? { failed: true } : {}),
    };
    if (answer?.order && !candidate)
      suggestion.rejected =
        "La IA propuso un pedido que no está entre los candidatos. Elegilo a mano.";
    else if (candidate && problem.status === "matrix_missing") {
      const csvLine = problem.csvLines?.[0];
      const edits: CsvEdit[] = csvLine
        ? candidate.differences.map((d) => ({
            csvLine,
            column: d.column,
            from: d.csvValue,
            to: d.matrixValue,
            piece: problem.piece,
            reason: suggestion.explanation,
            origin: "ai" as const,
            order: candidate.row,
          }))
        : [];
      const verified = edits.length ? verify(edits) : undefined;
      if (!verified?.ok)
        suggestion.rejected = verified?.errors[0] ?? "No hay nada que copiar.";
      else if (verified.warnings.length)
        suggestion.rejected = `No se propone: ${verified.warnings[0]}`;
      else {
        suggestion.order = candidate.row;
        suggestion.edits = edits;
        suggestion.equivalences = candidate.differences;
      }
    } else if (candidate) suggestion.order = candidate.row;
    suggestions.push(suggestion);
  }
  // Each proposal was verified alone; together they must pass too.
  const all = suggestions.flatMap((s) => s.edits);
  if (all.length && !verify(all).ok)
    for (const s of suggestions)
      if (s.edits.length) {
        s.edits = [];
        s.rejected =
          "Las propuestas de la IA no pasan la verificación juntas. Elegí las filas a mano.";
      }
  return {
    csv,
    suggestions,
    ...(output ? { model: qaCsvFixer.modelId } : {}),
  };
}

/** Verification of the changes chosen in the panel, before authorizing them. */
export async function checkCsvFix(
  context: Context,
  csvVersion: string,
  edits: EditRef[],
): Promise<{
  error?: string;
  errors?: string[];
  warnings?: string[];
  next?: string[];
}> {
  const loaded = await load(context);
  if ("error" in loaded) return { error: loaded.error };
  if (loaded.sources.csv.version !== csvVersion)
    return {
      error: "El CSV cambió en Drive. Actualizá la revisión del mapeo.",
    };
  const verified = verifyCsvEdits({
    text: loaded.sources.text,
    edits,
    images: loaded.sources.images,
    matrix: loaded.sources.matrix,
    overrides: context.overrides,
    excluded: context.excluded,
  });
  return verified.ok
    ? { warnings: verified.warnings, next: verified.next }
    : { errors: verified.errors.slice(0, 20) };
}

/** Verifies equivalences against the current files before they are saved. */
export async function checkEquivalences(
  context: Context,
  piece: string,
  order: string,
  equivalences: Equivalence[],
): Promise<{ error?: string }> {
  const loaded = await load(context);
  if ("error" in loaded) return { error: loaded.error };
  const verified = verifyEquivalences({
    text: loaded.sources.text,
    piece,
    order,
    equivalences,
    images: loaded.sources.images,
    matrix: loaded.sources.matrix,
    overrides: context.overrides,
    excluded: context.excluded,
  });
  return verified.ok ? {} : { error: verified.errors.slice(0, 3).join(" ") };
}

export type CsvFixResult = {
  error?: string;
  applied?: number;
  /** When Drive refuses the write, the corrected file can still be downloaded. */
  download?: { name: string; content: string };
};

/**
 * Writes the approved changes. The CSV and the matrix are read again; the write is refused if
 * the CSV changed since the proposal, and every change is verified again before replacing the
 * file content. Drive keeps the previous version.
 */
export async function applyCsvFix(
  context: Context,
  csvVersion: string,
  edits: EditRef[],
): Promise<CsvFixResult & { csv?: DriveFile; previousVersion?: string }> {
  if (!edits.length) return { error: "No hay cambios para aplicar." };
  const loaded = await load(context);
  if ("error" in loaded) return { error: loaded.error };
  const { sources } = loaded;
  if (sources.csv.version !== csvVersion)
    return {
      error:
        "El CSV cambió en Drive desde la propuesta. Volvé a revisar el mapeo.",
    };
  const verified = verifyCsvEdits({
    text: sources.text,
    edits,
    images: sources.images,
    matrix: sources.matrix,
    overrides: context.overrides,
    excluded: context.excluded,
  });
  if (!verified.ok)
    return {
      error: `Los cambios no pasaron la verificación: ${verified.errors.slice(0, 3).join(" ")}`,
    };
  let next: Buffer;
  try {
    next = encodeCsv(verified.text, sources.encoding);
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (next.length > csvLimit)
    return { error: "El CSV corregido supera el tamaño admitido (2 MiB)." };
  const download = { name: sources.csv.name, content: verified.text };
  try {
    const written = await updateDriveFileContent(sources.csv, next, csvVersion);
    return {
      applied: edits.length,
      csv: written,
      previousVersion: csvVersion,
    };
  } catch (error) {
    if (!(error instanceof DriveRequestError)) throw error;
    console.warn("QA Visual: Drive rechazó el CSV corregido", error.message);
    return {
      error:
        error.reason === "versionChanged"
          ? "El CSV cambió en Drive desde la propuesta. Volvé a revisar el mapeo."
          : error.status === 403 || error.status === 404
            ? `La cuenta de servicio no puede modificar «${sources.csv.name}». Compartilo como Editor o descargá el CSV corregido y reemplazalo a mano.`
            : `Google Drive no aceptó el cambio (HTTP ${error.status}). Podés descargar el CSV corregido y reemplazarlo a mano.`,
      ...(error.reason === "versionChanged" ? {} : { download }),
    };
  }
}
