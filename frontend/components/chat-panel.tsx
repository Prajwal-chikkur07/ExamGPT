"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  FileText,
  FileType2,
  Loader2,
  MoreHorizontal,
  PenLine,
  Plus,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { MessageActions } from "@/components/message-actions";
import { SourceList } from "@/components/source-citation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { conversationsApi, documentsApi } from "@/lib/api";
import { chatStreams } from "@/lib/chat-streams";
import { downloadMarkdown, downloadPDF, downloadText, downloadWord } from "@/lib/download";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AttachmentRef, ChatMessage, MessageAttachment, SourceCitation } from "@/lib/types";

function asAttachment(ref: AttachmentRef): MessageAttachment {
  return typeof ref === "string" ? { name: ref } : ref;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

const UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp";
const UPLOAD_ACCEPT_EXTS = UPLOAD_ACCEPT.split(",").map((s) => s.trim().toLowerCase());
const MAX_VARIANTS = 5;

function isAcceptedFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const lower = file.name.toLowerCase();
  return UPLOAD_ACCEPT_EXTS.some((ext) => lower.endsWith(ext));
}

interface Props {
  conversationId: string;
}

interface Turn {
  user: ChatMessage | null;
  assistants: ChatMessage[];
  /** Index of `assistants[0]` in the flat `messages` array (or -1). */
  firstAssistantIndex: number;
}

/** Status messages shown while the assistant works, tailored to the question.
 * The first is always the retrieval step; later ones reflect the kind of task. */
function thinkingPhrases(question: string): string[] {
  const s = question.toLowerCase();
  const base = "Searching your notes…";
  if (/\b(solve|answer|marks?|question paper|q\d|problem|numerical)\b/.test(s))
    return [base, "Working through it…", "Writing your answer…"];
  if (/\b(note|notes|summar|revision|revise|flashcard|one[- ]?page)\b/.test(s))
    return [base, "Organizing the key points…", "Drafting your notes…"];
  if (/\b(important|probable|expected|predict|likely)\b/.test(s))
    return [base, "Spotting likely questions…", "Preparing the list…"];
  if (/\b(explain|what|why|how|describe|define|difference|compare|list|types?)\b/.test(s))
    return [base, "Thinking…", "Writing the explanation…"];
  return [base, "Thinking…", "Writing…"];
}

function TypingInk({ question = "" }: { question?: string }) {
  const phrases = useMemo(() => thinkingPhrases(question), [question]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (phrases.length <= 1) return;
    // Advance through the phrases, then hold on the last one until tokens arrive.
    const id = setInterval(() => {
      setIdx((prev) => (prev < phrases.length - 1 ? prev + 1 : prev));
    }, 1800);
    return () => clearInterval(id);
  }, [phrases]);

  return (
    <div
      className="inline-flex items-center gap-2 py-1 text-paper-muted"
      aria-label="Thinking"
      aria-live="polite"
    >
      <span className="text-sm italic" style={{ fontFamily: "var(--font-serif)" }}>
        {phrases[idx]}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "200ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "400ms" }} />
      </span>
    </div>
  );
}

export function ChatPanel({ conversationId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamedContent, setStreamedContent] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [uploadingForMessage, setUploadingForMessage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const [feedback, setFeedback] = useState<Record<number, "like" | "dislike" | null>>({});
  /** Currently-visible variant index PER TURN, keyed by firstAssistantIndex. */
  const [variantIndex, setVariantIndex] = useState<Record<number, number>>({});
  /** Sources dialog state */
  const [sourcesDialog, setSourcesDialog] = useState<{ sources: SourceCitation[]; title: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Set when the user initiates a send/regenerate: forces a scroll-to-bottom on
  // the next layout pass regardless of current scroll position.
  const forceScrollRef = useRef(false);
  const upsertConversation = useAppStore((s) => s.upsertConversation);

  /** Group messages into turns. Consecutive assistant messages after a user msg
   *  become variants of that turn. */
  const turns = useMemo<Turn[]>(() => {
    const out: Turn[] = [];
    let i = 0;
    while (i < messages.length) {
      const m = messages[i];
      if (m.role === "user") {
        const turn: Turn = { user: m, assistants: [], firstAssistantIndex: -1 };
        let j = i + 1;
        while (j < messages.length && messages[j].role === "assistant") {
          if (turn.firstAssistantIndex === -1) turn.firstAssistantIndex = j;
          turn.assistants.push(messages[j]);
          j++;
        }
        out.push(turn);
        i = j;
      } else {
        // Orphan assistant message at start
        out.push({ user: null, assistants: [m], firstAssistantIndex: i });
        i++;
      }
    }
    return out;
  }, [messages]);

  function addPendingAttachments(files: File[]) {
    if (!files.length) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      if (isAcceptedFile(f)) accepted.push(f);
      else rejected.push(f.name);
    }
    if (rejected.length) {
      toast.error(
        `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"}`,
        { description: rejected.join(", ") }
      );
    }
    if (!accepted.length) return;
    setPendingAttachments((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removePendingAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (streaming || uploadingForMessage) return;
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      // Pasted images often arrive as "image.png" — keep clipboard-pasted
      // images, but don't block normal text paste.
      e.preventDefault();
      addPendingAttachments(files);
    }
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (streaming || uploadingForMessage) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (streaming || uploadingForMessage) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (streaming || uploadingForMessage) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) addPendingAttachments(files);
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    setMessages([]);
    setFeedback({});
    setVariantIndex({});
    setStreamedContent("");

    const initial = chatStreams.getState(conversationId);
    setStreaming(initial?.isStreaming ?? false);
    setStreamedContent(initial?.content ?? "");

    conversationsApi
      .messages(conversationId)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(
          msgs.map((m) => ({
            role: m.role,
            content: m.content,
            sources: m.sources ?? [],
            attachments: m.attachments ?? [],
          }))
        );
      })
      .catch((err) => {
        if (!cancelled) toast.error("Failed to load history", { description: String(err) });
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    const unsubscribe = chatStreams.subscribe(conversationId, (state) => {
      if (cancelled) return;
      if (state.error) {
        toast.error("Error", { description: state.error });
        setStreaming(false);
        setStreamedContent("");
        return;
      }
      if (state.isStreaming) {
        setStreaming(true);
        setStreamedContent(state.content);
        return;
      }
      // Stream finished. Keep showing the streamed text (streaming stays true)
      // until the persisted message has loaded, then swap both off in the same
      // commit — otherwise the answer briefly disappears and the page jumps.
      setStreamedContent(state.content);
      Promise.all([
        conversationsApi.get(conversationId).then(upsertConversation).catch(() => null),
        conversationsApi
          .messages(conversationId)
          .then((msgs) => {
            if (cancelled) return;
            setMessages(
              msgs.map((m) => ({
                role: m.role,
                content: m.content,
                sources: m.sources ?? [],
                attachments: m.attachments ?? [],
              }))
            );
          })
          .catch(() => null),
      ]).finally(() => {
        if (cancelled) return;
        setStreaming(false);
        setStreamedContent("");
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId, upsertConversation]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Force a jump when the user just sent/regenerated (so their new message is
    // always brought into view). Otherwise only follow the stream if they're
    // already near the bottom, so we don't yank a user who scrolled up to read.
    // Coalesce writes via rAF so streaming tokens don't trigger a reflow each.
    const force = forceScrollRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!force && !nearBottom) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      forceScrollRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streamedContent, streaming]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  async function handleSend() {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || streaming || uploadingForMessage) return;

    const files = pendingAttachments;
    const userText =
      text ||
      (files.length
        ? `Solve / analyze the attached ${files.length === 1 ? "file" : "files"}.`
        : "");

    // Build rich attachment metadata. Images carry a data URL so the preview
    // survives a page refresh — non-images carry just the name.
    const richAttachments: MessageAttachment[] = await Promise.all(
      files.map(async (f) => {
        if (f.type.startsWith("image/")) {
          try {
            return { name: f.name, dataUrl: await fileToDataUrl(f) };
          } catch {
            return { name: f.name };
          }
        }
        return { name: f.name };
      })
    );

    setPendingAttachments([]);
    setInput("");
    forceScrollRef.current = true;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userText,
        attachments: richAttachments,
      } as ChatMessage,
    ]);

    let inlineContext: string | undefined;
    if (files.length > 0) {
      setUploadingForMessage(true);
      setStreaming(true);
      setStreamedContent("");
      try {
        const result = await documentsApi.extract(files);
        const parts: string[] = [];
        for (const f of result.files) {
          if (f.error) {
            toast.error(`Couldn't read ${f.filename}`, { description: f.error });
            continue;
          }
          if (f.text?.trim()) parts.push(`[Attached file: ${f.filename}]\n${f.text}`);
          else parts.push(`[Attached file: ${f.filename}] (no readable text)`);
        }
        inlineContext = parts.join("\n\n---\n\n");
      } catch (err) {
        toast.error("Couldn't read attachments", { description: String(err) });
        setUploadingForMessage(false);
        setStreaming(false);
        return;
      } finally {
        setUploadingForMessage(false);
      }
    }

    setStreamedContent("");
    setStreaming(true);
    chatStreams.start({
      conversationId,
      question: userText,
      style: "detailed",
      regenerate: false,
      inlineContext,
      attachments: richAttachments.length ? richAttachments : undefined,
    });
  }

  function handleRegenerate(turn: Turn) {
    if (streaming) return;
    if (!turn.user) return;
    if (turn.assistants.length >= MAX_VARIANTS) {
      toast.info(`Limit reached — up to ${MAX_VARIANTS} variants per question.`);
      return;
    }
    forceScrollRef.current = true;
    setStreamedContent("");
    setStreaming(true);
    chatStreams.start({
      conversationId,
      question: turn.user.content,
      style: "detailed",
      regenerate: true,
    });
  }

  function stopStreaming() {
    chatStreams.abort(conversationId);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const sendDisabled =
    streaming || uploadingForMessage || (!input.trim() && pendingAttachments.length === 0);

  // The active stream is rendered as the *next* assistant on the latest user turn.
  const showStreamingOnLast = streaming && turns.length > 0;
  const lastTurn = turns[turns.length - 1];

  return (
    <div className="flex flex-col h-full min-h-0 bg-paper">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto paper-surface">
        <div className="max-w-6xl mx-auto px-5 md:px-20 py-6 md:py-10">
          {loadingHistory ? (
            <div className="text-center py-16 text-paper-muted text-sm flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : turns.length === 0 ? (
            <BlankPageHint />
          ) : (
            <>
              {turns.map((turn, idx) => {
                const isLastTurn = idx === turns.length - 1;
                const activeStreamForThisTurn =
                  showStreamingOnLast && isLastTurn && lastTurn === turn;
                return (
                  <TurnBlock
                    key={turn.firstAssistantIndex >= 0 ? turn.firstAssistantIndex : `u-${idx}`}
                    turn={turn}
                    showDivider={!isLastTurn}
                    variantIndex={
                      turn.firstAssistantIndex >= 0
                        ? variantIndex[turn.firstAssistantIndex] ?? (turn.assistants.length - 1)
                        : 0
                    }
                    setVariantIndex={(next) => {
                      if (turn.firstAssistantIndex >= 0)
                        setVariantIndex((p) => ({ ...p, [turn.firstAssistantIndex]: next }));
                    }}
                    streaming={activeStreamForThisTurn}
                    streamedContent={activeStreamForThisTurn ? streamedContent : ""}
                    uploadingForMessage={activeStreamForThisTurn && uploadingForMessage}
                    feedback={feedback[turn.firstAssistantIndex] ?? null}
                    setFeedback={(next) =>
                      setFeedback((p) => ({ ...p, [turn.firstAssistantIndex]: next }))
                    }
                    onRegenerate={() => handleRegenerate(turn)}
                    canRegenerate={isLastTurn && !streaming && turn.assistants.length < MAX_VARIANTS}
                    onViewSources={(sources, title) =>
                      setSourcesDialog({ sources, title })
                    }
                  />
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Composer */}
      <div
        className="px-3 md:px-6 pb-[max(env(safe-area-inset-bottom),14px)] pt-4 bg-paper border-t border-paper-border/50"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="max-w-3xl mx-auto">
          {pendingAttachments.length > 0 && (
            <AttachmentTray
              files={pendingAttachments}
              onRemove={removePendingAttachment}
              disabled={streaming || uploadingForMessage}
            />
          )}

          <div
            className={cn(
              "paper-pad px-2.5 py-2.5 flex items-end gap-2 focus-within:border-paper-accent/60 transition",
              isDragging && "ring-2 ring-paper-accent/70 ring-offset-2 ring-offset-paper border-paper-accent"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => addPendingAttachments(Array.from(e.target.files ?? []))}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || uploadingForMessage}
              title="Attach for this question"
              className="h-10 w-10 inline-flex items-center justify-center rounded-md text-paper-muted hover:bg-paper-foreground/8 hover:text-paper-foreground transition disabled:opacity-40 disabled:pointer-events-none shrink-0"
            >
              <Plus className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <PenLine className="h-4 w-4 text-paper-muted/70 shrink-0 hidden sm:block" />
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={handlePaste}
                placeholder={
                  isDragging
                    ? "Drop image or file to attach…"
                    : pendingAttachments.length > 0
                      ? "Ask about the attached file…"
                      : "Write your next question…"
                }
                disabled={streaming || uploadingForMessage}
                className={cn(
                  "flex-1 min-h-[40px] max-h-[200px] resize-none bg-transparent",
                  "px-1 py-2.5 text-[15px] leading-relaxed text-paper-foreground",
                  "placeholder:text-paper-muted/70 focus:outline-none",
                  "disabled:opacity-60"
                )}
                style={{ fontFamily: "var(--font-sans)" }}
              />
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                title="Stop"
                className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-paper-foreground text-paper hover:opacity-90 transition shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                title="Send"
                className={cn(
                  "h-10 w-10 inline-flex items-center justify-center rounded-md transition shrink-0",
                  sendDisabled
                    ? "bg-paper-foreground/10 text-paper-muted"
                    : "bg-paper-foreground text-paper hover:bg-paper-accent hover:text-paper-foreground"
                )}
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
          <div
            className="text-[10.5px] text-paper-muted/70 text-center mt-3 tracking-[0.18em] uppercase"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Verify before your exam · Grounded in your uploads
          </div>
        </div>
      </div>

      {/* Sources dialog */}
      <Dialog open={!!sourcesDialog} onOpenChange={(o) => !o && setSourcesDialog(null)}>
        <DialogContent className="bg-paper text-paper-foreground border-paper-border max-w-2xl max-h-[80vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle
              className="text-paper-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Sources
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              These pages from your library contributed to this answer.
            </DialogDescription>
          </DialogHeader>
          {sourcesDialog?.title && (
            <p className="-mt-1 text-sm text-paper-foreground/70 line-clamp-2 break-words">
              {sourcesDialog.title}
            </p>
          )}
          {sourcesDialog && sourcesDialog.sources.length > 0 ? (
            <SourceList sources={sourcesDialog.sources} />
          ) : (
            <div className="text-sm text-paper-muted py-4">
              No sources recorded for this answer (it may have used only an attachment or general knowledge).
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────── TurnBlock — two-column Q/A ───────────────────── */

function TurnBlock({
  turn,
  showDivider,
  variantIndex,
  setVariantIndex,
  streaming,
  streamedContent,
  uploadingForMessage,
  feedback,
  setFeedback,
  onRegenerate,
  canRegenerate,
  onViewSources,
}: {
  turn: Turn;
  showDivider: boolean;
  variantIndex: number;
  setVariantIndex: (n: number) => void;
  streaming: boolean;
  streamedContent: string;
  uploadingForMessage: boolean;
  feedback: "like" | "dislike" | null;
  setFeedback: (next: "like" | "dislike" | null) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  onViewSources: (sources: SourceCitation[], title: string) => void;
}) {
  const question = turn.user?.content ?? "";
  const totalAssistants = turn.assistants.length;
  const safeIdx = Math.min(Math.max(variantIndex, 0), Math.max(0, totalAssistants - 1));
  const activeAssistant = totalAssistants > 0 ? turn.assistants[safeIdx] : null;
  const assistantContent = streaming ? streamedContent : activeAssistant?.content ?? "";
  const assistantSources = (activeAssistant?.sources as SourceCitation[] | undefined) ?? [];

  const userAttachments = (turn.user?.attachments ?? []).map(asAttachment);

  return (
    <section className="animate-fade-in mb-8">
      {turn.user && (userAttachments.length > 0 || turn.user.content) && (
        <div className="mb-4 flex justify-end">
          <div className="max-w-[82%] md:max-w-[70%] rounded-2xl bg-paper-foreground text-paper px-4 py-3 shadow-sm space-y-3">
            {userAttachments.length > 0 && (
              <UserAttachmentsBlock attachments={userAttachments} />
            )}
            {turn.user.content && (
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                {turn.user.content}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-start">
        <div className="w-full max-w-3xl min-w-0">
          {totalAssistants > 1 && !streaming && (
            <div className="flex items-center gap-1 mb-2 text-paper-muted">
              <button
                type="button"
                onClick={() => setVariantIndex(Math.max(0, safeIdx - 1))}
                disabled={safeIdx === 0}
                aria-label="Previous variant"
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-paper-foreground/8 disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span
                className="text-[11.5px] tabular-nums"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {safeIdx + 1} / {totalAssistants}
              </span>
              <button
                type="button"
                onClick={() => setVariantIndex(Math.min(totalAssistants - 1, safeIdx + 1))}
                disabled={safeIdx >= totalAssistants - 1}
                aria-label="Next variant"
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-paper-foreground/8 disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="markdown min-h-[2rem] text-paper-foreground">
            {assistantContent ? (
              <Markdown>{assistantContent}</Markdown>
            ) : streaming ? (
              uploadingForMessage ? (
                <div className="flex items-center gap-2 text-paper-muted text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading attachment…
                </div>
              ) : (
                <TypingInk question={question} />
              )
            ) : null}
          </div>

          {/* Action row */}
          {activeAssistant && !streaming && (
            <div className="mt-2 flex items-center gap-0.5">
              <MessageActions
                text={activeAssistant.content}
                feedback={feedback}
                onFeedback={setFeedback}
                onRegenerate={canRegenerate ? onRegenerate : undefined}
                canRegenerate={canRegenerate}
              />
              <OverflowMenu
                content={activeAssistant.content}
                sources={assistantSources}
                title={question}
                onViewSources={() => onViewSources(assistantSources, question)}
              />
            </div>
          )}
        </div>
      </div>

      {showDivider && <div className="my-8 border-t border-paper-border/60" />}
    </section>
  );
}

/* ───────────────────── Overflow (3-dot) menu ───────────────────── */

function OverflowMenu({
  content,
  sources,
  title,
  onViewSources,
}: {
  content: string;
  sources: SourceCitation[];
  title: string;
  onViewSources: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-paper-muted hover:bg-paper-foreground/8 hover:text-paper-foreground transition"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onViewSources}>
          <FileText className="h-3.5 w-3.5" />
          <span>View sources</span>
          <span className="ml-auto text-[10px] text-paper-muted">{sources.length}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Download as</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            // Defer past Radix's focus-return so the iframe/print and blob-click
            // run with the document in a stable state.
            e.preventDefault();
            setTimeout(() => downloadPDF(content, title), 0);
          }}
        >
          <FileType2 className="h-3.5 w-3.5" />
          PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimeout(() => downloadWord(content, title), 0);
          }}
        >
          <FileType2 className="h-3.5 w-3.5" />
          Word (.doc)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimeout(() => downloadMarkdown(content, title), 0);
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setTimeout(() => downloadText(content, title), 0);
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Plain text (.txt)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ───────────────────── User attachments (grouped) ───────────────────── */

function UserAttachmentsBlock({ attachments }: { attachments: MessageAttachment[] }) {
  const images = attachments.filter((a) => a.dataUrl);
  const files = attachments.filter((a) => !a.dataUrl);

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-1.5 rounded-lg overflow-hidden",
            images.length === 1
              ? "grid-cols-1"
              : images.length === 2
                ? "grid-cols-2"
                : "grid-cols-2 sm:grid-cols-3"
          )}
        >
          {images.map((a, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${a.name}-${i}`}
              src={a.dataUrl ?? ""}
              alt={a.name}
              title={a.name}
              className={cn(
                "w-full object-cover bg-paper/10 rounded-md",
                images.length === 1 ? "max-h-72" : "h-32 sm:h-36"
              )}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-paper/20 bg-paper/10 text-paper px-2 py-1 text-xs"
            >
              <FileIcon className="h-3.5 w-3.5" />
              <span className="max-w-[200px] truncate">{a.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────── Small helpers ───────────────────── */

function BlankPageHint() {
  return (
    <div className="px-2 md:px-4 py-10 md:py-14 text-center animate-fade-in">
      <div className="text-[10.5px] tracking-[0.22em] uppercase text-paper-muted/80 mb-3">
        New Answer Sheet
      </div>
      <h1
        className="text-2xl md:text-3xl text-paper-foreground mb-3 leading-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Write your first question
      </h1>
      <p className="text-sm text-paper-muted max-w-md mx-auto leading-relaxed">
        Mention the marks for the format you want — like
        <span className="font-medium text-paper-foreground"> “Define normalization [2M]”</span>{" "}
        or{" "}
        <span className="font-medium text-paper-foreground">
          “Explain B+ tree with example [10 marks]”
        </span>
        . Attach a question paper with the + below.
      </p>
    </div>
  );
}

function AttachmentTray({
  files,
  onRemove,
  disabled,
}: {
  files: File[];
  onRemove: (i: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-2 px-1">
      {files.map((file, i) => (
        <AttachmentChip
          key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
          file={file}
          onRemove={() => onRemove(i)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function AttachmentChip({
  file,
  onRemove,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  disabled?: boolean;
}) {
  // Create the blob URL once per file and revoke it on unmount. Doing this
  // inline in the render path leaks a fresh URL on every keystroke / stream
  // tick, which freezes the browser after a minute or two.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative inline-flex items-center gap-2 rounded-xl border border-paper-border bg-paper pr-2.5 pl-1.5 py-1.5">
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={file.name} className="h-10 w-10 rounded-md object-cover" />
      ) : (
        <div className="h-10 w-10 rounded-md bg-paper-accent/20 flex items-center justify-center">
          <FileIcon className="h-4 w-4 text-paper-accent" />
        </div>
      )}
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="text-xs font-medium truncate max-w-[160px] text-paper-foreground">
          {file.name}
        </span>
        <span className="text-[10px] text-paper-muted">
          {(file.size / 1024).toFixed(0)} KB · for this question
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-paper border border-paper-border hover:bg-destructive hover:text-destructive-foreground hover:border-destructive disabled:opacity-40 disabled:pointer-events-none"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
