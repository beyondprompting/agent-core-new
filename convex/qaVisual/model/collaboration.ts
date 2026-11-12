import { v, type Infer } from "convex/values";
import { ConvexError } from "convex/values";

const point = { x: v.number(), y: v.number() };
export const anchor = v.union(
  v.object({ kind: v.literal("general") }),
  v.object({ kind: v.literal("point"), ...point }),
  v.object({
    kind: v.literal("rect"),
    ...point,
    width: v.number(),
    height: v.number(),
  }),
  v.object({ kind: v.literal("path"), points: v.array(v.object(point)) }),
);
export const exception = v.object({
  reason: v.union(
    v.literal("acceptedFinding"),
    v.literal("falsePositive"),
    v.literal("notApplicable"),
    v.literal("other"),
  ),
  note: v.string(),
});
export type Anchor = Infer<typeof anchor>;
export function validateAnchor(value: Anchor) {
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  let valid = true;
  if (value.kind === "point" || value.kind === "rect")
    valid = unit(value.x) && unit(value.y);
  if (value.kind === "rect")
    valid &&=
      value.width > 0 &&
      value.height > 0 &&
      unit(value.width) &&
      unit(value.height) &&
      value.x + value.width <= 1.000001 &&
      value.y + value.height <= 1.000001;
  if (value.kind === "path")
    valid =
      value.points.length >= 2 &&
      value.points.length <= 500 &&
      value.points.every((p) => unit(p.x) && unit(p.y));
  if (!valid)
    throw new ConvexError({
      code: "invalid_anchor",
      message:
        "La anotación está fuera de la imagen o tiene demasiados puntos.",
    });
}
export function commentBody(value: string) {
  const body = value.trim();
  if (!body || body.length > 4000)
    throw new ConvexError({
      code: "invalid_comment",
      message: "Escribí un comentario de entre 1 y 4000 caracteres.",
    });
  return body;
}
