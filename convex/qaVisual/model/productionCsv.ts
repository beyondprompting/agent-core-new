import { pieceKey } from "./normalize";

export type ProductionFields = {
  product: string;
  price: string;
  ctaAsset: string;
  dateAsset: string;
  campaign: string;
  phase: string;
  channel: string;
  platform: string;
  format: string;
  width: number;
  height: number;
  csvLine?: number;
  duplicates?: { csvLine: number; values: Record<string, string> }[];
};

export type CsvField = {
  value: string;
  /** Offsets of the raw field (quotes included) in the text given to {@link csvTable}. */
  start: number;
  end: number;
};
export type CsvRecord = { fields: CsvField[]; line: number };

/**
 * Splits a CSV into records keeping where each field is, so a single cell can be replaced
 * without touching any other byte of the file. A leading BOM is kept in the offsets.
 */
export function csvTable(text: string) {
  const offset = text.startsWith("\uFEFF") ? 1 : 0;
  const csv = text.slice(offset);
  const header = csv.split(/\r?\n/, 1)[0];
  const separator =
    (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const records: CsvRecord[] = [];
  let fields: CsvField[] = [],
    value = "",
    quoted = false,
    line = 1,
    start = 1,
    fieldStart = 0;
  const close = (end: number) => {
    fields.push({ value, start: fieldStart + offset, end: end + offset });
    value = "";
  };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (
      !quoted &&
      (char === separator || char === "\n" || char === "\r")
    ) {
      close(i);
      fieldStart = i + 1;
      if (char !== separator) {
        records.push({ fields, line: start });
        fields = [];
        if (char === "\r" && csv[i + 1] === "\n") {
          i++;
          fieldStart = i + 1;
        }
        line++;
        start = line;
      }
    } else {
      value += char;
      if (char === "\n") line++;
    }
  }
  if (quoted)
    throw new Error("CSV inválido: hay un campo entre comillas sin cerrar.");
  if (fields.length || value) {
    close(csv.length);
    records.push({ fields, line: start });
  }
  return { separator, records };
}

/** csvLine points to the record's start, including records with multiline fields. */
export function productionByPiece(
  text: string,
): Record<string, ProductionFields> {
  const table = csvTable(text).records.map((record) => ({
    fields: record.fields.map((field) => field.value),
    line: record.line,
  }));
  const [first, ...rows] = table;
  const headers = first?.fields.map((s) => s.trim()) ?? [];
  if (!headers.includes("ID_PIEZA"))
    throw new Error("Falta la columna ID_PIEZA");
  const result: Record<string, ProductionFields> = Object.create(null);
  const originals = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const values = Object.fromEntries(
      headers.map((key, i) => [key, row.fields[i]?.trim() ?? ""]),
    );
    if (!values.ID_PIEZA) continue;
    const key = pieceKey(values.ID_PIEZA);
    const previous = result[key];
    if (previous) {
      previous.duplicates ??= [
        { csvLine: previous.csvLine!, values: originals.get(key)! },
      ];
      previous.duplicates.push({ csvLine: row.line, values });
      continue;
    }
    originals.set(key, values);
    const size = (value?: string) =>
      /^\d+$/.test(value ?? "") ? Number(value) : 0;
    result[key] = {
      product: values.TXT_PRODUCTO ?? "",
      price: values.TXT_PRECIO ?? "",
      ctaAsset: values.SLOT_CTA ?? "",
      dateAsset: values.SLOT_FECHA ?? "",
      campaign: values["CAMPAÑA"] ?? "",
      phase: values.FASE ?? "",
      channel: values.CANAL ?? "",
      platform: values.MEDIO_PLATAFORMA ?? "",
      format: values.FORMATO_TIPO?.toUpperCase() ?? "",
      width: size(values.ANCHO_PX),
      height: size(values.ALTO_PX),
      csvLine: row.line,
    };
  }
  return result;
}
