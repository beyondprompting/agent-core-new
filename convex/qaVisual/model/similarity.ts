/**
 * How much two piece names look alike, by their words. Used to order the free CSV rows offered
 * to a piece without a row: in the panel (most similar first) and in the review with Gemini
 * Neon (only the most similar rows are sent). It only orders options; it never chooses one.
 */
export const foldName = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

/** Words of a name, without accents and in upper case («Estático_5» → ESTATICO, 5). */
export const nameWords = (text: string) =>
  foldName(text)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

/** Shared words over all words (0 to 1). */
export function nameSimilarity(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * Rows ordered for a piece: most similar ID first, then the rows of its size, then by line.
 * `size` reads the width and height of a row when it has them.
 */
export function rankRows<T extends { csvLine: number; id: string }>(
  piece: { name: string; width?: number; height?: number },
  rows: T[],
  size: (row: T) => { width: number; height: number } | undefined,
) {
  const words = nameWords(piece.name.replace(/\.[^.]+$/, ""));
  return rows
    .map((row) => {
      const measured = size(row);
      return {
        row,
        size: measured,
        score: nameSimilarity(words, nameWords(row.id)),
        sized:
          !!measured &&
          measured.width === piece.width &&
          measured.height === piece.height,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.sized) - Number(a.sized) ||
        a.row.csvLine - b.row.csvLine,
    );
}
