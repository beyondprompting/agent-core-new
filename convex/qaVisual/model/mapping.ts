import type { LinkOverride, Matrix } from "./contracts";
import { pieceMappingStatus, type MappingStatus } from "./mappingStatus";
import { normalize, pieceKey } from "./normalize";
import {
  csvTable,
  productionByPiece,
  type ProductionFields,
} from "./productionCsv";
import {
  buildRequirements,
  IDENTITY_COLUMNS,
  identityOf,
  linkOrders,
  matrixOrders,
  sameIdentity,
  type IdentityColumn,
  type MatrixOrder,
} from "./requirements";

/**
 * Mapping check (§5.5): every image of the pieces folder must be linked to one row of the
 * production CSV (ID_PIEZA equal to the file name) and that row to one order of the client's
 * matrix (same CAMPAÑA, FASE, CANAL, MEDIO_PLATAFORMA and FORMATO_TIPO). Code only compares:
 * there are no rules for particular names. Differences are shown to the team, who fixes the
 * CSV (by hand, choosing in the panel or with Gemini), declares two values equivalent or
 * excludes the piece. Fixes only ever change the internal CSV; the matrix is never written.
 */
export {
  EXCLUDED_ISSUE,
  isUnmapped,
  mappingLocked,
  pieceMappingStatus,
  type MappingStatus,
} from "./mappingStatus";
export { IDENTITY_COLUMNS, type IdentityColumn } from "./requirements";

export type MappingImage = { name: string; width?: number; height?: number };
/** Columns of the CSV that a fix may change. */
export const EDITABLE_COLUMNS = [
  "ID_PIEZA",
  ...IDENTITY_COLUMNS.map(([name]) => name),
] as const;
export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];
/**
 * A change of one cell of the CSV. `csvLine` identifies the record (its first line). A change
 * of an identity column copies the value of the matrix order `order` (a PRODUCCION row).
 */
export type CsvEdit = {
  csvLine: number;
  column: EditableColumn;
  from: string;
  to: string;
  piece: string;
  reason: string;
  origin: "manual" | "ai";
  order?: string;
};
/** A CSV value and a matrix value the team may declare equivalent. */
export type Equivalence = {
  column: IdentityColumn;
  csvValue: string;
  matrixValue: string;
};
/**
 * Values of a CSV row or of a matrix order sent to the browser. They are a list and not an
 * object keyed by column because Convex only accepts ASCII field names and the columns are
 * Spanish words («CAMPAÑA»).
 */
export type ColumnValue = { column: string; value: string };
export const valueOf = (values: ColumnValue[] | undefined, column: string) =>
  values?.find((item) => item.column === column)?.value ?? "";
export type OrderCandidate = Omit<MatrixOrder, "values"> & {
  values: ColumnValue[];
  differences: Equivalence[];
};
export type MappingProblem = {
  piece: string;
  status: Exclude<MappingStatus, "linked" | "excluded">;
  width?: number;
  height?: number;
  /** CSV row of the piece (matrix problems) or rows repeating its ID (duplicates). */
  csvLines?: number[];
  csv?: ColumnValue[];
  /** Most similar orders of the matrix (matrix problems). */
  candidates?: OrderCandidate[];
};
export type FreeRow = {
  csvLine: number;
  id: string;
  values: ColumnValue[];
};
export type MappingGroup = {
  code: MappingProblem["status"];
  title: string;
  detail: string;
  pieces: string[];
};
export type MappingReport = {
  total: number;
  linked: number;
  excluded: number;
  unmapped: number;
  groups: MappingGroup[];
  problems: MappingProblem[];
  excludedPieces: string[];
  /** Rows whose ID_PIEZA matches no image: a warning, it does not lock anything. */
  orphanRows: { csvLine: number; id: string }[];
  /** Rows that a piece without a row may take (orphans and repeated IDs). */
  freeRows: FreeRow[];
};

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
/** Columns of a CSV row shown to the team and to the model to recognize it. */
export const ROW_COLUMNS = [
  "ID_PIEZA",
  "CAMPAÑA",
  "FASE",
  "CANAL",
  "MEDIO_PLATAFORMA",
  "FORMATO_TIPO",
  "ANCHO_PX",
  "ALTO_PX",
  "TXT_PRODUCTO",
  "OFERTA",
  "SLOT_FECHA",
];
const MAX_LISTED = 600;

export type CsvRow = {
  csvLine: number;
  id: string;
  key: string;
  values: Record<string, string>;
};

/** Data rows of the CSV with their ID_PIEZA and the rest of their columns. */
export function csvRows(text: string): CsvRow[] {
  const [header, ...records] = csvTable(text).records;
  const headers = header?.fields.map((f) => f.value.trim()) ?? [];
  if (!headers.includes("ID_PIEZA"))
    throw new Error("Falta la columna ID_PIEZA");
  return records.flatMap((record) => {
    const values = Object.fromEntries(
      headers.map((key, i) => [key, record.fields[i]?.value.trim() ?? ""]),
    );
    return values.ID_PIEZA || record.fields.some((f) => f.value.trim())
      ? [
          {
            csvLine: record.line,
            id: values.ID_PIEZA,
            key: values.ID_PIEZA ? pieceKey(values.ID_PIEZA) : "",
            values,
          },
        ]
      : [];
  });
}

/** Rows not used by any piece: orphans and every row of a repeated ID of a piece. */
export function freeRows(rows: CsvRow[], imageKeys: Set<string>) {
  const perKey = new Map<string, number>();
  for (const row of rows) perKey.set(row.key, (perKey.get(row.key) ?? 0) + 1);
  return rows.filter(
    (row) => !imageKeys.has(row.key) || (perKey.get(row.key) ?? 0) > 1,
  );
}

export const rowSummary = (values: Record<string, string>): ColumnValue[] =>
  ROW_COLUMNS.filter((column) => values[column]).map((column) => ({
    column,
    value: values[column],
  }));
const candidateOf = (
  order: MatrixOrder,
  differences: Equivalence[],
): OrderCandidate => ({
  ...order,
  values: IDENTITY_COLUMNS.map(([column]) => ({
    column,
    value: order.values[column],
  })),
  differences,
});

/** Mapping state of one piece and, when it is linked, the PRODUCCION row of its order. */
function pieceLink(
  matrix: Matrix | undefined,
  name: string,
  production: ProductionFields | undefined,
  overrides: LinkOverride[],
): { status: MappingStatus; order?: string } {
  const status = pieceMappingStatus(
    buildRequirements(matrix, name, production, overrides).issues,
  );
  if (status !== "linked" || !production) return { status };
  const link = linkOrders(matrix, name, production, overrides);
  return {
    status,
    order: link.byDate?.row ?? (link.rows.length === 1 ? link.rows[0] : ""),
  };
}

/** Orders of the matrix most similar to a CSV row, with the columns that differ. */
export function orderCandidates(
  matrix: Matrix | undefined,
  production: ProductionFields,
  overrides: LinkOverride[] = [],
  limit = 5,
): OrderCandidate[] {
  const identity = identityOf(production);
  return matrixOrders(matrix)
    .orders.map((order) => ({
      order,
      differences: IDENTITY_COLUMNS.flatMap(([column]) =>
        sameIdentity(column, identity[column], order.values[column], overrides)
          ? []
          : [
              {
                column,
                csvValue: identity[column],
                matrixValue: order.values[column],
              },
            ],
      ),
      sized:
        !!production.width &&
        order.width === production.width &&
        order.height === production.height,
    }))
    .filter((s) => s.differences.length < IDENTITY_COLUMNS.length)
    .sort(
      (a, b) =>
        a.differences.length - b.differences.length ||
        Number(b.sized) - Number(a.sized) ||
        Number(a.order.row) - Number(b.order.row),
    )
    .slice(0, limit)
    .map(({ order, differences }) => candidateOf(order, differences));
}

const groupText: Record<
  MappingGroup["code"],
  (n: number) => { title: string; detail: string }
> = {
  csv_missing: (n) => ({
    title: `${n} ${n === 1 ? "pieza no tiene" : "piezas no tienen"} fila en el CSV`,
    detail:
      "Ningún ID_PIEZA del CSV es igual al nombre del archivo (sin la extensión). Elegí su fila del CSV, corregí el ID en Drive, pedí una propuesta a Gemini o excluí la pieza si no se revisa.",
  }),
  csv_duplicate: (n) => ({
    title: `${n} ${n === 1 ? "pieza tiene" : "piezas tienen"} el ID repetido en el CSV`,
    detail:
      "Varias filas del CSV usan el mismo ID_PIEZA con datos distintos. Cada fila tiene que llevar el nombre de una pieza distinta: asigná las filas que sobran a sus piezas o borralas en Drive.",
  }),
  matrix_missing: (n) => ({
    title: `${n} ${n === 1 ? "pieza no encuentra" : "piezas no encuentran"} su pedido en la matriz`,
    detail:
      "Su fila del CSV no dice lo mismo que ningún pedido de PRODUCCION en CAMPAÑA, FASE, CANAL, MEDIO_PLATAFORMA y FORMATO_TIPO. Elegí el pedido correcto: podés copiar sus valores en el CSV o, si dicen lo mismo, aprobar la equivalencia. La matriz del cliente no se modifica.",
  }),
  matrix_ambiguous: (n) => ({
    title: `${n} ${n === 1 ? "pieza coincide" : "piezas coinciden"} con más de un pedido de la matriz`,
    detail:
      "Varios pedidos de PRODUCCION dicen lo mismo y tampoco se distinguen por medidas ni por fecha. Completá en el CSV las medidas (ANCHO_PX, ALTO_PX) o la fecha (SLOT_FECHA) de la pieza, o excluila.",
  }),
};

/** Mapping of the pieces folder against the CSV and the matrix. Pure; nothing is written. */
export function mappingReport({
  images,
  csvText,
  matrix,
  excluded = new Set(),
  overrides = [],
}: {
  images: MappingImage[];
  csvText: string;
  matrix?: Matrix;
  excluded?: Set<string>;
  overrides?: LinkOverride[];
}): MappingReport {
  const production = productionByPiece(csvText);
  const rows = csvRows(csvText);
  const imageKeys = new Set(images.map((i) => pieceKey(i.name)));
  const orders = matrixOrders(matrix).orders;
  const byStatus = new Map<MappingStatus, string[]>();
  const problems: MappingProblem[] = [];
  for (const image of images) {
    const key = pieceKey(image.name);
    const fields = production[key];
    const status: MappingStatus = excluded.has(key)
      ? "excluded"
      : pieceLink(matrix, image.name, fields, overrides).status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), image.name]);
    if (status === "linked" || status === "excluded") continue;
    const problem: MappingProblem = {
      piece: image.name,
      status,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
    };
    if (status === "csv_duplicate")
      problem.csvLines = rows
        .filter((r) => r.key === key)
        .map((r) => r.csvLine);
    if (
      fields &&
      (status === "matrix_missing" || status === "matrix_ambiguous")
    ) {
      const row = rows.find((r) => r.csvLine === fields.csvLine);
      problem.csvLines = fields.csvLine ? [fields.csvLine] : [];
      problem.csv = row ? rowSummary(row.values) : [];
      if (status === "matrix_missing")
        problem.candidates = orderCandidates(matrix, fields, overrides);
      else {
        const linked = new Set(
          linkOrders(matrix, image.name, fields, overrides).rows,
        );
        problem.candidates = orders
          .filter((o) => linked.has(o.row))
          .slice(0, 5)
          .map((o) => candidateOf(o, []));
      }
    }
    problems.push(problem);
  }
  const groups = (
    [
      "csv_missing",
      "csv_duplicate",
      "matrix_missing",
      "matrix_ambiguous",
    ] as const
  ).flatMap((code) => {
    const pieces = byStatus.get(code) ?? [];
    return pieces.length
      ? [{ code, ...groupText[code](pieces.length), pieces }]
      : [];
  });
  const count = (status: MappingStatus) => byStatus.get(status)?.length ?? 0;
  return {
    total: images.length,
    linked: count("linked"),
    excluded: count("excluded"),
    unmapped: groups.reduce((n, g) => n + g.pieces.length, 0),
    groups,
    problems,
    excludedPieces: byStatus.get("excluded") ?? [],
    orphanRows: rows
      .filter((row) => row.id && !imageKeys.has(row.key))
      .map(({ csvLine, id }) => ({ csvLine, id }))
      .slice(0, MAX_LISTED),
    freeRows: freeRows(rows, imageKeys)
      .slice(0, MAX_LISTED)
      .map(({ csvLine, id, values }) => ({
        csvLine,
        id,
        values: rowSummary(values),
      })),
  };
}

const needsQuotes = (value: string, separator: string) =>
  value.includes(separator) || /["\r\n]/.test(value) || value !== value.trim();

export type EditRef = Pick<CsvEdit, "csvLine" | "column" | "from" | "to"> & {
  order?: string;
  piece?: string;
};

/**
 * Applies cell changes to the CSV text and proves that nothing else changed: same records,
 * same columns and every other cell identical. Each change must be safe on its own:
 * ID_PIEZA takes the name of a piece of the folder; an identity column takes, exactly, the
 * value of the matrix order the team chose.
 */
export function applyCsvEdits(
  text: string,
  edits: EditRef[],
  images: MappingImage[],
  matrix?: Matrix,
): { ok: true; text: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const { separator, records } = csvTable(text);
  const [header, ...data] = records;
  const headers = header?.fields.map((f) => f.value.trim()) ?? [];
  if (!headers.includes("ID_PIEZA"))
    return { ok: false, errors: ["Falta la columna ID_PIEZA"] };
  const stems = new Set(images.map((i) => stem(i.name)));
  const imageKeys = new Set(images.map((i) => pieceKey(i.name)));
  const perKey = new Map<string, number>();
  for (const row of csvRows(text))
    perKey.set(row.key, (perKey.get(row.key) ?? 0) + 1);
  const orders = new Map(
    matrixOrders(matrix).orders.map((order) => [order.row, order]),
  );
  const targets = new Set<string>();
  const changes: { start: number; end: number; value: string }[] = [];
  const expected = new Map<string, string>();
  for (const edit of edits) {
    const record = data.find((r) => r.line === edit.csvLine);
    const index = headers.indexOf(edit.column);
    const field = index >= 0 ? record?.fields[index] : undefined;
    const label = `Línea ${edit.csvLine}, ${edit.column}`;
    const cell = `${edit.csvLine}:${edit.column}`;
    const current = field?.value.trim();
    let error: string | undefined;
    if (!(EDITABLE_COLUMNS as readonly string[]).includes(edit.column))
      error = `${label}: esa columna no se puede modificar.`;
    else if (!field || current === undefined)
      error = `${label}: no existe en el CSV.`;
    else if (current !== edit.from.trim())
      error = `${label}: el valor cambió desde la propuesta.`;
    else if (expected.has(cell)) error = `${label}: tiene más de un cambio.`;
    else if (edit.column === "ID_PIEZA") {
      if (!stems.has(edit.to))
        error = `${label}: «${edit.to}» no es el nombre de ninguna pieza de la carpeta.`;
      else if (targets.has(pieceKey(edit.to)))
        error = `«${edit.to}» se asignó a más de una fila.`;
      else if (
        current &&
        imageKeys.has(pieceKey(current)) &&
        (perKey.get(pieceKey(current)) ?? 0) === 1
      )
        error = `${label}: ya está vinculada a la pieza «${current}» y no se puede reasignar.`;
      else targets.add(pieceKey(edit.to));
    } else {
      const order = edit.order ? orders.get(edit.order) : undefined;
      const value = order?.values[edit.column as IdentityColumn]?.trim();
      if (!order) error = `${label}: no indica un pedido de la matriz.`;
      else if (!value || value !== edit.to.trim())
        error = `${label}: «${edit.to}» no es el valor del pedido de la fila ${order.row} de la matriz.`;
    }
    if (error || !field) {
      errors.push(error ?? `${label}: no existe en el CSV.`);
      continue;
    }
    expected.set(cell, edit.to);
    const raw = text.slice(field.start, field.end);
    const quoted =
      raw.trimStart().startsWith('"') || needsQuotes(edit.to, separator);
    changes.push({
      start: field.start,
      end: field.end,
      value: quoted ? `"${edit.to.replaceAll('"', '""')}"` : edit.to,
    });
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  let next = text;
  for (const change of [...changes].sort((a, b) => b.start - a.start))
    next = next.slice(0, change.start) + change.value + next.slice(change.end);

  // Computational proof: only the edited cells differ.
  const after = csvTable(next).records;
  if (after.length !== records.length)
    return {
      ok: false,
      errors: ["El CSV corregido cambió la cantidad de filas."],
    };
  records.forEach((record, r) => {
    const changed = after[r];
    if (changed.fields.length !== record.fields.length)
      errors.push(`La línea ${record.line} cambió la cantidad de columnas.`);
    record.fields.forEach((field, c) => {
      const want =
        r > 0
          ? (expected.get(`${record.line}:${headers[c]}`) ?? field.value)
          : field.value;
      if (changed.fields[c]?.value !== want)
        errors.push(
          `La línea ${record.line} cambió fuera de las celdas pedidas.`,
        );
    });
  });
  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, text: next };
}

/**
 * `warnings` are signs that the pairing may be wrong (sizes or numbers that do not match): a
 * person may still authorize it, a proposal of the model is discarded. `next` are problems the
 * piece still has after the change (an ID fixed, but its row does not match the matrix yet).
 */
export type Verification =
  | { ok: true; text: string; warnings: string[]; next: string[] }
  | { ok: false; errors: string[] };

const statusLabel: Record<MappingStatus, string> = {
  linked: "vinculada",
  excluded: "excluida",
  csv_missing: "sin fila en el CSV",
  csv_duplicate: "con el ID repetido en el CSV",
  matrix_missing: "sin pedido en la matriz",
  matrix_ambiguous: "con más de un pedido posible en la matriz",
};

/**
 * Verifies a set of CSV changes as a whole (§5.5): the cells change safely
 * ({@link applyCsvEdits}), each corrected piece ends up linked to exactly one order (the chosen
 * one, for identity changes) through its own row, and no piece that was linked loses its link
 * or changes of order. A size that differs between an image and its row is a warning.
 */
export function verifyCsvEdits({
  text,
  edits,
  images,
  matrix,
  overrides = [],
  excluded = new Set(),
}: {
  text: string;
  edits: EditRef[];
  images: MappingImage[];
  matrix?: Matrix;
  overrides?: LinkOverride[];
  excluded?: Set<string>;
}): Verification {
  if (!edits.length) return { ok: false, errors: ["No hay cambios."] };
  const applied = applyCsvEdits(text, edits, images, matrix);
  if (!applied.ok) return applied;
  return verifyLinks({
    before: text,
    after: applied.text,
    images,
    matrix,
    overrides,
    nextOverrides: overrides,
    excluded,
    targets: edits.map((edit) =>
      edit.column === "ID_PIEZA"
        ? {
            piece:
              images.find((i) => stem(i.name) === edit.to)?.name ?? edit.to,
            csvLine: edit.csvLine,
            kind: "row" as const,
          }
        : {
            piece: edit.piece ?? "",
            csvLine: edit.csvLine,
            kind: "order" as const,
            order: edit.order,
          },
    ),
  });
}

/**
 * Verifies equivalences before they are approved: with them, the piece is linked to exactly
 * one order and no other piece becomes unlinked or changes of order.
 */
export function verifyEquivalences({
  text,
  piece,
  order,
  equivalences,
  images,
  matrix,
  overrides = [],
  excluded = new Set(),
}: {
  text: string;
  piece: string;
  /** PRODUCCION row of the order the team chose. */
  order: string;
  equivalences: Equivalence[];
  images: MappingImage[];
  matrix?: Matrix;
  overrides?: LinkOverride[];
  excluded?: Set<string>;
}): { ok: true } | { ok: false; errors: string[] } {
  if (!equivalences.length)
    return {
      ok: false,
      errors: ["No hay valores para declarar equivalentes."],
    };
  const known = new Set<string>(IDENTITY_COLUMNS.map(([name]) => name));
  if (
    equivalences.some(
      (e) =>
        !known.has(e.column) ||
        !e.csvValue.trim() ||
        !e.matrixValue.trim() ||
        e.csvValue.length > 500 ||
        e.matrixValue.length > 500,
    )
  )
    return { ok: false, errors: ["La equivalencia no es válida."] };
  const result = verifyLinks({
    before: text,
    after: text,
    images,
    matrix,
    overrides,
    nextOverrides: [
      ...overrides,
      ...equivalences.map(
        (e): LinkOverride => ({
          kind: "matrixEquivalence",
          column: e.column,
          from: e.csvValue,
          to: e.matrixValue,
        }),
      ),
    ],
    excluded,
    targets: [{ piece, kind: "order", order }],
  });
  if (!result.ok) return result;
  // Values that say the same never hide a size that does not match.
  return result.warnings.length
    ? { ok: false, errors: result.warnings }
    : { ok: true };
}

function verifyLinks({
  before,
  after,
  images,
  matrix,
  overrides,
  nextOverrides,
  excluded,
  targets,
}: {
  before: string;
  after: string;
  images: MappingImage[];
  matrix?: Matrix;
  overrides: LinkOverride[];
  nextOverrides: LinkOverride[];
  excluded: Set<string>;
  targets: {
    piece: string;
    csvLine?: number;
    kind: "row" | "order";
    order?: string;
  }[];
}): Verification {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pending: string[] = [];
  const orders = new Map(matrixOrders(matrix).orders.map((o) => [o.row, o]));
  const previous = productionByPiece(before);
  const next = productionByPiece(after);
  const nextRows = csvRows(after);
  // The ID a row had before the change also tells which piece it was meant for.
  const previousIds = new Map(csvRows(before).map((r) => [r.csvLine, r.id]));
  const byName = new Map(images.map((i) => [i.name, i]));
  const sameRules = nextOverrides === overrides;
  for (const image of images) {
    const key = pieceKey(image.name);
    if (excluded.has(key)) continue;
    // Same row and same equivalences: the link cannot change.
    if (
      sameRules &&
      JSON.stringify(previous[key]) === JSON.stringify(next[key])
    )
      continue;
    const was = pieceLink(matrix, image.name, previous[key], overrides);
    if (was.status !== "linked") continue;
    const now = pieceLink(matrix, image.name, next[key], nextOverrides);
    if (now.status !== "linked")
      errors.push(
        `«${image.name}» estaba vinculada y quedaría ${statusLabel[now.status]}.`,
      );
    else if (now.order !== was.order)
      errors.push(
        `«${image.name}» pasaría del pedido de la fila ${was.order} al de la fila ${now.order} de la matriz.`,
      );
  }
  const unique = new Map(
    targets.map((t) => [
      `${t.piece}|${t.kind}|${t.csvLine ?? ""}|${t.order ?? ""}`,
      t,
    ]),
  );
  for (const target of unique.values()) {
    const image = byName.get(target.piece);
    if (!image) {
      errors.push(`«${target.piece}» no es una pieza de la carpeta.`);
      continue;
    }
    const key = pieceKey(image.name);
    const fields = next[key];
    const row =
      target.csvLine !== undefined
        ? nextRows.find((r) => r.csvLine === target.csvLine)
        : undefined;
    if (target.csvLine !== undefined && (!row || row.key !== key)) {
      errors.push(
        `La línea ${target.csvLine} del CSV no es la fila de «${image.name}».`,
      );
      continue;
    }
    const now = pieceLink(matrix, image.name, fields, nextOverrides);
    // A new row only has to be the piece's own; the order may still need a fix (next step).
    if (
      target.kind === "row" &&
      (now.status === "matrix_missing" || now.status === "matrix_ambiguous")
    )
      pending.push(
        `Después de este cambio «${image.name}» todavía queda ${statusLabel[now.status]}.`,
      );
    else if (now.status !== "linked") {
      errors.push(
        `Con este cambio «${image.name}» seguiría ${statusLabel[now.status]}.`,
      );
      continue;
    }
    if (target.order && now.status === "linked" && now.order !== target.order)
      errors.push(
        `«${image.name}» quedaría vinculada al pedido de la fila ${now.order}, no al elegido (fila ${target.order}).`,
      );
    const chosen = target.order ? orders.get(target.order) : undefined;
    if (
      chosen?.width &&
      chosen.height &&
      fields?.width &&
      fields.height &&
      (chosen.width !== fields.width || chosen.height !== fields.height)
    )
      warnings.push(
        `El pedido de la fila ${chosen.row} es de ${chosen.width} × ${chosen.height} y la fila del CSV de «${image.name}» dice ${fields.width} × ${fields.height}.`,
      );
    if (target.kind === "row" && row) {
      const missing = numberConflicts(
        image,
        row.values,
        previousIds.get(row.csvLine) ?? "",
      );
      if (missing.length)
        warnings.push(
          `El nombre de «${image.name}» tiene ${missing.map((n) => `«${n}»`).join(", ")} y la fila de la línea ${row.csvLine} no.`,
        );
    }
    if (
      fields &&
      image.width &&
      image.height &&
      fields.width &&
      fields.height &&
      (fields.width !== image.width || fields.height !== image.height)
    )
      warnings.push(
        `«${image.name}» mide ${image.width} × ${image.height} y su fila del CSV dice ${fields.width} × ${fields.height}.`,
      );
  }
  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : {
        ok: true,
        text: after,
        warnings: [...new Set(warnings)],
        next: [...new Set(pending)],
      };
}

/**
 * Numbers of the file name (quantities, versions, dates) that neither the other columns of its
 * new row nor the ID the row had before have: a sign that the row belongs to another piece.
 * Sizes are ignored. The previous ID counts because names often carry numbers that no other
 * column repeats (the «11_26» of November 2026 in «…_45_OFF_11_26_…»).
 */
function numberConflicts(
  image: MappingImage,
  values: Record<string, string>,
  previousId: string,
) {
  const name = stem(image.name).replace(/\d+\s*x\s*\d+/gi, " ");
  const known = new Set(
    [
      previousId,
      ...Object.entries(values)
        .filter(([column]) => column !== "ID_PIEZA")
        .map(([, value]) => value),
    ]
      .flatMap(
        (value) => value.replace(/\d+\s*x\s*\d+/gi, " ").match(/\d+/g) ?? [],
      )
      .map((n) => String(Number(n))),
  );
  for (const size of [image.width, image.height])
    if (size) known.add(String(size));
  return [
    ...new Set(
      (name.match(/\d+/g) ?? [])
        .map((n) => String(Number(n)))
        .filter((n) => !known.has(n)),
    ),
  ];
}

/** Normalized key of an equivalence, to avoid approving the same one twice. */
export const equivalenceKey = (e: Equivalence) =>
  [e.column, normalize(e.csvValue), normalize(e.matrixValue)].join("|");
