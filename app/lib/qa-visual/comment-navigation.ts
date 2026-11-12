export function focusCommentElement(element: HTMLElement, highlight: boolean) {
  element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  if (!highlight) return;

  const reducedMotion = typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  return element.animate([
    { backgroundColor: "var(--primary-soft)", boxShadow: "inset 3px 0 var(--primary-color)", offset: 0 },
    { backgroundColor: "var(--primary-soft)", boxShadow: "inset 3px 0 var(--primary-color)", offset: 0.25 },
    { backgroundColor: "var(--surface-hover)", boxShadow: "inset 0 0 transparent", offset: 1 },
  ], { duration: 850, easing: "ease-out" });
}
