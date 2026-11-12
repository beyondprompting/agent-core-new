import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

/**
 * Global analysis concurrency for every QA campaign (§10.1 decision of 12/11/2026).
 * It is configured per environment with QA_VISUAL_ANALYSIS_CONCURRENCY and must be sized
 * from measured quotas, call duration and tokens per piece. The default only avoids leaving
 * people waiting while measurements are pending; each run still uses at most 4 slots.
 */
const DEFAULT_CONCURRENCY = 24;
const MAX_CONCURRENCY = 100;

export function analysisConcurrency(value = process.env.QA_VISUAL_ANALYSIS_CONCURRENCY) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_CONCURRENCY)
    : DEFAULT_CONCURRENCY;
}

export const PER_RUN_SLOTS = 4;

// Retries are decided by model/retryPolicy.ts, not by Workpool.
export const analysisPool = new Workpool(components.qaVisualAnalysisPool, {
  maxParallelism: analysisConcurrency(),
  retryActionsByDefault: false,
});
