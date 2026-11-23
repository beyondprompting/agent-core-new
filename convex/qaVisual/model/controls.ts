import type { Requirement } from "./contracts";
import { priceAmount } from "./offers";
import { visibleDate, validDateParts } from "./visibleDate";

export type VisualAssessment = {
  outcome: "pass" | "fail" | "unverifiable" | "notApplicable";
  observed: string;
  visibleText: string | null;
  evidenceStatus: "readable" | "absent" | "unreadable" | "ambiguous";
  missingElements: string[];
  /** The model passed the control because an instruction of the QA team says so. */
  waivedByInstructions?: boolean;
};

type ControlOptions = {
  /** The model also received what was asked to change on an earlier version. */
  changeRequests?: boolean;
  /** The model also received instructions of the QA team for this campaign. */
  instructions?: boolean;
};

type Comparison = {
  outcome: "pass" | "fail";
  observed: string;
  observedValue: string;
};

export function canEvaluate(requirement: Requirement) {
  return Boolean(
    requirement.expected?.trim() &&
    (requirement.status === "ready" ||
      requirement.status === "conflict" ||
      requirement.basis === "production"),
  );
}

export function compareVisibleValue(
  requirement: Requirement,
  visibleText: string | null,
): Comparison | undefined {
  if (!visibleText?.trim()) return undefined;
  let matches: boolean;
  if (requirement.ruleId === "price") {
    const expected = priceAmount(requirement.expected ?? "");
    const observed = priceAmount(visibleText);
    if (!expected || !observed) return undefined;
    matches = expected === observed;
  } else if (requirement.ruleId === "date") {
    const expected = visibleDate(requirement.expected ?? "");
    const observed = visibleDate(visibleText);
    if (!expected || !observed || !validDateParts(expected)) return undefined;
    const fields = ["day", "month", "year", "weekday", "relative"] as const;
    const labels = {
      day: "el día",
      month: "el mes",
      year: "el año",
      weekday: "el día de la semana",
      relative: "la referencia temporal",
    };
    const missing = fields.filter(
      (field) => expected[field] !== undefined && observed[field] === undefined,
    );
    if (missing.length && !expected.relative && !observed.relative)
      return {
        outcome: "fail",
        observedValue: visibleText,
        observed: `El texto visible «${visibleText}» omite ${missing.map((field) => labels[field]).join(" y ")} requerido por «${requirement.expected}».`,
      };
    matches =
      validDateParts(observed) &&
      fields.every(
        (field) =>
          expected[field] === undefined || expected[field] === observed[field],
      );
  } else return undefined;
  return {
    outcome: matches ? "pass" : "fail",
    observedValue: visibleText,
    observed: matches
      ? `El valor visible «${visibleText}» coincide con ${requirement.basis === "client" ? "el pedido del cliente" : "producción"}.`
      : `El valor visible «${visibleText}» no coincide con «${requirement.expected}».`,
  };
}

/** Absence is evidence of a failure; unsupported syntax is not missing evidence. */
export function resolveVisualControl(
  requirement: Requirement,
  control: VisualAssessment,
  options: ControlOptions = {},
) {
  const result = (
    outcome: VisualAssessment["outcome"],
    observed: string,
    method: "model" | "deterministic" = "model",
  ) => ({ outcome, observed, method });
  if (requirement.status === "notRequested")
    return result(
      "notApplicable",
      "El pedido vinculado no exige este control.",
      "deterministic",
    );
  if (!canEvaluate(requirement))
    return result(
      "unverifiable",
      "No hay una referencia suficiente para evaluar este control.",
      "deterministic",
    );
  // An instruction of the QA team prevails over the checks below (absence, parsers).
  if (waived(control, options)) return result("pass", control.observed);
  if (control.evidenceStatus === "absent")
    return result(
      "fail",
      `No aparece el elemento requerido por «${requirement.expected}». ${control.observed}`,
    );
  if (
    control.evidenceStatus === "unreadable" ||
    control.evidenceStatus === "ambiguous"
  ) {
    if (!control.observed.trim() || control.missingElements.length)
      throw new Error("invalid_controls");
    return result("unverifiable", control.observed);
  }
  const missing = control.missingElements
    .map((element) => element.trim())
    .filter(Boolean);
  if (missing.length)
    return result(
      "fail",
      `Falta contenido requerido por «${requirement.expected}»: ${missing.join("; ")}. ${control.observed}`,
    );
  if (["price", "date"].includes(requirement.ruleId)) {
    if (!control.visibleText?.trim()) throw new Error("invalid_controls");
    const compared = compareVisibleValue(requirement, control.visibleText);
    // The client or the team may have changed this value on an earlier version, or the QA
    // team's instructions accept it: the model's pass prevails over the original request.
    if (
      compared?.outcome === "fail" &&
      (options.changeRequests || options.instructions) &&
      control.outcome === "pass" &&
      control.observed.trim()
    )
      return result("pass", control.observed);
    if (compared) return { ...compared, method: "deterministic" as const };
  }
  // The model already evaluated semantics in the same request. A parser miss
  // must preserve that assessment, including readable unsupported formats.
  if (!["pass", "fail"].includes(control.outcome) || !control.observed.trim())
    throw new Error("invalid_controls");
  return result(control.outcome, control.observed);
}

function waived(control: VisualAssessment, options: ControlOptions) {
  return Boolean(
    options.instructions &&
    control.waivedByInstructions &&
    control.outcome === "pass" &&
    control.observed.trim(),
  );
}

/**
 * Writing control of every piece. There is no expected value: the model lists each error in
 * missingElements as «written → correction». A piece without text has nothing to check.
 */
export function resolveSpellingControl(
  control: VisualAssessment,
  options: ControlOptions = {},
) {
  const result = (outcome: VisualAssessment["outcome"], observed: string) => ({
    outcome,
    observed,
    method: "model" as const,
  });
  if (waived(control, options)) return result("pass", control.observed);
  if (control.evidenceStatus === "absent")
    return result(
      "notApplicable",
      control.observed.trim() || "La pieza no tiene texto para revisar.",
    );
  if (
    control.evidenceStatus === "unreadable" ||
    control.evidenceStatus === "ambiguous"
  ) {
    if (!control.observed.trim()) throw new Error("invalid_controls");
    return result("unverifiable", control.observed);
  }
  const errors = control.missingElements
    .map((element) => element.trim())
    .filter(Boolean);
  if (errors.length)
    return result(
      "fail",
      `Errores de escritura: ${errors.join("; ")}. ${control.observed}`.trim(),
    );
  if (!["pass", "fail"].includes(control.outcome) || !control.observed.trim())
    throw new Error("invalid_controls");
  return result(control.outcome, control.observed);
}
