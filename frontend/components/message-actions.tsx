"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  feedback: "like" | "dislike" | null;
  onFeedback: (next: "like" | "dislike" | null) => void;
  onRegenerate?: () => void;
  canRegenerate: boolean;
  disabled?: boolean;
}

export function MessageActions({
  text,
  feedback,
  onFeedback,
  onRegenerate,
  canRegenerate,
  disabled,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browsers without clipboard API (rare on http://localhost) — silently skip.
    }
  }

  return (
    <div className="flex items-center gap-0.5 mt-3 -ml-2 opacity-70 hover:opacity-100 transition-opacity">
      <ActionButton
        title={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
        disabled={disabled || !text}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </ActionButton>

      <ActionButton
        title="Good response"
        active={feedback === "like"}
        onClick={() => onFeedback(feedback === "like" ? null : "like")}
        disabled={disabled}
      >
        <ThumbsUp className={cn("h-3.5 w-3.5", feedback === "like" && "text-emerald-400 fill-emerald-400/20")} />
      </ActionButton>

      <ActionButton
        title="Bad response"
        active={feedback === "dislike"}
        onClick={() => onFeedback(feedback === "dislike" ? null : "dislike")}
        disabled={disabled}
      >
        <ThumbsDown className={cn("h-3.5 w-3.5", feedback === "dislike" && "text-rose-400 fill-rose-400/20")} />
      </ActionButton>

      {canRegenerate && onRegenerate && (
        <ActionButton
          title="Regenerate response"
          onClick={onRegenerate}
          disabled={disabled}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </ActionButton>
      )}
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground",
        "disabled:opacity-40 disabled:pointer-events-none",
        active && "text-foreground bg-accent/60"
      )}
    >
      {children}
    </button>
  );
}
