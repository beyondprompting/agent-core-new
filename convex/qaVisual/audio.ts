import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { portalViewer, requireClientItem } from "./clientAccess";

/** Voice comments (§23.7): upload, single-use claim, playback access and transcription. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_MS = 3 * 60 * 1000 + 5_000;
const UPLOADS_PER_HOUR = 20;

export const audioArg = v.object({
  storageId: v.id("_storage"),
  durationMs: v.number(),
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await portalViewer(ctx);
    if (!viewer)
      throw new ConvexError({ code: "forbidden", message: "Iniciá sesión para grabar un audio." });
    const recent = await ctx.db
      .query("qaVisualUploads")
      .withIndex("by_user", (q) =>
        q.eq("userId", viewer.userId).gt("_creationTime", Date.now() - 3_600_000),
      )
      .take(UPLOADS_PER_HOUR);
    if (recent.length >= UPLOADS_PER_HOUR)
      throw new ConvexError({
        code: "rate_limited",
        message: "Llegaste al límite de audios por hora. Probá de nuevo más tarde o escribí tu comentario.",
      });
    return ctx.storage.generateUploadUrl();
  },
});

/** Validates an uploaded audio and attaches it to exactly one comment. */
export async function claimAudio(
  ctx: MutationCtx,
  userId: Id<"users">,
  audio: { storageId: Id<"_storage">; durationMs: number },
) {
  const meta = await ctx.db.system.get(audio.storageId);
  const mimeType = meta?.contentType ?? "";
  if (
    !meta ||
    !mimeType.startsWith("audio/") ||
    meta.size <= 0 ||
    meta.size > MAX_AUDIO_BYTES ||
    !Number.isFinite(audio.durationMs) ||
    audio.durationMs <= 0 ||
    audio.durationMs > MAX_AUDIO_MS
  )
    throw new ConvexError({
      code: "invalid_audio",
      message: "El audio no es válido. Puede durar hasta 3 minutos y pesar hasta 10 MB.",
    });
  const used = await ctx.db
    .query("qaVisualUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", audio.storageId))
    .first();
  if (used) throw new ConvexError({ code: "invalid_audio", message: "Este audio ya se usó." });
  const uploadId = await ctx.db.insert("qaVisualUploads", {
    storageId: audio.storageId,
    userId,
  });
  return {
    uploadId,
    clip: {
      storageId: audio.storageId,
      mimeType,
      durationMs: Math.round(audio.durationMs),
      bytes: meta.size,
    },
  };
}

/** Links the claim to its comment and queues the transcription. */
export async function attachAudio(
  ctx: MutationCtx,
  uploadId: Id<"qaVisualUploads">,
  commentId: Id<"qaVisualComments">,
) {
  await ctx.db.patch(uploadId, { commentId });
  await ctx.scheduler.runAfter(0, internal.qaVisual.voice.transcribe, { commentId });
}

/** Playback access: internal QA admins, or the client for client-visible comments of its campaign. */
export const audioMedia = internalQuery({
  args: { commentId: v.string() },
  handler: async (ctx, { commentId }) => {
    const id = ctx.db.normalizeId("qaVisualComments", commentId);
    const comment = id && (await ctx.db.get(id));
    if (!comment?.audio || comment.deletedAt) return null;
    const viewer = await portalViewer(ctx);
    if (!viewer) return null;
    if (viewer.mode === "client") {
      const thread = await ctx.db.get(comment.threadId);
      if (
        thread?.audience !== "client" ||
        comment.visibility !== "client" ||
        !thread.deliveryItemId
      )
        return null;
      try {
        await requireClientItem(ctx, thread.deliveryItemId);
      } catch {
        return null;
      }
    }
    return { storageId: comment.audio.storageId, mimeType: comment.audio.mimeType };
  },
});

export const transcriptionSource = internalQuery({
  args: { commentId: v.id("qaVisualComments") },
  handler: async (ctx, { commentId }) => {
    const comment = await ctx.db.get(commentId);
    return comment?.audio && !comment.deletedAt ? comment.audio : null;
  },
});

export const saveTranscript = internalMutation({
  args: {
    commentId: v.id("qaVisualComments"),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { commentId, text }) => {
    const comment = await ctx.db.get(commentId);
    if (!comment) return;
    const clean = text?.trim().slice(0, 8000);
    await ctx.db.patch(commentId, {
      transcript: clean ? { status: "done", text: clean } : { status: "failed" },
    });
  },
});
