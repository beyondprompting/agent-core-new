/** QA Visual is available in development or when QA_VISUAL_ENABLED=true is set explicitly. */
export function qaVisualEnabled() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.QA_VISUAL_ENABLED === "true"
  );
}
