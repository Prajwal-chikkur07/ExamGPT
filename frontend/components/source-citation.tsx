"use client";

import { FileText } from "lucide-react";
import type { SourceCitation } from "@/lib/types";

interface Props {
  sources: SourceCitation[];
  compact?: boolean;
}

export function SourceList({ sources, compact = false }: Props) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-paper-muted font-medium">
        Sources
      </div>
      <div className="space-y-2">
        {sources.map((s, i) => (
          <div
            key={`${s.document_id}-${s.page}-${i}`}
            className="rounded-md border border-paper-border bg-paper-foreground/5 p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              {/* min-w-0 lets the filename truncate instead of widening the row
                  and pushing the match % off the right edge. */}
              <div className="flex items-center gap-2 font-medium min-w-0 flex-1 text-paper-foreground">
                <FileText className="h-3.5 w-3.5 text-paper-accent shrink-0" />
                <span className="truncate">{s.filename}</span>
                <span className="shrink-0 rounded border border-paper-border px-1.5 py-0.5 text-[10px] text-paper-muted">
                  p. {s.page}
                </span>
              </div>
              <span className="text-paper-muted shrink-0 whitespace-nowrap">
                {Math.round(s.score * 100)}% match
              </span>
            </div>
            {!compact && (
              <p className="text-paper-muted leading-relaxed line-clamp-3 break-words">
                {s.snippet}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
