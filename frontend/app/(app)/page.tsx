"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookMarked, Loader2, PenLine, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { conversationsApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const STARTERS = [
  { label: "Define normalization", hint: "2-mark answer" },
  { label: "Explain BFS with example", hint: "5-mark answer" },
  { label: "Compare TCP vs UDP", hint: "Table format" },
  { label: "Essay on AI agents", hint: "10-mark answer" },
];

export default function HomePage() {
  const router = useRouter();
  const { setConversations, upsertConversation } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await conversationsApi.list();
        if (cancelled) return;
        setConversations(data);
      } catch (err) {
        if (!cancelled) toast.error("Failed to load chats", { description: String(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setConversations]);

  async function startChat() {
    setCreating(true);
    try {
      const conv = await conversationsApi.create();
      upsertConversation(conv);
      router.push(`/chat/${conv.id}`);
    } catch (err) {
      toast.error("Failed to start", { description: String(err) });
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-paper text-paper-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-paper text-paper-foreground overflow-y-auto">
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 md:px-10 py-10">
        <div className="w-full max-w-3xl animate-fade-in">
          {/* Top eyebrow */}
          <div className="flex items-center gap-2 mb-6 text-[10.5px] tracking-[0.24em] uppercase text-paper-muted/80">
            <BookMarked className="h-3 w-3" />
            <span>ExamGPT · Study Journal</span>
            <span className="flex-1 border-t border-dashed border-paper-border/70 ml-2" />
          </div>

          {/* Hero */}
          <h1
            className="text-4xl md:text-6xl leading-[1.05] tracking-tight text-paper-foreground mb-5"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Your next exam answer
            <br />
            <span className="text-paper-muted/70 italic">starts here.</span>
          </h1>
          <p className="text-[15px] md:text-base text-paper-muted leading-relaxed max-w-xl mb-8">
            Ask in the style you'd expect on the exam — mention marks for the format,
            attach a question paper, or just write the question. Every answer is
            formatted like a model university answer sheet.
          </p>

          {/* CTA row */}
          <div className="flex flex-wrap items-center gap-3 mb-12">
            <button
              onClick={startChat}
              disabled={creating}
              className="inline-flex items-center gap-2 bg-paper-foreground text-paper px-5 py-3 rounded-lg text-sm font-medium hover:bg-paper-foreground/90 transition disabled:opacity-60 shadow-sm"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                </>
              ) : (
                <>
                  <PenLine className="h-4 w-4" /> Start a new answer sheet
                </>
              )}
            </button>
            <button
              onClick={() => router.push("/upload")}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-paper-foreground/85 hover:bg-paper-foreground/8 transition"
            >
              Manage Notes Library
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Starter ribbon */}
          <div className="border-t border-paper-border/60 pt-7">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-3.5 w-3.5 text-paper-accent" />
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-paper-muted/70">
                Try one of these
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={startChat}
                  disabled={creating}
                  className="group text-left flex items-center gap-3 rounded-lg border border-paper-border/60 px-4 py-3 bg-paper-foreground/[0.025] hover:bg-paper-foreground/[0.07] hover:border-paper-border transition disabled:opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[15px] text-paper-foreground truncate"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {s.label}
                    </div>
                    <div className="text-[11px] text-paper-muted mt-0.5">{s.hint}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-paper-muted/50 group-hover:text-paper-foreground group-hover:translate-x-0.5 transition" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer ribbon — matches chat page */}
      <div className="text-[10.5px] text-paper-muted/70 text-center py-3 tracking-[0.18em] uppercase border-t border-paper-border/40">
        Verify before your exam · Grounded in your uploads
      </div>
    </div>
  );
}
