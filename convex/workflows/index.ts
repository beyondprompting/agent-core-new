// convex/workflows/index.ts
// Configuración del WorkflowManager para todos los workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../_generated/api";

/**
 * WorkflowManager centralizado para toda la aplicación
 * Proporciona:
 * - Reintentos automáticos configurables
 * - Durabilidad (sobrevive reinicios del servidor)
 * - Idempotencia (no duplica trabajo si se reintenta)
 * - Load balancing automático
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // Configuración por defecto para todos los workflows
    defaultRetryBehavior: {
      maxAttempts: 5,
      initialBackoffMs: 1000,
      base: 2, // Exponential backoff
    },
    retryActionsByDefault: true, // Reintentar actions por defecto
    maxParallelism: 10, // Máximo de steps en paralelo
  },
});
