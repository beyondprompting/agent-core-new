/**
 * Retry policy of the analysis runner (§10.3). Workpool does not retry analysis jobs; after each
 * attempt this function decides the next provider and delay, or null for a terminal failure.
 * At most 3 Gemini calls and 2 fallback calls per piece.
 */
export type Provider = "gemini" | "openai";
export type AttemptRecord = { provider: Provider; code: string };

const MAX_ATTEMPTS: Record<Provider, number> = { gemini: 3, openai: 2 };
// Input errors: the same image and request would fail with any provider.
const FATAL = new Set(["http_400", "http_413", "image_rejected", "image_unavailable", "image_too_large"]);
// Configuration or policy errors of one provider: move to the other provider without retrying it.
const SWITCH_ONLY = new Set(["http_401", "http_403", "http_404", "safety_blocked"]);

export function nextAttempt(
  attempts: AttemptRecord[],
  retryAfterMs?: number,
): { provider: Provider; delayMs: number } | null {
  const last = attempts.at(-1);
  if (!last) return { provider: "gemini", delayMs: 0 };
  if (FATAL.has(last.code)) return null;
  const used = (provider: Provider) => attempts.filter((a) => a.provider === provider).length;
  const sameLimit =
    SWITCH_ONLY.has(last.code) ? 0 : last.code === "invalid_output" ? 2 : MAX_ATTEMPTS[last.provider];
  const sameUsed = used(last.provider);
  if (sameUsed < Math.min(sameLimit, MAX_ATTEMPTS[last.provider])) {
    const delayMs =
      last.code === "http_429"
        ? (retryAfterMs ?? (sameUsed === 1 ? 10_000 : 30_000))
        : 2_000 * 2 ** (sameUsed - 1);
    return { provider: last.provider, delayMs };
  }
  if (last.provider === "gemini" && used("openai") < MAX_ATTEMPTS.openai)
    return { provider: "openai", delayMs: 0 };
  return null;
}

export function terminalMessage(attempts: AttemptRecord[]) {
  const last = attempts.at(-1);
  if (last && FATAL.has(last.code))
    return "El proveedor rechazó la imagen o la solicitud. Revisá la pieza y volvé a analizarla.";
  if (last?.code === "http_429")
    return "Se alcanzó el límite de uso del proveedor de IA. Reintentá las piezas fallidas en unos minutos.";
  return "Gemini y el modelo de respaldo no pudieron completar la revisión.";
}
