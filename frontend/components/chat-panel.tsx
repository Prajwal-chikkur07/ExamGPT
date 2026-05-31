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
import type { ChatMessage, ImageAttachment, SourceCitation } from "@/lib/types";

const UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp";
const MAX_VARIANTS = 5;

interface Props {
  conversationId: string;
}

interface PaperHeader {
  marks: number | null;
  topic: string | null;
  type: string | null;
}

interface Turn {
  user: ChatMessage | null;
  assistants: ChatMessage[];
  /** Index of `assistants[0]` in the flat `messages` array (or -1). */
  firstAssistantIndex: number;
}

function detectHeader(question: string): PaperHeader {
  const q = question.toLowerCase();
  const marksMatches = Array.from(
    q.matchAll(/(\b|\[|\()\s*(\d{1,2})\s*[- ]?\s*(?:mark|marks|m)\b/g)
  )
    .map((m) => parseInt(m[2], 10))
    .filter((n) => n >= 1 && n <= 20);
  let marks: number | null = marksMatches.length ? Math.max(...marksMatches) : null;
  if (marks === null) {
    if (/\b(define|definition)\b/.test(q)) marks = 2;
    else if (/\b(essay|elaborate|in detail|with example|long)\b/.test(q)) marks = 10;
    else if (/\b(explain|describe|discuss)\b/.test(q)) marks = 5;
  }
  let type: string | null = null;
  if (/\b(mcq|multiple choice)\b/.test(q)) type = "MCQ";
  else if (/\b(compare|differentiate|vs|versus)\b/.test(q)) type = "Compare";
  else if (/\b(define|definition)\b/.test(q)) type = "Define";
  else if (/\b(algorithm|pseudocode|steps?)\b/.test(q)) type = "Algorithm";
  else if (/\b(numerical|solve|calculate|compute|find)\b/.test(q)) type = "Numerical";
  else if (/\b(diagram|draw|flowchart)\b/.test(q)) type = "Diagram";
  else if (/\b(explain|describe|discuss|elaborate)\b/.test(q)) type = "Explain";
  let topic: string | null = null;
  const topicMatch = q.match(
    /\b(dbms|ai|ml|os|dsa|cn|toc|coa|hci|sepm|se|java|python|c\+\+|sql|html|css|js|react|node)\b/i
  );
  if (topicMatch) topic = topicMatch[1].toUpperCase();
  return { marks, topic, type };
}

function isCasualQuestion(question: string): boolean {
  const q = (question ?? "").trim().toLowerCase().replace(/[?!.,]+$/, "");
  if (!q) return true;
  return /^(hi|hii|hey|hello|yo|thanks|thank you|thx|ok|okay|bye|good (morning|night|evening|afternoon))$/.test(q);
}

function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({
        filename: file.name,
        mime_type: file.type || "image/png",
        data: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

function TypingInk() {
  return (
    <div className="inline-flex items-center gap-1.5 py-1" aria-label="Thinking">
      <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "200ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-paper-muted/80 animate-ink-pulse" style={{ animationDelay: "400ms" }} />
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
    setPendingAttachments((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removePendingAttachment(index: number) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
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
      setStreaming(state.isStreaming);
      setStreamedContent(state.content);
      if (state.error) toast.error("Error", { description: state.error });
      if (!state.isStreaming && !state.error) {
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
              setStreamedContent("");
            })
            .catch(() => null),
        ]);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId, upsertConversation]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
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

    const attachments = pendingAttachments;
    const attachmentNames = attachments.map((f) => f.name);
    const userText =
      text ||
      (attachmentNames.length
        ? `Solve / analyze the attached ${attachmentNames.length === 1 ? "file" : "files"}.`
        : "");
    const previewUrls = attachments.map((f) =>
      f.type.startsWith("image/") ? URL.createObjectURL(f) : null
    );

    setPendingAttachments([]);
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userText,
        attachments: attachmentNames,
        attachmentPreviews: previewUrls,
      } as ChatMessage,
    ]);

    let inlineContext: string | undefined;
    let images: ImageAttachment[] = [];
    const imageFiles = attachments.filter((f) => f.type.startsWith("image/"));
    const extractFiles = attachments.filter((f) => !f.type.startsWith("image/"));

    if (attachments.length > 0) {
      setUploadingForMessage(true);
      setStreaming(true);
      setStreamedContent("");
      try {
        const [encodedImages, extraction] = await Promise.all([
          Promise.all(imageFiles.map(fileToImageAttachment)),
          extractFiles.length > 0 ? documentsApi.extract(extractFiles) : Promise.resolve(null),
        ]);
        images = encodedImages;
        if (extraction) {
          const parts: string[] = [];
          for (const f of extraction.files) {
            if (f.error) {
              toast.error(`Couldn't read ${f.filename}`, { description: f.error });
              continue;
            }
            if (f.text?.trim()) parts.push(`[Attached file: ${f.filename}]\n${f.text}`);
            else parts.push(`[Attached file: ${f.filename}] (no readable text)`);
          }
          inlineContext = parts.join("\n\n---\n\n") || undefined;
        }
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
      attachmentNames: attachmentNames.length ? attachmentNames : undefined,
      images: images.length ? images : undefined,
    });
  }

  function handleRegenerate(turn: Turn) {
    if (streaming) return;
    if (!turn.user) return;
    if (turn.assistants.length >= MAX_VARIANTS) {
      toast.info(`Limit reached — up to ${MAX_VARIANTS} variants per question.`);
      return;
    }
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
      <div className="px-3 md:px-6 pb-[max(env(safe-area-inset-bottom),14px)] pt-4 bg-paper border-t border-paper-border/50">
        <div className="max-w-3xl mx-auto">
          {pendingAttachments.length > 0 && (
            <AttachmentTray
              files={pendingAttachments}
              onRemove={removePendingAttachment}
              disabled={streaming || uploadingForMessage}
            />
          )}

          <div className="paper-pad px-2.5 py-2.5 flex items-end gap-2 focus-within:border-paper-accent/60 transition">
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
                placeholder={
                  pendingAttachments.length > 0
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
        <DialogContent className="bg-paper text-paper-foreground border-paper-border max-w-2xl">
          <DialogHeader>
            <DialogTitle
              className="text-paper-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Sources for: {sourcesDialog?.title}
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              These pages from your library contributed to this answer.
            </DialogDescription>
          </DialogHeader>
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
  const header = useMemo(() => detectHeader(question), [question]);
  const casual = isCasualQuestion(question);

  const totalAssistants = turn.assistants.length;
  const safeIdx = Math.min(Math.max(variantIndex, 0), Math.max(0, totalAssistants - 1));
  const activeAssistant = totalAssistants > 0 ? turn.assistants[safeIdx] : null;
  const assistantContent = streaming ? streamedContent : activeAssistant?.content ?? "";
  const assistantSources = (activeAssistant?.sources as SourceCitation[] | undefined) ?? [];

  /* ── Casual replies: keep light, single-column ── */
  if (casual && !streaming && turn.user) {
    return (
      <section className="animate-fade-in py-3 mb-2">
        <div className="text-[14px] text-paper-muted mb-1.5">
          <span className="text-paper-muted/70 mr-2">You:</span>
          {turn.user.content}
        </div>
        <div className="markdown text-paper-foreground">
          {assistantContent ? <Markdown>{assistantContent}</Markdown> : <TypingInk />}
        </div>
        {activeAssistant && (
          <MessageActions
            text={activeAssistant.content}
            feedback={feedback}
            onFeedback={setFeedback}
            onRegenerate={canRegenerate ? onRegenerate : undefined}
            canRegenerate={canRegenerate}
          />
        )}
        {showDivider && <SectionDivider />}
      </section>
    );
  }

  return (
    <section className="animate-fade-in mb-2">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8">
        {/* ─── Right column on desktop: question ─── */}
        <div className="md:col-span-4 md:order-2 md:sticky md:top-6 self-start">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {header.topic && <PaperBadge>{header.topic}</PaperBadge>}
            {header.type && <PaperBadge>{header.type}</PaperBadge>}
            {header.marks !== null && <PaperBadge accent>{header.marks} Marks</PaperBadge>}
          </div>
          {turn.user?.attachments && turn.user.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {turn.user.attachments.map((name, j) => {
                const preview = turn.user?.attachmentPreviews?.[j];
                if (preview) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${name}-${j}`}
                      src={preview}
                      alt={name}
                      title={name}
                      className="max-h-40 max-w-full rounded-md border border-paper-border object-contain"
                    />
                  );
                }
                return (
                  <div
                    key={`${name}-${j}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-paper-border/70 bg-paper-foreground/5 text-paper-foreground/85 px-2 py-1 text-xs"
                  >
                    <FileIcon className="h-3.5 w-3.5" />
                    <span className="max-w-[200px] truncate">{name}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <span
              className="text-paper-muted text-base mt-0.5 shrink-0"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Q.
            </span>
            <h2
              className="text-[15.5px] md:text-base leading-snug text-paper-foreground font-medium"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {question}
            </h2>
          </div>
        </div>

        {/* ─── Left column on desktop: answer ─── */}
        <div className="md:col-span-8 md:order-1 min-w-0">
          {/* Variant nav row */}
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

          <div className="markdown min-h-[2rem]">
            {assistantContent ? (
              <Markdown>{assistantContent}</Markdown>
            ) : streaming ? (
              uploadingForMessage ? (
                <div className="flex items-center gap-2 text-paper-muted text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading attachment…
                </div>
              ) : (
                <TypingInk />
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

      {showDivider && <SectionDivider />}
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
        <DropdownMenuItem onSelect={() => downloadPDF(content, title)}>
          <FileType2 className="h-3.5 w-3.5" />
          PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadWord(content, title)}>
          <FileType2 className="h-3.5 w-3.5" />
          Word (.doc)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadMarkdown(content, title)}>
          <Download className="h-3.5 w-3.5" />
          Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadText(content, title)}>
          <Download className="h-3.5 w-3.5" />
          Plain text (.txt)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function PaperBadge({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full",
        accent
          ? "bg-paper-accent/90 text-paper border border-paper-accent"
          : "bg-paper-foreground/8 text-paper-foreground/85 border border-paper-border/60"
      )}
    >
      {children}
    </span>
  );
}

function SectionDivider() {
  return (
    <div className="my-8 flex items-center gap-3 text-paper-muted/60" aria-hidden>
      <div className="flex-1 border-t border-dashed border-paper-border/70" />
      <span
        className="text-[10px] uppercase tracking-[0.22em]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        ✦
      </span>
      <div className="flex-1 border-t border-dashed border-paper-border/70" />
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
      {files.map((file, i) => {
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        return (
          <div
            key={`${file.name}-${i}`}
            className="relative inline-flex items-center gap-2 rounded-xl border border-paper-border bg-paper pr-2.5 pl-1.5 py-1.5"
          >
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
              onClick={() => onRemove(i)}
              disabled={disabled}
              aria-label={`Remove ${file.name}`}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-paper border border-paper-border hover:bg-destructive hover:text-destructive-foreground hover:border-destructive disabled:opacity-40 disabled:pointer-events-none"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
