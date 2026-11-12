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

/** csvLine points to the record's start, including records with multiline fields. */
export function productionByPiece(
  text: string,
): Record<string, ProductionFields> {
  const csv = text.replace(/^\uFEFF/, "");
  const header = csv.split(/\r?\n/, 1)[0];
  const separator =
    (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const table: { fields: string[]; line: number }[] = [];
  let fields: string[] = [],
    value = "",
    quoted = false,
    line = 1,
    start = 1;
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
      fields.push(value);
      value = "";
      if (char !== separator) {
        table.push({ fields, line: start });
        fields = [];
        if (char === "\r" && csv[i + 1] === "\n") i++;
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
  if (fields.length || value)
    table.push({ fields: [...fields, value], line: start });
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
