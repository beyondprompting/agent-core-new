"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useTaskMedia, useTaskMediaSource } from "./TaskMediaContext";
import { isImageFile, trelloAttachmentId, type TaskMediaFile } from "./taskMedia";

function StoredImage({ file, alt }: { file: TaskMediaFile; alt: string }) {
  const { source, failed, setFailed } = useTaskMediaSource(file);
  return source && !failed ? <a href={source} download={file.filename} target="_blank" rel="noopener noreferrer" className="my-3 block"><img src={source} alt={alt} onError={() => setFailed(true)} loading="lazy" className="max-h-80 max-w-full rounded-lg object-contain" /></a> : <span className="my-3 block rounded border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{failed ? `Imagen no disponible: ${alt}` : "Cargando imagen…"}</span>;
}
function CommentImage({ source, alt }: { source: string; alt: string }) {
  const { find, loading } = useTaskMedia();
  const file = find(source);
  const [failed, setFailed] = useState(false);
  if (file) return <StoredImage file={file} alt={alt || file.filename} />;
  if (trelloAttachmentId(source)) return <span className="my-3 block text-xs text-muted-foreground">{loading ? "Cargando imagen…" : `Imagen no disponible: ${alt}`}</span>;
  return failed ? <span className="block text-xs text-muted-foreground">Imagen no disponible: {alt}</span> : <img src={source} alt={alt} onError={() => setFailed(true)} loading="lazy" className="my-3 max-h-80 max-w-full rounded-lg object-contain" />;
}
function CommentAttachmentLink({ file, children }: { file: TaskMediaFile; children: React.ReactNode }) {
  const { resolve } = useTaskMedia();
  const [error, setError] = useState(false);
  if (isImageFile(file)) return <StoredImage file={file} alt={file.filename} />;
  return <><button type="button" className="text-left text-primary underline" onClick={async () => { const url = await resolve(file); if (!url) { setError(true); return; } const a = document.createElement("a"); a.href = url; a.download = file.filename; a.target = "_blank"; a.rel = "noopener noreferrer"; a.click(); }}>{children}</button>{error && <span className="ml-2 text-xs text-muted-foreground">Archivo no disponible</span>}</>;
}
export function TaskCommentBody({ text }: { text: string }) {
  const { find } = useTaskMedia();
  return <div className="mt-3 break-words text-sm leading-relaxed [&_p]:whitespace-pre-wrap [&_a]:text-primary [&_a]:underline"><ReactMarkdown skipHtml components={{
    img: ({ src, alt }) => <CommentImage source={typeof src === "string" ? src : ""} alt={alt ?? "Imagen adjunta"} />,
    a: ({ children, href }) => { const file = href ? find(href) : undefined; return file ? <CommentAttachmentLink file={file}>{children}</CommentAttachmentLink> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>; },
  }}>{text}</ReactMarkdown></div>;
}
