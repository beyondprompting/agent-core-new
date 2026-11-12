import type { Requirement } from "./contracts";
import { priceAmount } from "./offers";
import { temporal } from "./normalize";

export function canEvaluate(requirement: Requirement) {
  return Boolean(
    requirement.expected &&
    (requirement.status === "ready" ||
      requirement.status === "conflict" ||
      requirement.basis === "production"),
  );
}

export function compareVisibleValue(
  requirement: Requirement,
  visibleText: string | null,
) {
  if (!visibleText?.trim())
    return {
      outcome: "unverifiable" as const,
      observed: "No se pudo leer el valor visible con suficiente certeza.",
    };
  const normalize = requirement.ruleId === "price" ? priceAmount : temporal;
  const expected = normalize(requirement.expected ?? ""),
    observedValue = normalize(visibleText);
  if (!expected || !observedValue)
    return {
      outcome: "unverifiable" as const,
      observed: `El texto visible «${visibleText}» no puede compararse de forma inequívoca con «${requirement.expected}».`,
      observedValue: visibleText,
    };
  const matches = observedValue === expected;
  const alternative = requirement.expectedAlternatives?.some(
    (value) => normalize(value) === observedValue,
  );
  return {
    outcome: matches ? ("pass" as const) : ("fail" as const),
    observedValue,
    observed: matches
      ? `El valor visible «${visibleText}» coincide con ${requirement.basis === "client" ? "el pedido del cliente" : "producción"}.`
      : `El valor visible «${visibleText}» ${alternative ? "coincide con el CSV, pero " : ""}no coincide con «${requirement.expected}».`,
  };
}
