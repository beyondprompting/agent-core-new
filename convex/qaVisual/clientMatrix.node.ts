import { createHash } from "node:crypto";
import { posix } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { ProductionFields } from "../../app/lib/qa-visual/production-csv";
import type { ClientRequirement } from "../../app/lib/qa-visual/review-model";

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
    if (!target) throw new Error(`Falta la pestaña ${sheet}`);
    const entry = target.startsWith("/")
      ? target.slice(1)
      : posix.normalize(posix.join("xl", target));
    if (!entry.startsWith("xl/worksheets/"))
      throw new Error("Ubicación de pestaña inválida");
    for (const node of elements(await xml(entry), "c")) {
      const cell = node.getAttribute("r") ?? "";
      const raw = elements(node, "v")[0]?.textContent ?? "";
      const type = node.getAttribute("t");
      const value = (
        type === "s"
          ? shared[Number(raw)]
          : type === "inlineStr"
            ? text(node)
            : raw
      )?.trim();
      if (value && /^[A-Z]+[1-9]\d*$/.test(cell))
        cells.push({ sheet, cell, text: value });
    }
  }
  return {
    name,
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    cells,
  };
}

type Matrix = Awaited<ReturnType<typeof parseClientMatrix>>;
function numbered(value: string) {
  return [...value.matchAll(/(?:^|\n)\s*(\d+)\.\s*([^\n]*)/g)].map((match) => ({
    ordinal: match[1],
    value: match[2].trim(),
  }));
}

export function matrixRequirements(
  matrix: Matrix,
  fileName: string,
  production?: ProductionFields,
): ClientRequirement[] {
  if (!production) return [];
  const cells = new Map(
    matrix.cells.map((cell) => [`${cell.sheet}!${cell.cell}`, cell.text]),
  );
  const header = matrix.cells.find(
    (cell) =>
      cell.sheet === "PRODUCCION" &&
      cell.cell.startsWith("A") &&
      normalized(cell.text) === "CAMPANA",
  );
  if (!header) return [];
  const format = /_CARRUSEL_/i.test(fileName)
    ? "CARRUSEL"
    : normalized(production.format);
  const formatLabel = (value: string) =>
    value.startsWith("POST ESTATIC") || value === "POST"
      ? "POST"
      : value.startsWith("STORIES ESTATIC") ||
          value === "STORIES" ||
          value === "STORY"
        ? "STORY"
        : value === "POST CARROUSEL"
          ? "CARRUSEL"
          : value;
  const rows = matrix.cells
    .filter(
      (cell) =>
        cell.sheet === "PRODUCCION" &&
        /^A\d+$/.test(cell.cell) &&
        Number(cell.cell.slice(1)) > Number(header.cell.slice(1)) &&
        normalized(cell.text) === normalized(production.campaign),
    )
    .map((cell) => cell.cell.slice(1))
    .filter(
      (row) =>
        [
          ["B", production.phase],
          ["C", production.channel],
          ["D", production.platform],
        ].every(
          ([col, value]) =>
            normalized(cells.get(`PRODUCCION!${col}${row}`) ?? "") ===
            normalized(value),
        ) &&
        formatLabel(normalized(cells.get(`PRODUCCION!E${row}`) ?? "")) ===
          formatLabel(format),
    );
  if (rows.length !== 1) return [];
  const row = rows[0];
  const ref = (col: string) => `PRODUCCION!${col}${row}`;
  const get = (col: string) => cells.get(ref(col)) ?? "";
  const result: ClientRequirement[] = [];
  const add = (
    id: string,
    expected: string,
    source: string,
    pending?: string,
  ) => {
    if (expected)
      result.push({ id, expected, source, ...(pending ? { pending } : {}) });
  };
  const references = (key: string) => (cells.has(key) ? ` · ${key}` : "");
  if (Number(get("I")) && Number(get("J"))) {
    const template = cells.get("LEYENDA!C11");
    const legendSize = template?.match(
      formatLabel(format) === "POST"
        ? /Post Estático:\s*(\d+\s*x\s*\d+)/i
        : formatLabel(format) === "STORY"
          ? /Stories Estática:\s*(\d+\s*x\s*\d+)/i
          : /(?!) /,
    )?.[1];
    const size = `${Number(get("I"))} × ${Number(get("J"))}`;
    const conflict =
      legendSize &&
      legendSize.replace(/\s/g, "").toLowerCase() !==
        size.replace(/\s/g, "").replace("×", "x");
    add(
      "dimensions",
      size,
      `${ref("I")}:J${row}${legendSize ? references("LEYENDA!C11") : ""}`,
      conflict
        ? "La matriz y la leyenda indican dimensiones distintas."
        : undefined,
    );
  }
  add("format", get("G"), `${ref("G")}${references("LEYENDA!B9")}`);
  const variant = normalized(fileName)
    .match(/\b(DOMICILIO|EXPRESS|AUTORAPIDO)\b/g)
    ?.at(-1);
  const day = normalized(fileName)
    .match(
      /\b(?:OCTUBRE|NOVIEMBRE|DICIEMBRE|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE) \d{1,2}\b|\bHOY\b/g,
    )
    ?.at(-1);
  const offers = numbered(get("K")).filter(({ value }) => {
    const offer = normalized(value);
    const product = normalized(production.product);
    if (!product || !` ${offer} `.includes(` ${product} `)) return false;
    const offerChannel = offer.match(/\b(DOMICILIO|EXPRESS|AUTORAPIDO)\b/)?.[1];
    if (offerChannel && variant && offerChannel !== variant) return false;
    const date = offer.match(/\b(\d{1,2}) DE ([A-Z]+)\b/);
    return (
      !day ||
      (date
        ? day === `${date[2]} ${date[1]}`
        : !offer.includes("HOY") || day === "HOY")
    );
  });
  const storyConflict =
    formatLabel(format) === "STORY" &&
    get("K") &&
    /stories.*sin oferta/i.test(cells.get("REGLAS!B6") ?? "");
  const pending = storyConflict
    ? "La fila tiene oferta, pero REGLAS!B6 indica dejarla vacía para Stories."
    : undefined;
  if (offers.length === 1) {
    const { value, ordinal } = offers[0];
    const productOnly = value
      .replace(/^(?:DOMICILIO|EXPRESS|AUTORAPIDO)\s+/i, "")
      .replace(/^(?:\d{1,2}\s+de\s+\p{L}+|HOY)\s+/iu, "");
    add(
      "product",
      productOnly,
      ref("K") + (pending ? " · REGLAS!B6 · LEYENDA!B12" : ""),
      pending,
    );
    const price = numbered(get("L")).find(
      (item) => item.ordinal === ordinal,
    )?.value;
    if (price)
      add("price", price, ref("L") + (pending ? " · REGLAS!B6" : ""), pending);
    const date = value.match(/\b\d{1,2}\s+de\s+\p{L}+\b|\bHOY\b/iu)?.[0];
    if (date)
      add(
        "date",
        date,
        ref("K") +
          (/fecha|vigencia|vigente/i.test(get("P")) ? ` · ${ref("P")}` : "") +
          (pending ? " · REGLAS!B6" : ""),
        pending,
      );
  } else if (get("K")) {
    for (const id of ["product", "price", "date"]) {
      add(
        id,
        get("K"),
        ref("K"),
        "No se pudo asociar una única oferta de la matriz a esta imagen.",
      );
    }
  }
  const notes = get("P");
  const cta = notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      /call to action|\bcta\b|^cpa\s*:|^tagline\s*:/i.test(line),
    )
    .join("\n");
  add("cta", cta, ref("P") + references("LEYENDA!C15"));
  return result;
}
