"use client";

import { Mic, Square, Trash2 } from "lucide-react";
import { formatDuration, type useVoiceRecorder } from "@/app/hooks/qa-visual/use-voice-recorder";

type Recorder = ReturnType<typeof useVoiceRecorder>;

/** Mic button, live recording bar and preview. The parent decides when to upload. */
export function VoiceRecorder({ recorder, disabled }: { recorder: Recorder; disabled?: boolean }) {
  if (!recorder.supported) return null;
  if (recorder.state === "recording")
    return (
      <div className="qa-recorder" role="status" aria-live="polite">
        <span className="qa-rec-dot" aria-hidden="true" />
        <span className="qa-rec-time">{formatDuration(recorder.elapsed)}</span>
        <span className="qa-rec-wave" aria-hidden="true">
          {recorder.levels.map((level, i) => (
            <i key={i} style={{ height: `${Math.round(level * 100)}%` }} />
          ))}
        </span>
        <button type="button" className="qa-icon-round" aria-label="Descartar grabación" onClick={recorder.discard}>
          <Trash2 size={15} />
        </button>
        <button type="button" className="qa-icon-round stop" aria-label="Detener y revisar" onClick={recorder.stop}>
          <Square size={14} />
        </button>
      </div>
    );
  if (recorder.state === "ready" && recorder.recording)
    return (
      <div className="qa-recorder">
        <audio src={recorder.recording.url} controls preload="metadata" style={{ flex: 1, height: 32 }} />
        <span className="qa-rec-time">{formatDuration(recorder.recording.durationMs)}</span>
        <button type="button" className="qa-icon-round" aria-label="Descartar audio" onClick={recorder.discard}>
          <Trash2 size={15} />
        </button>
      </div>
    );
  return (
    <button
      type="button"
      className="qa-icon-round"
      disabled={disabled}
      aria-label="Grabar un comentario de voz"
      title="Grabar un comentario de voz (hasta 3 minutos)"
      onClick={() => void recorder.start()}
    >
      <Mic size={15} />
    </button>
  );
}
