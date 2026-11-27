import type { Matrix } from "./contracts";
import {
  formatLabel,
  normalize,
  offerChannel,
  productTokens,
  temporal,
} from "./normalize";
import { numbered } from "./offers";

/**
 * Builds a production CSV from the client's matrix when the agency did not upload one.
 *
 * Each PRODUCCION row is expanded into one order per numbered offer (with the price of the
 * same ordinal). The columns are the ones `productionByPiece` and `buildRequirements` read,
 * so the generated file links exactly like an agency CSV.
 *
 * ID_PIEZA must be the image file name. An image is assigned to an order only when the match
 * is unambiguous in both directions (one best order for the image and one image for the order);
 * the rest keep a suggested ID so the team can rename the piece or edit the cell in Drive.
 */
export type CsvImage = { name: string; width?: number; height?: number };
export type GeneratedOrder = {
  row: string;
  ordinal: string;
  campaign: string;
  phase: string;
  channel: string;
  platform: string;
  format: string;
  width: number;
  height: number;
  product: string;
  price: string;
  date: string;
  /** Channel written in the offer itself ("DOMICILIO …"), used only to match images. */
  offerChannel?: string;
  image?: string;
  id: string;
};

export const generatedCsvColumns = [
  "ID_PIEZA",
  "TXT_PRODUCTO",
  "TXT_PRECIO",
  "SLOT_CTA",
  "SLOT_FECHA",
  "CAMPAÑA",
  "FASE",
  "CANAL",
  "MEDIO_PLATAFORMA",
  "FORMATO_TIPO",
  "ANCHO_PX",
  "ALTO_PX",
  "FILA_MATRIZ",
  "OFERTA",
  "IMAGEN_QA",
] as const;

const stripOfferPrefix = (value: string) =>
  value
    .replace(/^(?:DOMICILIO|EXPRESS|AUTORAPIDO)\s+/i, "")
    .replace(/^(?:\d{1,2}\s+de\s+\p{L}+|HOY)\s+/iu, "");
const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const dimension = (value: string) =>
  /^\d+(?:[.,]0+)?$/.test(value.trim())
    ? Math.round(Number(value.replace(",", ".")))
    : 0;

export function matrixOrders(matrix: Matrix): GeneratedOrder[] {
  const cells = new Map(
    matrix.cells.map((c) => [`${c.sheet}!${c.cell}`, c.text]),
  );
  const header = matrix.cells.find(
    (c) =>
      c.sheet === "PRODUCCION" &&
      /^A\d+$/.test(c.cell) &&
      normalize(c.text) === "CAMPANA",
  );
  if (!header) return [];
  const rows = matrix.cells
    .filter(
      (c) =>
        c.sheet === "PRODUCCION" &&
        /^A\d+$/.test(c.cell) &&
        Number(c.cell.slice(1)) > Number(header.cell.slice(1)) &&
        normalize(c.text),
    )
    .map((c) => c.cell.slice(1))
    .sort((a, b) => Number(a) - Number(b));
  const orders: GeneratedOrder[] = [];
  for (const row of [...new Set(rows)]) {
    const get = (column: string) =>
      (cells.get(`PRODUCCION!${column}${row}`) ?? "").trim();
    const base = {
      row,
      campaign: get("A"),
      phase: get("B"),
      channel: get("C"),
      platform: get("D"),
      // Exact text of the matrix: the CSV must say the same as the order (§5.5).
      format: get("E"),
      width: dimension(get("I")),
      height: dimension(get("J")),
    };
    const offers = numbered(get("K"));
    const prices = numbered(get("L"));
    if (!offers.length) {
      orders.push({
        ...base,
        ordinal: "",
        product:
          get("K")
            .split(/\r\n|\r|\n/)[0]
            ?.trim() ?? "",
        price: prices.length ? "" : get("L"),
        date: temporal(get("K")) ?? "",
        id: "",
      });
      continue;
    }
    for (const offer of offers) {
      const sameOrdinal = prices.filter((p) => p.ordinal === offer.ordinal);
      orders.push({
        ...base,
        ordinal: offer.ordinal,
        product: stripOfferPrefix(offer.value),
        price: sameOrdinal.length === 1 ? sameOrdinal[0].value : "",
        date: temporal(offer.value) ?? "",
        offerChannel: offerChannel(offer.value),
        id: "",
      });
    }
  }
  return orders;
}

function fileFormat(text: string) {
  if (/\bSTOR(?:Y|IES)\b/.test(text)) return "STORY";
  if (/\bCARR?OU?SEL\b|\bCARRUSEL\b/.test(text)) return "CARRUSEL";
  if (/\bPOST\b/.test(text)) return "POST";
  return undefined;
}

/** Number of product tokens the image name proves, or -1 when the order is incompatible. */
function matchScore(order: GeneratedOrder, image: CsvImage) {
  const text = normalize(stem(image.name));
  const tokens = new Set(text.split(" "));
  const size = image.name.match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
  const width = image.width || (size ? Number(size[1]) : 0);
  const height = image.height || (size ? Number(size[2]) : 0);
  if (
    order.width &&
    order.height &&
    width &&
    height &&
    (order.width !== width || order.height !== height)
  )
    return -1;
  const format = fileFormat(text);
  const orderFormat = formatLabel(order.format);
  if (
    format &&
    ["POST", "STORY", "CARRUSEL"].includes(orderFormat) &&
    format !== orderFormat
  )
    return -1;
  const channel = offerChannel(text);
  const expectedChannel = order.offerChannel ?? offerChannel(order.channel);
  if (channel && expectedChannel && channel !== expectedChannel) return -1;
  const date = temporal(text);
  if (date && order.date && date !== order.date) return -1;
  const product = productTokens(order.product, true);
  if (!product.every((token) => tokens.has(token))) return -1;
  return product.length;
}

export function assignImages(orders: GeneratedOrder[], images: CsvImage[]) {
  const proposals = new Map<GeneratedOrder, CsvImage[]>();
  for (const image of images) {
    const scored = orders
      .map((order) => ({ order, score: matchScore(order, image) }))
      .filter(({ score }) => score > 0);
    const best = Math.max(0, ...scored.map(({ score }) => score));
    const top = scored.filter(({ score }) => score === best);
    if (top.length !== 1) continue;
    proposals.set(top[0].order, [
      ...(proposals.get(top[0].order) ?? []),
      image,
    ]);
  }
  for (const [order, proposed] of proposals)
    if (proposed.length === 1) order.image = proposed[0].name;
  const used = new Set<string>();
  for (const order of orders) {
    const slug = normalize(order.product).replaceAll(" ", "_").slice(0, 48);
    let id = order.image
      ? stem(order.image)
      : [
          `F${order.row}`,
          order.ordinal.padStart(2, "0"),
          normalize(formatLabel(order.format)).replaceAll(" ", "_"),
          slug,
        ]
          .filter(Boolean)
          .join("_");
    for (let n = 2; used.has(id.toLowerCase()); n++) id = `${id}_${n}`;
    used.add(id.toLowerCase());
    order.id = id;
  }
  return orders;
}

const cell = (value: string | number) => {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function buildProductionCsv(matrix: Matrix, images: CsvImage[]) {
  const orders = assignImages(matrixOrders(matrix), images);
  const assigned = new Set(orders.flatMap((o) => (o.image ? [o.image] : [])));
  const lines = [
    generatedCsvColumns.join(";"),
    ...orders.map((o) =>
      [
        o.id,
        o.product,
        o.price,
        "",
        o.date,
        o.campaign,
        o.phase,
        o.channel,
        o.platform,
        o.format,
        o.width || "",
        o.height || "",
        o.row,
        o.ordinal,
        o.image
          ? `Vinculada automáticamente con ${o.image}`
          : "Sin imagen: renombrá la pieza con este ID_PIEZA o corregí la celda",
      ]
        .map(cell)
        .join(";"),
    ),
  ];
  return {
    // The BOM keeps accents readable when the team opens the file in Excel.
    text: `﻿${lines.join("\r\n")}\r\n`,
    orders: orders.length,
    assigned: assigned.size,
    unassignedImages: images
      .map((image) => image.name)
      .filter((name) => !assigned.has(name)),
  };
}
