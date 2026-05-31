"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookMarked, Loader2, PenLine } from "lucide-react";
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
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4 md:p-10">
        <div className="w-full max-w-2xl animate-fade-in">
          <div className="paper px-6 md:px-12 py-10 md:py-14">
            <div className="text-[10.5px] tracking-[0.22em] uppercase text-paper-muted/80 mb-2 flex items-center gap-2">
              <BookMarked className="h-3 w-3" />
              ExamGPT · Study Journal
            </div>
            <h1 className="font-serif text-2xl md:text-4xl text-paper-foreground leading-tight mb-2">
              Your next exam answer
              <br className="hidden md:block" />
              <span className="text-paper-muted/80"> starts here.</span>
            </h1>
            <p className="text-sm md:text-base text-paper-muted leading-relaxed max-w-md mb-6">
              Ask in the style you'd expect on the exam — mention marks for the format,
              attach a question paper, or just write the question. Every answer is
              formatted like a model university answer sheet.
            </p>

            <button
              onClick={startChat}
              disabled={creating}
              className="inline-flex items-center gap-2 bg-paper-foreground text-paper px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-paper-foreground/90 transition disabled:opacity-60"
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

            <div className="mt-8 pt-6 border-t border-paper-border/60">
              <div className="text-[10.5px] uppercase tracking-[0.16em] text-paper-muted/70 mb-3">
                Try one of these
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    onClick={startChat}
                    disabled={creating}
                    className="group text-left flex items-center gap-2 rounded-md border border-paper-border/70 px-3 py-2.5 bg-paper-foreground/3 hover:bg-paper-foreground/8 hover:border-paper-border transition disabled:opacity-60"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-paper-foreground truncate">
                        {s.label}
                      </div>
                      <div className="text-[10.5px] text-paper-muted">{s.hint}</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-paper-muted/60 group-hover:text-paper-foreground group-hover:translate-x-0.5 transition" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
