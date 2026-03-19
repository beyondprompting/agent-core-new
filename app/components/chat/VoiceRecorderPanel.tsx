"use client";

interface VoiceRecorderPanelProps {
  isRecording: boolean;
  recordingTime: number;
  finalTranscript: string;
  interimTranscript: string;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onClearTranscript: () => void;
}

/**
 * Panel de grabación de voz con transcripción en tiempo real
 */
export function VoiceRecorderPanel({
  isRecording,
  recordingTime,
  finalTranscript,
  interimTranscript,
  onStopRecording,
  onCancelRecording,
  onClearTranscript,
}: VoiceRecorderPanelProps) {
  // Formatear tiempo de grabación
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* Indicador de grabación activa */}
      {isRecording && (
        <div className="mb-3 bg-red-50 px-4 py-3 rounded-lg border border-red-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-red-700 font-medium">
              Grabando: {formatTime(recordingTime)}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onCancelRecording}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onStopRecording}
                className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm font-medium"
              >
                Listo
              </button>
            </div>
          </div>
          {/* Transcripción en tiempo real */}
          {(finalTranscript || interimTranscript) && (
            <div className="mt-2 p-2 bg-white rounded border text-sm text-gray-700">
              <span>{finalTranscript}</span>
              <span className="text-gray-400 italic">{interimTranscript}</span>
            </div>
          )}
        </div>
      )}

      {/* Preview del texto transcrito (cuando no está grabando) */}
      {!isRecording && finalTranscript && (
        <div className="mb-3 bg-green-50 px-4 py-3 rounded-lg border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-green-600">🎤</span>
            <span className="text-sm text-green-700 font-medium">
              Mensaje de voz:
            </span>
            <button
              type="button"
              onClick={onClearTranscript}
              className="ml-auto text-red-500 hover:text-red-700 text-sm"
            >
              ✕ Eliminar
            </button>
          </div>
          <p className="text-sm text-gray-700">{finalTranscript}</p>
        </div>
      )}
    </>
  );
}
