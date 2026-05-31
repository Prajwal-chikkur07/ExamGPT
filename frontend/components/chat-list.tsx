"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pencil, PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { conversationsApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

interface Props {
  onNavigate?: () => void;
}

function bucketOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = 86400 * 1000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - day;
  const startWeek = startToday - 6 * day;
  const startMonth = startToday - 29 * day;
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startYesterday) return "Yesterday";
  if (t >= startWeek) return "This week";
  if (t >= startMonth) return "Earlier this month";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This week", "Earlier this month", "Older"];

export function ChatList({ onNavigate }: Props) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const activeId = params?.id ?? null;
  const { conversations, setConversations, removeConversation, upsertConversation } = useAppStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function refresh() {
    try {
      const data = await conversationsApi.list();
      setConversations(data);
    } catch (err) {
      toast.error("Failed to load history", { description: String(err) });
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of conversations) {
      const b = bucketOf(c.updated_at || c.created_at);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(c);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b)! }));
  }, [conversations]);

  async function handleNew() {
    try {
      const conv = await conversationsApi.create();
      upsertConversation(conv);
      router.push(`/chat/${conv.id}`);
      onNavigate?.();
    } catch (err) {
      toast.error("Failed to create", { description: String(err) });
    }
  }

  async function handleDelete(id: string, title: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await conversationsApi.delete(id);
      removeConversation(id);
      toast.success("Deleted");
      if (activeId === id) router.push("/");
    } catch (err) {
      toast.error("Failed to delete", { description: String(err) });
    }
  }

  async function submitRename(id: string) {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    try {
      const conv = await conversationsApi.rename(id, title);
      upsertConversation(conv);
    } catch (err) {
      toast.error("Failed to rename", { description: String(err) });
    } finally {
      setRenamingId(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={handleNew}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md border border-paper-accent/60 bg-paper-accent-bg text-paper-foreground hover:bg-paper-accent/15 transition shadow-[inset_0_-1.5px_0_hsl(var(--paper-border)/0.5)] text-[13.5px] font-medium"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <PlusCircle className="h-4 w-4 text-paper-accent" />
          New answer sheet
        </button>
      </div>

      <div className="px-4 pb-2 flex items-center gap-2 text-paper-muted">
        <div
          className="text-[10.5px] tracking-[0.22em] uppercase font-medium"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          ── Index
        </div>
        <div className="flex-1 border-t border-dashed border-paper-border/60" />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
        {conversations.length === 0 ? (
          <div className="text-[12.5px] text-paper-muted px-3 py-4 leading-relaxed italic">
            Your study journal is empty. Open a new answer sheet to begin.
          </div>
        ) : (
          grouped.map(({ bucket, items }, bucketIdx) => {
            // Compute the starting absolute index for numbering across buckets
            const startNumber = grouped
              .slice(0, bucketIdx)
              .reduce((acc, g) => acc + g.items.length, 0);
            return (
            <div key={bucket}>
              <div
                className="px-3 pb-1.5 text-[10px] uppercase tracking-[0.18em] text-paper-muted/80 font-medium"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {bucket}
              </div>
              <div className="space-y-0.5">
                {items.map((c, i) => {
                  const num = startNumber + i + 1;
                  const active = c.id === activeId;
                  const isRenaming = renamingId === c.id;
                  return (
                    <Link
                      key={c.id}
                      href={`/chat/${c.id}`}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-baseline gap-2 pl-3 pr-2 py-2 text-[13.5px] rounded-md transition-colors relative",
                        "text-paper-muted hover:text-paper-foreground hover:bg-paper-foreground/5",
                        active && "text-paper-foreground bg-paper-foreground/8"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "shrink-0 text-[11px] tabular-nums w-5 text-right",
                          active ? "text-paper-accent font-semibold" : "text-paper-muted/70"
                        )}
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {num}.
                      </span>
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => submitRename(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitRename(c.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.preventDefault()}
                          className="flex-1 bg-transparent border-b border-paper-border focus:border-paper-accent px-0.5 py-0.5 text-[13.5px] outline-none"
                        />
                      ) : (
                        <span className="flex-1 truncate" title={c.title}>
                          {truncate(c.title || "Untitled", 28)}
                        </span>
                      )}
                      {!isRenaming && (
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setRenameValue(c.title);
                              setRenamingId(c.id);
                            }}
                            className="p-1 rounded"
                            title="Rename"
                            aria-label="Rename"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(c.id, c.title, e)}
                            className="p-1 rounded"
                            title="Delete"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
