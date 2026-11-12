"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { provider } from "./validators";
import { ensureImageCopies, ImageBusyError } from "./imagePreparation.node";
import { analyzeReview, type AnalysisResult } from "./worker";

export type JobResult =
  | AnalysisResult
  | { kind: "image"; retryable: boolean; message: string }
  | { kind: "skipped" };

/**
 * One attempt of qaVisualAnalysisPool (§10.2). It prepares the image when needed and runs a
 * single model attempt. Expected errors are returned so runner.onAttemptComplete decides.
 */
export const attempt = internalAction({
  args: { reviewId: v.id("qaVisualReviews"), provider },
  handler: async (ctx, { reviewId, provider }): Promise<JobResult> => {
    const job = await ctx.runQuery(internal.qaVisual.runner.jobContext, { reviewId });
    if (!job) return { kind: "skipped" };
    if (!job.imageReady) {
      try {
        const copyId = await ensureImageCopies(
          ctx,
          job.campaign,
          job.folderId,
          job.driveFileId,
          job.driveVersion,
        );
        await ctx.runMutation(internal.qaVisual.runner.attachCopy, { reviewId, copyId });
      } catch (error) {
        if (error instanceof ImageBusyError)
          return { kind: "image", retryable: true, message: "image_busy" };
        console.warn("QA Visual: no se pudo preparar la imagen para analizar", reviewId, error);
        const message = error instanceof Error ? error.message : "";
        return {
          kind: "image",
          retryable: !/supera el tamaño|compatible|cambió o ya no está/i.test(message),
          message: /cambió o ya no está/i.test(message)
            ? "La imagen cambió o ya no está en DESPLIEGUE. Actualizá desde Drive."
            : /supera el tamaño|compatible/i.test(message)
              ? "La imagen supera el tamaño admitido o no es un PNG/JPEG válido."
              : "No se pudo preparar la imagen.",
        };
      }
    }
    return analyzeReview(ctx, reviewId, provider);
  },
});
