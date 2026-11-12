import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

// Import work only. Image preparation and analysis keep their existing runners.
export const importPool = new Workpool(components.qaVisualImportPool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 },
});
