"use node";

import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

/**
 * Transcribes a voice comment with the Azure integration already used by the app
 * (convex/lib/speechToText.ts). A failure keeps the audio and marks the transcript as failed.
 */
export const transcribe = internalAction({
  args: { commentId: v.id("qaVisualComments") },
  handler: async (ctx, { commentId }): Promise<void> => {
    const audio = await ctx.runQuery(internal.qaVisual.audio.transcriptionSource, {
      commentId,
    });
    if (!audio) return;
    try {
      const blob = await ctx.storage.get(audio.storageId);
      if (!blob) throw new Error("audio_missing");
      const mimeType = audio.mimeType.split(";")[0] || "audio/webm";
      const audioBase64 = `data:${mimeType};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
      const result =
        audio.durationMs > 55_000
          ? await ctx.runAction(api.lib.speechToText.transcribeLongAudio, { audioBase64 })
          : await ctx.runAction(api.lib.speechToText.transcribeAudio, { audioBase64 });
      await ctx.runMutation(internal.qaVisual.audio.saveTranscript, {
        commentId,
        ...(result.success && result.text ? { text: result.text } : {}),
      });
    } catch (error) {
      console.warn("QA Visual: no se pudo transcribir el audio", commentId, error);
      await ctx.runMutation(internal.qaVisual.audio.saveTranscript, { commentId });
    }
  },
});
