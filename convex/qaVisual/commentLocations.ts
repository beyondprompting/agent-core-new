import { z } from "zod";

const regionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .describe(
    "Rectángulo sobre la imagen completa: x izquierda, y arriba, ancho y alto, todos en proporciones 0 a 1.",
  );

export const reviewControlSchema = z.object({
  ruleId: z.string(),
  outcome: z.enum(["pass", "fail", "unverifiable", "notApplicable"]),
  observed: z.string(),
  visibleAnchor: z
    .string()
    .nullable()
    .describe(
      "Texto literalmente visible dentro del rectángulo o descripción del elemento visible.",
    ),
  region: regionSchema.nullable(),
});

export const commentLocationSchema = z.object({
  ruleId: z.string(),
  status: z.enum(["located", "absent", "unreadable", "uncertain"]),
  visibleAnchor: z.string().nullable(),
  region: regionSchema.nullable(),
});

const boxSchema = z
  .array(z.number().int().min(0).max(1000))
  .length(4)
  .nullable()
  .describe(
    "box_2d: [y_min, x_min, y_max, x_max], cuatro enteros normalizados de 0 a 1000 sobre la imagen completa.",
  );
export const reviewControlOutputSchema = reviewControlSchema
  .omit({ region: true })
  .extend({ box_2d: boxSchema });
export const commentLocationOutputSchema = commentLocationSchema
  .omit({ region: true })
  .extend({ box_2d: boxSchema });

export function imageBoxToRegion(box: number[] | null) {
  if (
    !box ||
    box.length !== 4 ||
    box.some((value) => !Number.isInteger(value) || value < 0 || value > 1000)
  )
    return null;
  const [top, left, bottom, right] = box;
  if (bottom <= top || right <= left) return null;
  return {
    x: left / 1000,
    y: top / 1000,
    width: (right - left) / 1000,
    height: (bottom - top) / 1000,
  };
}

type Control = z.infer<typeof reviewControlSchema>;
type Location = z.infer<typeof commentLocationSchema>;
export type LocatedControl = Control & {
  locationStatus?: "located" | "absent" | "unreadable" | "unlocated";
};

export function hasValidCommentRegion(
  control: Pick<Control, "visibleAnchor" | "region">,
) {
  const box = control.region;
  return Boolean(
    box &&
    control.visibleAnchor?.trim() &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1 &&
    box.y + box.height <= 1,
  );
}

export async function completeCommentLocations(
  controls: Control[],
  locate: (
    targets: { ruleId: string; observed: string }[],
  ) => Promise<Location[]>,
): Promise<LocatedControl[]> {
  const pending = controls.filter(
    (control) =>
      (control.outcome === "fail" || control.outcome === "unverifiable") &&
      !hasValidCommentRegion(control),
  );
  let locations: Location[] = [];
  try {
    if (pending.length)
      locations = await locate(
        pending.map(({ ruleId, observed }) => ({ ruleId, observed })),
      );
  } catch {
    /* A localization failure must not discard a valid review. */
  }
  const byId = new Map(
    locations.map((location) => [location.ruleId, location]),
  );

  return controls.map((control): LocatedControl => {
    const location =
      locations.filter((l) => l.ruleId === control.ruleId).length === 1
        ? byId.get(control.ruleId)
        : undefined;
    if (!location)
      return {
        ...control,
        ...(hasValidCommentRegion(control)
          ? { locationStatus: "located" as const }
          : {
              region: null,
              visibleAnchor: null,
              locationStatus: "unlocated" as const,
            }),
      };
    if (
      location.status === "uncertain" ||
      (location.status === "located" && !hasValidCommentRegion(location))
    ) {
      return {
        ...control,
        region: null,
        visibleAnchor: null,
        locationStatus: "unlocated",
      };
    }
    return {
      ...control,
      visibleAnchor:
        location.status === "located" ? location.visibleAnchor!.trim() : null,
      region: location.status === "located" ? location.region : null,
      locationStatus: location.status,
    };
  });
}
