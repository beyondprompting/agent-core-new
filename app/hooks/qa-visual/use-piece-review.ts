"use client";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function usePieceReview(
  pieceId: Id<"qaVisualPieces"> | undefined,
  version: number,
) {
  const data = useQuery(
    api.qaVisual.editor.piece,
    pieceId ? { pieceId, version } : "skip",
  );
  const create = useMutation(api.qaVisual.threads.create);
  const reply = useMutation(api.qaVisual.threads.reply);
  const resolve = useMutation(api.qaVisual.threads.setResolved);
  const decide = useMutation(api.qaVisual.decisions.decide);
  const edit = useMutation(api.qaVisual.threads.edit);
  const remove = useMutation(api.qaVisual.threads.remove);
  const linkOffer = useMutation(api.qaVisual.overrides.linkOffer);
  const uploadUrl = useMutation(api.qaVisual.audio.generateUploadUrl);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false);
  async function save<T>(
    operation: () => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    if (sending.current || !data) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      return { value: await operation() };
    } catch (error) {
      const details = error instanceof ConvexError ? error.data : null;
      setError(
        typeof details === "string"
          ? details
          : (details?.message ??
              "No se pudo guardar. Revisá la conexión e intentá nuevamente."),
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return {
    data,
    busy,
    error,
    setError,
    save,
    create,
    reply,
    resolve,
    decide,
    edit,
    remove,
    linkOffer,
    uploadUrl,
  };
}
