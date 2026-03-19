"use client";

type ExtractedImage = {
  data: string;
  mimeType: string;
};

type FileInfo = {
  name: string;
  type: string;
  isImage: boolean;
  isDocument: boolean;
  isAudio: boolean;
  base64: string;
  extractedMarkdown?: string;
  extractedImages?: ExtractedImage[];
};

interface FilePreviewListProps {
  files: FileInfo[];
  onRemoveFile: (index: number) => void;
}

/**
 * Lista de previews de archivos seleccionados para subir
 */
export function FilePreviewList({ files, onRemoveFile }: FilePreviewListProps) {
  if (files.length === 0) return null;

  // Obtener icono según tipo de archivo
  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return "🖼️";
    if (type === "application/pdf") return "📄";
    if (type.includes("word") || type === "application/msword") return "📝";
    if (type.startsWith("audio/")) return "🎵";
    return "📎";
  };

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <div key={index} className="relative inline-block">
          {file.isImage ? (
            // Preview de imagen
            <img
              src={file.base64}
              alt={file.name}
              className="h-20 w-20 object-cover rounded-lg border border-gray-300"
            />
          ) : file.isAudio ? (
            // Preview de audio
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-300 h-20">
              <span className="text-2xl">🎵</span>
              <div className="flex flex-col max-w-[120px]">
                <span className="text-xs font-medium text-gray-700 truncate">
                  {file.name}
                </span>
                <span className="text-xs text-purple-600">Audio</span>
              </div>
            </div>
          ) : (
            // Preview de documento (PDF/Word)
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-300 h-20">
              <span className="text-2xl">{getFileIcon(file.type)}</span>
              <div className="flex flex-col max-w-[120px]">
                <span className="text-xs font-medium text-gray-700 truncate">
                  {file.name}
                </span>
                <span className="text-xs text-gray-500">
                  {file.type === "application/pdf"
                    ? "PDF"
                    : file.type.includes("word") ||
                        file.type === "application/msword"
                      ? "Word"
                      : "Documento"}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => onRemoveFile(index)}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600 text-xs"
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export type { FileInfo, ExtractedImage };
