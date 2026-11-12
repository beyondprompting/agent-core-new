import type { Piece } from "./review-model";
import type { QaInventory } from "./source";

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLocaleLowerCase("es")
    .replace(/^./u, (char) => char.toLocaleUpperCase("es"));
const display = (value?: string) => (value ? label(value) : "—");

export function toReviewPieces(
  { pieces, production, clientRequirements }: QaInventory,
  campaignId: string,
): Piece[] {
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
    const media =
      "/workspace/qa-visual/media?" +
      new URLSearchParams({
        campaign: campaignId,
        id: file.driveId,
        v: file.driveVersion,
      });
    const preparedMedia = file.pieceVersionId
      ? "/workspace/qa-visual/media?" +
        new URLSearchParams({
          campaign: campaignId,
          version: file.pieceVersionId,
        })
      : media;
    return {
      id: file.pieceId ?? file.name,
      pieceId: file.pieceId,
      pieceVersionId: file.pieceVersionId,
      currentVersion: file.currentVersion ?? 1,
      name:
        product === "—"
          ? stem
          : variant
            ? `${product} · ${variantLabel}`
            : product,
      filename: file.name,
      image: file.thumbnailReady ? preparedMedia + "&variant=analysis" : "",
      originalImage: media,
      thumbnail: file.thumbnailReady
        ? preparedMedia + "&variant=thumbnail"
        : undefined,
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
      status: file.humanStatus ?? "Pendiente",
      versions: file.versions ?? 1,
      openThreads: file.openThreads ?? 0,
      threadCount: file.threadCount ?? 0,
      product,
      price: record?.price || "—",
      validity: record?.dateAsset || "—",
      cta: record?.ctaAsset || "—",
      clientRequirements: clientRequirements?.[file.name],
      productionLinked: Boolean(record),
    };
  });
}
