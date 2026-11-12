export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
export function pieceKey(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}
const connectors = new Set([
  "DE",
  "DEL",
  "LA",
  "EL",
  "LOS",
  "LAS",
  "Y",
  "CON",
  "AL",
  "EN",
]);
export function productTokens(value: string, omitConnectors = false) {
  return normalize(value)
    .split(" ")
    .filter((token) => token && (!omitConnectors || !connectors.has(token)));
}
export function formatLabel(value: string) {
  const text = normalize(value);
  if (/^POST ESTATIC|^POST$/.test(text)) return "POST";
  if (/^STORIES ESTATIC|^STOR(?:Y|IES)$/.test(text)) return "STORY";
  if (/^POST CARROUSEL$|^CARRUSEL$/.test(text)) return "CARRUSEL";
  return text;
}
const months = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];
export function temporal(value: string) {
  const text = normalize(value);
  if (/\bHOY\b/.test(text)) return "HOY";
  for (const month of months) {
    const day =
      text.match(new RegExp(`\\b(\\d{1,2}) (?:DE )?${month}\\b`))?.[1] ??
      text.match(new RegExp(`\\b${month} (\\d{1,2})\\b`))?.[1];
    if (day && Number(day) >= 1 && Number(day) <= 31)
      return `${Number(day)} DE ${month}`;
  }
  return undefined;
}
export function offerChannel(value: string) {
  return normalize(value)
    .match(/\b(DOMICILIO|EXPRESS|AUTORAPIDO)\b/g)
    ?.at(-1);
}
