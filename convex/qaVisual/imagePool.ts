import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

// Image preparation only (§10.1): one job per Drive file version, retried with backoff.
export const imagePool = new Workpool(components.qaVisualImagePool, {
  maxParallelism: 4,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 2000, base: 2 },
});
