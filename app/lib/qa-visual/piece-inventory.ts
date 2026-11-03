import type { Piece } from "./review-model";
import type { QaInventory } from "./source";

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLocaleLowerCase("es")
    .replace(/^./u, (char) => char.toLocaleUpperCase("es"));
const display = (value?: string) => (value ? label(value) : "—");

export function toReviewPieces({ pieces, production }: QaInventory): Piece[] {
  return pieces.map((file) => {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const record = production?.[stem.normalize("NFC").toLowerCase()];
    const dimensions = stem.match(/_(\d+)x(\d+)px$/i);
    const width = Number(dimensions?.[1]) || record?.width || 0;
    const height = Number(dimensions?.[2]) || record?.height || 0;
    const token = stem.toUpperCase().match(/_(STORIES?|POSTS?|CARRUSEL)_/)?.[1];
    const format = record?.format || token;
    const formatName =
      format === "STORIES" || format === "STORY"
        ? "Story"
        : format
          ? label(format)
          : "Imagen";
    const product = display(record?.product);
    const variant = stem.match(/_(DOMICILIO|EXPRESS|AUTORAPIDO)_/i)?.[1];
    const channel = display(record?.channel);
    const variantLabel =
      variant?.toUpperCase() === "AUTORAPIDO"
        ? "Auto Rápido"
        : display(variant);
    return {
      id: file.name,
      name:
        product === "—"
          ? stem
          : variant
            ? `${product} · ${variantLabel}`
            : product,
      filename: file.name,
      image:
        "/workspace/qa-visual/media?" +
        new URLSearchParams({ name: file.name, v: String(file.updatedAt) }),
      width,
      height,
      channel,
      platform: record?.platform || "—",
      extension: file.name.split(".").at(-1)?.toUpperCase(),
      phase: display(record?.phase),
      campaign: display(record?.campaign),
      formatName,
      format:
        width && height ? `${formatName} · ${width} × ${height}` : formatName,
      status: "Pendiente",
      versions: 1,
      product,
      price: record?.price || "—",
      validity: record?.dateAsset || "—",
      cta: record?.ctaAsset || "—",
      productionLinked: Boolean(record),
    };
  });
}
