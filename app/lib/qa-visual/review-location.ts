export type ReviewLocation = {
  piece?: string;
  version?: number;
  thread?: string;
  view?: "review" | "gallery";
};

export function parseReviewLocation(
  params: Record<string, string | string[] | undefined>,
): ReviewLocation {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const version = Number(first(params.v));
  return {
    piece: first(params.pieza) || undefined,
    version: Number.isSafeInteger(version) && version > 0 ? version : undefined,
    thread: first(params.hilo) || undefined,
    view: first(params.vista) === "galeria" ? "gallery" : "review",
  };
}
