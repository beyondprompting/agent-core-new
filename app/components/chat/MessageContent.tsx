"use client";

import ReactMarkdown from "react-markdown";

// Tipos
type MessagePart = {
  type: "text" | "file";
  text?: string;
  url?: string;
  mediaType?: string;
  state?: string;
};

type ReasoningDetail = {
  type: "text";
  text: string;
};

type Message = {
  key: string;
  role: "user" | "assistant";
  content: string | MessagePart[];
  _creationTime: number;
  agentName?: string;
  status?: string;
  reasoning?: string;
  reasoningDetails?: ReasoningDetail[];
};

interface MessageContentProps {
  message: Message;
}

/**
 * Componente para renderizar el contenido de un mensaje
 * Soporta texto, imágenes, PDFs, audio y documentos Word
 */
export function MessageContent({ message }: MessageContentProps) {
  // Manejar contenido vacío
  if (!message.content) {
    return <div className="text-gray-400 italic">Sin contenido</div>;
  }

  // Si el contenido es un array (mensaje con partes)
  if (Array.isArray(message.content)) {
    // Detectar si el mensaje contiene contenido de Word
    const hasWordContent = message.content.some(
      (part) =>
        part.type === "text" &&
        part.text &&
        part.text.includes('--- Contenido extraído del documento "') &&
        part.text.includes("--- Fin del documento ---"),
    );

    return (
      <div className="space-y-2">
        {message.content.map((part, idx) => {
          if (part.type === "text" && part.text) {
            return (
              <TextPart
                key={idx}
                text={part.text}
                role={message.role}
                hasWordContent={hasWordContent}
              />
            );
          }
          if (part.type === "file" && part.url) {
            return (
              <FilePart
                key={idx}
                url={part.url}
                mediaType={part.mediaType}
                hasWordContent={hasWordContent}
              />
            );
          }
          return null;
        })}
      </div>
    );
  }

  // Si es un string (mensaje simple)
  const textContent =
    typeof message.content === "string" ? message.content : "";

  // Renderizar markdown para todos los mensajes (usuario y asistente)
  return <MarkdownRenderer content={textContent} role={message.role} />;
}

// Subcomponente para texto con markdown
interface TextPartProps {
  text: string;
  role: "user" | "assistant";
  hasWordContent: boolean;
}

function TextPart({ text, role, hasWordContent }: TextPartProps) {
  // Detectar si el texto contiene contenido extraído de Word
  const wordMarkerStart = '--- Contenido extraído del documento "';
  const wordMarkerEnd = "--- Fin del documento ---";
  const partHasWordContent =
    text.includes(wordMarkerStart) && text.includes(wordMarkerEnd);

  // Si es contenido de Word en mensaje de usuario, mostrar icono
  if (partHasWordContent && role === "user") {
    const parts = text.split(wordMarkerStart);
    const userText = parts[0].trim();
    const match = text.match(
      /--- Contenido extraído del documento "(.+?)" ---/,
    );
    const filename = match ? match[1] : "Documento Word";
    const isDocx = filename.toLowerCase().endsWith(".docx");

    return (
      <div className="space-y-2">
        {userText && <div className="whitespace-pre-wrap">{userText}</div>}
        <div className="bg-slate-100 rounded-lg p-2 flex items-center gap-2 border border-slate-200 hover:bg-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
          <span className="text-slate-500">📝</span>
          <span className="text-xs text-slate-600 truncate">
            {isDocx ? "Documento DOCX" : "Documento DOC"}
          </span>
        </div>
      </div>
    );
  }

  if (role === "assistant") {
    return <MarkdownRenderer content={text} role={role} />;
  }

  // Renderizar markdown también para mensajes del usuario
  return <MarkdownRenderer content={text} role={role} />;
}

// Subcomponente para archivos
interface FilePartProps {
  url: string;
  mediaType?: string;
  hasWordContent: boolean;
}

function FilePart({ url, mediaType, hasWordContent }: FilePartProps) {
  const filename = url.split("/").pop() || "";
  const isWordByFilename =
    filename.toLowerCase().endsWith(".docx") ||
    filename.toLowerCase().endsWith(".doc");
  const isWordByMediaType =
    mediaType?.includes("word") || mediaType?.includes("document");

  // No mostrar archivos Word individualmente
  if (isWordByFilename || isWordByMediaType) {
    return null;
  }

  // No mostrar imágenes si son del Word
  if (hasWordContent && mediaType?.startsWith("image/")) {
    return null;
  }

  // PDF
  if (mediaType === "application/pdf") {
    return (
      <div className="bg-slate-100 rounded-lg p-2 flex items-center gap-2 border border-slate-200 hover:bg-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
        <span className="text-slate-500">📄</span>
        <span className="text-xs text-slate-600 truncate">Archivo PDF</span>
      </div>
    );
  }

  // Audio
  if (mediaType === "audio/mpeg") {
    return (
      <div className="bg-slate-100 rounded-lg p-2 flex items-center gap-2 border border-slate-200 hover:bg-slate-200 hover:border-slate-300 transition-colors cursor-pointer">
        <span className="text-slate-500">🎧</span>
        <span className="text-xs text-slate-600 truncate">
          Archivo {mediaType || "audio"}
        </span>
      </div>
    );
  }

  // Imagen
  return (
    <img
      src={url}
      alt="Imagen adjunta"
      className="max-w-[140px] rounded-lg border border-gray-300"
    />
  );
}

// Componente reutilizable para renderizar Markdown
interface MarkdownRendererProps {
  content: string;
  role?: "user" | "assistant";
}

function MarkdownRenderer({
  content,
  role = "assistant",
}: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-bold">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-4 mb-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 mb-2">{children}</ol>
          ),
          li: ({ children }) => <li className="mb-1">{children}</li>,
          code: ({ children }) => (
            <code
              className={`px-1.5 py-0.5 rounded text-sm font-mono ${
                role === "user"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-muted text-foreground p-2 rounded overflow-x-auto mb-2 text-sm">
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export { MarkdownRenderer };
export type { Message, MessagePart, ReasoningDetail };
