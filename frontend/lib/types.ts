export interface DocumentMeta {
  id: string;
  filename: string;
  file_type: string;
  pages: number;
  chunks: number;
  created_at: string;
  status: string;
}

export interface SourceCitation {
  document_id: string;
  filename: string;
  page: number;
  snippet: string;
  score: number;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/** Persisted attachment metadata. Older rows may still be plain strings (just the
 *  filename); newer ones are objects, with `dataUrl` populated for images so the
 *  preview survives a page reload. */
export interface MessageAttachment {
  name: string;
  dataUrl?: string | null;
}

export type AttachmentRef = string | MessageAttachment;

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceCitation[];
  attachments?: AttachmentRef[];
  created_at: string;
}

/** Client-side message shape used by ChatPanel — covers both persisted messages
 *  and the optimistic, still-streaming assistant message. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: SourceCitation[];
  attachments?: AttachmentRef[];
}

export interface ExamQuestionResult {
  number: string | null;
  question: string;
  marks: number;
  answer: string;
  confidence: number;
  sources: SourceCitation[];
}

export interface ImportantQuestion {
  question: string;
  marks?: number | null;
  unit?: string | null;
  why?: string | null;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface Definition {
  term: string;
  definition: string;
}
