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

export interface ImageAttachment {
  filename: string;
  mime_type: string;
  data: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceCitation[];
  attachments?: string[];
  created_at: string;
}

/** Client-side message shape used by ChatPanel — covers both persisted messages
 *  and the optimistic, still-streaming assistant message. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: SourceCitation[];
  /** Filenames attached to this user turn (session-only, not persisted yet). */
  attachments?: string[];
  /** Per-attachment object-URLs for image previews; entries are null for non-images. */
  attachmentPreviews?: (string | null)[];
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
