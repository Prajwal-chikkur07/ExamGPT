import type {
  Conversation,
  Definition,
  DocumentMeta,
  ExamQuestionResult,
  Flashcard,
  ImportantQuestion,
  Message,
  SourceCitation,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------- Conversations ----------
export const conversationsApi = {
  list: () => http<Conversation[]>("/api/conversations"),
  create: (title?: string) =>
    http<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  get: (id: string) => http<Conversation>(`/api/conversations/${id}`),
  rename: (id: string, title: string) =>
    http<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  delete: (id: string) =>
    http<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  messages: (id: string) => http<Message[]>(`/api/conversations/${id}/messages`),
};

// ---------- Documents ----------
export const documentsApi = {
  list: () => http<DocumentMeta[]>("/api/documents"),
  delete: (id: string) =>
    http<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  /** Permanent upload — indexes into the global Notes Library. */
  upload: async (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const res = await fetch(`${API_URL}/api/documents/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { documents: DocumentMeta[]; indexed_chunks: number };
  },
  /** One-shot extract — used for chat attachments. Does NOT index or persist. */
  extract: async (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const res = await fetch(`${API_URL}/api/chat/extract`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as {
      files: { filename: string; text: string; pages?: number; error?: string }[];
    };
  },
};

// ---------- Chat ----------
export const chatApi = {
  ask: (conversationId: string, question: string, style: string) =>
    http<{ answer: string; sources: SourceCitation[]; conversation_id: string }>(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversationId,
          question,
          answer_style: style,
        }),
      }
    ),

  /** Streams tokens. Calls onToken for each token, onSources once, onDone at end. */
  stream: async (
    conversationId: string,
    question: string,
    style: string,
    handlers: {
      onSources?: (sources: SourceCitation[]) => void;
      onToken?: (text: string) => void;
      onDone?: () => void;
      onError?: (msg: string) => void;
      signal?: AbortSignal;
      regenerate?: boolean;
      inlineContext?: string;
      attachmentNames?: string[];
    }
  ) => {
    const res = await fetch(`${API_URL}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        question,
        answer_style: style,
        regenerate: handlers.regenerate ?? false,
        inline_context: handlers.inlineContext ?? null,
        attachment_names: handlers.attachmentNames ?? [],
      }),
      signal: handlers.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      handlers.onError?.(text || `${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const ev of events) {
        const lines = ev.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (event === "sources") handlers.onSources?.(parsed.sources ?? []);
          else if (event === "token") handlers.onToken?.(parsed.text ?? "");
          else if (event === "error") handlers.onError?.(parsed.message ?? "error");
          else if (event === "done") handlers.onDone?.();
        } catch {
          // ignore malformed event
        }
      }
    }
    handlers.onDone?.();
  },
};

// ---------- Exam ----------
export const examApi = {
  solve: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_URL}/api/exam/solve`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { questions: ExamQuestionResult[] };
  },
  answer: (topic: string, marks: number) =>
    http<{
      topic: string;
      marks: number;
      answer: string;
      confidence: number;
      sources: SourceCitation[];
    }>("/api/exam/answer", {
      method: "POST",
      body: JSON.stringify({ topic, marks }),
    }),
};

// ---------- Important Questions ----------
export const importantQuestionsApi = {
  generate: (
    kind: "predicted" | "unit_wise" | "repeated" | "viva",
    count = 10,
    unit?: string
  ) =>
    http<{ items: ImportantQuestion[] }>("/api/important-questions", {
      method: "POST",
      body: JSON.stringify({ kind, count, unit }),
    }),
};

// ---------- Revision ----------
export const revisionApi = {
  notes: (unit?: string) =>
    http<{ notes_markdown: string; definitions: Definition[] }>("/api/revision/notes", {
      method: "POST",
      body: JSON.stringify({ unit }),
    }),
  flashcards: (unit?: string) =>
    http<{ cards: Flashcard[] }>("/api/revision/flashcards", {
      method: "POST",
      body: JSON.stringify({ unit }),
    }),
};
