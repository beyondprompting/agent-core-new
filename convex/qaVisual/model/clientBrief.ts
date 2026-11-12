import type { Requirement } from "./contracts";
import { normalize } from "./normalize";

/**
 * Client-facing summary of a piece (§23.2 «Ficha del pedido»). It only uses requirements
 * that are ready and based on the client's own order: no cells, CSV values or notices.
 */
const fieldLabels: Record<string, string> = {
  product: "Producto",
  price: "Precio",
  date: "Vigencia",
  cta: "Llamado a la acción",
};
const channelLabels: Record<string, string> = {
  DOMICILIO: "Domicilio",
  EXPRESS: "Express",
  AUTORAPIDO: "Auto Rápido",
};

const titleCase = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLocaleLowerCase("es")
    .replace(/(^|\s)(\p{L})/gu, (_, space: string, char: string) =>
      space + char.toLocaleUpperCase("es"),
    );

export function pieceChannel(fileName: string) {
  const token = normalize(fileName)
    .match(/\b(DOMICILIO|EXPRESS|AUTORAPIDO)\b/g)
    ?.at(-1);
  return token ? channelLabels[token] : undefined;
}

export function pieceFormat(
  fileName: string,
  production?: { format?: string; width?: number; height?: number },
  image?: { width: number; height: number },
) {
  const token = (production?.format || normalize(fileName)).toUpperCase();
  const name = /STOR/.test(token)
    ? "Story"
    : /CARRUSEL|CAROUSEL/.test(token)
      ? "Carrusel"
      : /POST/.test(token)
        ? "Post"
        : "Imagen";
  const width = production?.width || image?.width;
  const height = production?.height || image?.height;
  return width && height ? `${name} · ${width} × ${height}` : name;
}

export function pieceTitle(
  fileName: string,
  production?: { product?: string },
) {
  const channel = pieceChannel(fileName);
  if (!production?.product)
    return fileName.replace(/\.[^.]+$/, "").replaceAll("_", " ");
  const product = titleCase(production.product);
  return channel ? `${product} · ${channel}` : product;
}

export function buildClientBrief(input: {
  fileName: string;
  requirements: Requirement[];
  production?: { product?: string; format?: string; width?: number; height?: number };
  image?: { width: number; height: number };
  requirementsHash?: string;
}) {
  const fields: { key: string; label: string; value: string }[] = [];
  for (const key of ["product", "price", "date"]) {
    const requirement = input.requirements.find(
      (r) => r.ruleId === key && r.status === "ready" && r.basis === "client",
    );
    const value = requirement?.display ?? requirement?.expected;
    if (value) fields.push({ key, label: fieldLabels[key], value });
  }
  const channel = pieceChannel(input.fileName);
  if (channel) fields.push({ key: "channel", label: "Canal", value: channel });
  fields.push({
    key: "format",
    label: "Formato",
    value: pieceFormat(input.fileName, input.production, input.image),
  });
  const cta = input.requirements.find(
    (r) => r.ruleId === "cta" && r.status === "ready" && r.basis === "client",
  );
  const ctaValue = cta?.display ?? cta?.expected;
  if (ctaValue)
    fields.push({ key: "cta", label: fieldLabels.cta, value: ctaValue.slice(0, 400) });
  return {
    title: pieceTitle(input.fileName, input.production),
    format: pieceFormat(input.fileName, input.production, input.image),
    fields: fields.slice(0, 12),
    ...(input.requirementsHash ? { requirementsHash: input.requirementsHash } : {}),
  };
}

export type ClientState = "sent" | "viewed" | "changesRequested" | "approved";

/** Why an internal version cannot be sent yet. Undefined means it is eligible. */
export function deliveryBlocker(input: {
  pieceStatus: string;
  approved: boolean;
  alreadySent: boolean;
}) {
  if (input.pieceStatus !== "active") return "La pieza ya no está en Drive";
  if (input.alreadySent) return "Esta versión ya se envió al cliente";
  if (!input.approved) return "Sin aprobación interna";
  return undefined;
}
