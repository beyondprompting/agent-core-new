"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatDuration } from "@/app/hooks/qa-visual/use-voice-recorder";

/** Plays a voice comment through the authenticated media route and shows its transcript. */
export function AudioMessage({
  src,
  durationMs,
  transcript,
}: {
  src: string;
  durationMs: number;
  transcript?: { status: "pending" | "done" | "failed"; text?: string } | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  return (
    <div>
      <div className="qa-audio">
        <button
          type="button"
          className="qa-audio-play"
          aria-label={playing ? "Pausar audio" : "Reproducir audio"}
          onClick={(e) => {
            e.stopPropagation();
            const el = audio.current;
            if (!el) return;
            if (el.paused) void el.play();
            else el.pause();
          }}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="qa-audio-track" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </span>
        <span className="qa-audio-time">{formatDuration(durationMs)}</span>
        <audio
          ref={audio}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) =>
            setProgress(
              e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0,
            )
          }
        />
      </div>
      {transcript && (
        <p className="qa-transcript">
          <b>Transcripción</b>
          {transcript.status === "done"
            ? transcript.text
            : transcript.status === "pending"
              ? "Transcribiendo…"
              : "No se pudo transcribir este audio."}
        </p>
      )}
    </div>
  );
}
