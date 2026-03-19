// Barrel export para los componentes del chat
export { MessageContent, MarkdownRenderer } from "./MessageContent";
export type { Message, MessagePart, ReasoningDetail } from "./MessageContent";

export { VoiceRecorderPanel } from "./VoiceRecorderPanel";
export { FilePreviewList } from "./FilePreviewList";
export type { FileInfo, ExtractedImage } from "./FilePreviewList";

export { ChatMessageList, ChatMessage, ThinkingIndicator } from "./ChatMessageList";
export { ChatInputForm, FILE_ACCEPT, MAX_FILES } from "./ChatInputForm";

// Re-export tipos compartidos
export * from "./types";
