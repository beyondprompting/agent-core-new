import type { Issue } from "../../../convex/qaVisual/model/contracts";

/** The reason shown when the piece could not be matched to the client's request. */
export const UNLINKED_REASON = "Pedido sin vincular o incompleto";

const text = (issue: Issue, file: "csv" | "excel" | "filename", column?: string) =>
  issue.sources.find((s) => s.file === file && (!column || s.column === column))?.text?.trim();

const cell = (issue: Issue) => {
  const s = issue.sources.find((s) => s.file === "excel" && s.cell);
  return s ? `${s.sheet ?? "PRODUCCION"}!${s.cell}` : undefined;
};

/**
 * Explains in plain words what failed when linking a piece to the client's matrix and what
 * to do about it. Based on the import notices of the piece.
 */
export function explainUnlinked(issues: readonly Issue[], fileName: string): string[] {
  const out: string[] = [];
  const add = (line: string) => {
    if (!out.includes(line)) out.push(line);
  };
  for (const issue of issues) {
    switch (issue.code) {
      case "csv_row_missing":
        add(
          `El archivo «${text(issue, "filename") ?? fileName}» no aparece en el CSV de producción (EDITABLES). Sin esa fila no sabemos a qué pedido de la matriz corresponde la pieza, así que no hay datos contra los cuales compararla. Revisá que el nombre del archivo en Drive coincida con el del CSV, o agregá la fila, y después usá «Actualizar desde Drive».`,
        );
        break;
      case "excel_row_missing":
        add(
          `La pieza está en el CSV de producción, pero no encontramos su fila en la matriz del cliente (hoja PRODUCCION)${text(issue, "csv", "CAMPAÑA") ? ` para «${text(issue, "csv", "CAMPAÑA")}»` : ""}. Los controles se compararon solo con los datos de producción, que no reemplazan al pedido del cliente. Revisá que la pieza esté cargada en la matriz y actualizá desde Drive.`,
        );
        break;
      case "excel_row_ambiguous":
        add(
          `La pieza coincide con más de una fila de la matriz del cliente${text(issue, "csv", "CAMPAÑA") ? ` para «${text(issue, "csv", "CAMPAÑA")}»` : ""}, y no podemos saber cuál es la correcta. Los controles se compararon solo con los datos de producción. Dejá una sola fila para esta pieza en la matriz y actualizá desde Drive.`,
        );
        break;
      case "offer_not_found":
        add(
          `No encontramos en la matriz del cliente${cell(issue) ? ` (${cell(issue)})` : ""} una oferta que coincida con el producto del CSV${text(issue, "csv", "TXT_PRODUCTO") ? ` «${text(issue, "csv", "TXT_PRODUCTO")}»` : ""}. Por eso producto, precio y vigencia quedan sin referencia. Confirmá la oferta correcta desde el aviso de la pieza o corregí el nombre del producto.`,
        );
        break;
      case "offer_ambiguous":
        add(
          `El producto del CSV${text(issue, "csv", "TXT_PRODUCTO") ? ` «${text(issue, "csv", "TXT_PRODUCTO")}»` : ""} coincide con ${issue.candidates?.length ? `${issue.candidates.length} ofertas` : "varias ofertas"} de la matriz del cliente y no podemos elegir una sola. Producto, precio y vigencia quedan pendientes hasta que elijas la oferta correcta desde el aviso de la pieza.`,
        );
        break;
      case "format_missing":
      case "dimensions_missing":
      case "price_missing":
      case "price_invalid":
      case "date_missing":
        add(`${issue.message}${cell(issue) ? ` (${cell(issue)})` : ""} Completalo en la matriz y actualizá desde Drive.`);
        break;
      case "cta_unresolved":
        add(`${issue.message}${cell(issue) ? ` (${cell(issue)})` : ""} Revisá cómo está escrito el CTA en la matriz.`);
        break;
      // Other notices (conflicts, confirmations) have their own reason in the summary.
    }
  }
  if (!out.length)
    add(
      "Al pedido vinculado le faltan datos para algunos de los controles solicitados, así que la IA no pudo compararlos con una referencia. Revisá la fila de la pieza en la matriz del cliente y actualizá desde Drive.",
    );
  return out;
}
