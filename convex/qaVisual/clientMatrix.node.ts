import { createHash } from "node:crypto";
import { posix } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { Issue } from "./model/contracts";

const sheets = ["PRODUCCION", "LEYENDA", "REGLAS"] as const;
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

export async function parseClientMatrix(name: string, bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const expanded = Object.values(zip.files).reduce(
    (sum, entry) =>
      sum +
      ((entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0),
    0,
  );
  if (expanded > 60 * 1024 * 1024)
    throw new Error("La matriz descomprimida supera 60 MB.");
  const issues: Issue[] = [];
  const xml = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`No se encontró ${path} en la matriz`);
    const text = await entry.async("string");
    if (text.length > 1_000_000 || /<!DOCTYPE/i.test(text))
      throw new Error("XML de matriz inválido");
    return new DOMParser().parseFromString(text, "application/xml");
  };
  const elements = (node: Document | Element, name: string) =>
    Array.from(node.getElementsByTagNameNS("*", name));
  const text = (node: Element) =>
    elements(node, "t")
      .map((part) => part.textContent ?? "")
      .join("");
  const workbook = await xml("xl/workbook.xml");
  const relations = await xml("xl/_rels/workbook.xml.rels");
  const date1904 =
    elements(workbook, "workbookPr")[0]?.getAttribute("date1904") === "1";
  const styles = zip.file("xl/styles.xml")
    ? await xml("xl/styles.xml")
    : undefined;
  const customFormats = new Map(
    styles
      ? elements(styles, "numFmt").map((n) => [
          Number(n.getAttribute("numFmtId")),
          n.getAttribute("formatCode") ?? "",
        ])
      : [],
  );
  const styleFormats = styles
    ? elements(styles, "cellXfs").flatMap((n) =>
        elements(n, "xf").map((x) => Number(x.getAttribute("numFmtId"))),
      )
    : [];
  const isDate = (style: number) => {
    const id = styleFormats[style];
    return (
      (id >= 14 && id <= 22) ||
      /[dy]/i.test((customFormats.get(id) ?? "").replace(/"[^"]*"|\\./g, ""))
    );
  };
  const excelDate = (serial: number) => {
    const date = new Date(
      Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) +
        serial * 86400000,
    );
    return `${date.getUTCDate()} de ${new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(date)}`;
  };
  const shared = zip.file("xl/sharedStrings.xml")
    ? elements(await xml("xl/sharedStrings.xml"), "si").map(text)
    : [];
  const cells: {
    sheet: (typeof sheets)[number];
    cell: string;
    text: string;
  }[] = [];
  for (const sheet of sheets) {
    const id = elements(workbook, "sheet")
      .find((node) => normalized(node.getAttribute("name") ?? "") === sheet)
      ?.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
    const target = elements(relations, "Relationship")
      .find((node) => node.getAttribute("Id") === id)
      ?.getAttribute("Target");
    if (!target) {
      if (sheet === "PRODUCCION")
        throw new Error("Falta la pestaña PRODUCCION");
      issues.push({
        id: `template_optional_sheet_missing:${sheet}`,
        code: "template_optional_sheet_missing",
        scope: "campaign",
        severity: "warning",
        affects: [],
        message: `Falta la pestaña ${sheet}.`,
        sources: [{ file: "excel", name, sheet, text: "" }],
      });
      continue;
    }
    const entry = target.startsWith("/")
      ? target.slice(1)
      : posix.normalize(posix.join("xl", target));
    if (!entry.startsWith("xl/worksheets/"))
      throw new Error("Ubicación de pestaña inválida");
    const worksheet = await xml(entry);
    for (const node of elements(worksheet, "c")) {
      const cell = node.getAttribute("r") ?? "";
      const raw = elements(node, "v")[0]?.textContent ?? "";
      const type = node.getAttribute("t");
      let value = (
        type === "s"
          ? shared[Number(raw)]
          : type === "inlineStr"
            ? text(node)
            : raw
      )?.trim();
      if (elements(node, "f").length && !raw)
        issues.push({
          id: `formula_without_value:${sheet}:${cell}`,
          code: "formula_without_value",
          scope: "piece",
          severity: "warning",
          affects: [],
          message:
            "Una fórmula no tiene un resultado guardado. Abrí y guardá el Excel para actualizarla.",
          sources: [{ file: "excel", name, sheet, cell, text: "" }],
        });
      if (
        raw &&
        (!type || type === "n") &&
        isDate(Number(node.getAttribute("s") ?? 0))
      )
        value = excelDate(Number(raw));
      if (value && /^[A-Z]+[1-9]\d*$/.test(cell))
        cells.push({ sheet, cell, text: value });
    }
    const toColumn = (s: string) =>
      [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    const fromColumn = (n: number) => {
      let s = "";
      while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
      }
      return s;
    };
    for (const merge of elements(worksheet, "mergeCell")) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(
        merge.getAttribute("ref") ?? "",
      );
      if (!match) continue;
      const text = cells.find(
        (c) => c.sheet === sheet && c.cell === `${match[1]}${match[2]}`,
      )?.text;
      if (!text) continue;
      const count =
        (Number(match[4]) - Number(match[2]) + 1) *
        (toColumn(match[3]) - toColumn(match[1]) + 1);
      if (count > 10000 || cells.length + count > 100000)
        throw new Error("La matriz tiene demasiadas celdas combinadas.");
      for (let row = Number(match[2]); row <= Number(match[4]); row++)
        for (let col = toColumn(match[1]); col <= toColumn(match[3]); col++) {
          const cell = `${fromColumn(col)}${row}`;
          if (!cells.some((c) => c.sheet === sheet && c.cell === cell))
            cells.push({ sheet, cell, text });
        }
    }
  }
  if (
    !cells.some(
      (c) =>
        c.sheet === "PRODUCCION" &&
        /^A\d+$/.test(c.cell) &&
        normalized(c.text) === "CAMPANA",
    )
  )
    throw new Error(
      "Plantilla no reconocida: falta el encabezado CAMPAÑA en PRODUCCION.",
    );
  return {
    issues,
    name,
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    cells,
  };
}

export { buildRequirements as matrixReviewData } from "./model/requirements";
