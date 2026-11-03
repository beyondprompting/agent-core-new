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
};

export function productionByPiece(
  csv: string,
): Record<string, ProductionFields> {
  // Drive exports comma-separated records with quoted fields (including prices).
  const table: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (char === "\n") {
        table.push(row);
        row = [];
      }
    } else value += char;
  }
  if (row.length || value) table.push([...row, value.replace(/\r$/, "")]);
  const [headers = [], ...rows] = table;
  const column = (key: string) =>
    headers.findIndex((header) => header.trim() === key);
  const id = column("ID_PIEZA"),
    product = column("TXT_PRODUCTO"),
    price = column("TXT_PRECIO"),
    cta = column("SLOT_CTA");
  if (id < 0) throw new Error("Falta la columna ID_PIEZA");
  const fieldsByName = (fields: string[], key: string) =>
    fields[column(key)]?.trim() ?? "";
  const size = (value: string) => (/^\d+$/.test(value) ? Number(value) : 0);
  return Object.fromEntries(
    rows
      .filter((fields) => fields[id]?.trim())
      .map((fields) => [
        fields[id]
          .trim()
          .replace(/\.(png|jpe?g)$/i, "")
          .normalize("NFC")
          .toLowerCase(),
        {
          product: fields[product]?.trim() ?? "",
          price: fields[price]?.trim() ?? "",
          ctaAsset: fields[cta]?.trim() ?? "",
          dateAsset: fieldsByName(fields, "SLOT_FECHA"),
          campaign: fieldsByName(fields, "CAMPAÑA"),
          phase: fieldsByName(fields, "FASE"),
          channel: fieldsByName(fields, "CANAL"),
          platform: fieldsByName(fields, "MEDIO_PLATAFORMA"),
          format: fieldsByName(fields, "FORMATO_TIPO").toUpperCase(),
          width: size(fieldsByName(fields, "ANCHO_PX")),
          height: size(fieldsByName(fields, "ALTO_PX")),
        },
      ]),
  );
}
