"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 3 * 60 * 1000;
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export type Recording = { blob: Blob; mimeType: string; durationMs: number; url: string };

/**
 * Voice comments (§23.7): MediaRecorder with webm/opus or mp4 (Safari/iOS), live level bars,
 * automatic stop at 3:00 and a preview before sending. Nothing is uploaded until "send".
 */
export function useVoiceRecorder() {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "ready">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);

  const cleanupStream = useCallback(() => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const durationMs = Date.now() - started.current;
        const type = (rec.mimeType || mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        cleanupStream();
        setRecording({ blob, mimeType: type, durationMs, url: URL.createObjectURL(blob) });
        setState("ready");
      };
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const analyser = Ctx ? new Ctx() : null;
      audioCtx.current = analyser;
      const node = analyser?.createAnalyser();
      if (analyser && node) {
        node.fftSize = 64;
        analyser.createMediaStreamSource(media).connect(node);
      }
      const data = new Uint8Array(node?.frequencyBinCount ?? 0);
      started.current = Date.now();
      rec.start(250);
      recorder.current = rec;
      setRecording(null);
      setElapsed(0);
      setLevels([]);
      setState("recording");
      timer.current = window.setInterval(() => {
        const ms = Date.now() - started.current;
        setElapsed(ms);
        if (node) {
          node.getByteFrequencyData(data);
          const level = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length) / 255;
          setLevels((prev) => [...prev.slice(-39), Math.max(0.12, Math.min(1, level * 1.8))]);
        }
        if (ms >= MAX_MS) stop();
      }, 120);
    } catch (e) {
      cleanupStream();
      setState("idle");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "No hay permiso para usar el micrófono. Habilitalo en el navegador o escribí tu comentario."
          : "No se pudo acceder al micrófono. Podés escribir tu comentario.",
      );
    }
  }, [cleanupStream, stop]);

  const discard = useCallback(() => {
    if (recorder.current?.state === "recording") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    cleanupStream();
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setState("idle");
    setElapsed(0);
  }, [cleanupStream, recording]);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { supported, state, elapsed, levels, recording, error, start, stop, discard, maxMs: MAX_MS };
}

export const formatDuration = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Uploads a recording to Convex Storage and returns what the comment mutation expects. */
export async function uploadRecording(
  getUploadUrl: () => Promise<string>,
  recording: Recording,
) {
  const url = await getUploadUrl();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": recording.mimeType },
    body: recording.blob,
  });
  if (!response.ok) throw new Error("upload_failed");
  const { storageId } = (await response.json()) as { storageId: string };
  return { storageId, durationMs: recording.durationMs };
}
