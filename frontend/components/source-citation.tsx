"use client";

import { FileText } from "lucide-react";
import type { SourceCitation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface Props {
  sources: SourceCitation[];
  compact?: boolean;
}

export function SourceList({ sources, compact = false }: Props) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
        Sources
      </div>
      <div className="space-y-2">
        {sources.map((s, i) => (
          <div
            key={`${s.document_id}-${s.page}-${i}`}
            className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 font-medium truncate">
                <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{s.filename}</span>
                <Badge variant="outline" className="shrink-0">
                  p. {s.page}
                </Badge>
              </div>
              <span className="text-muted-foreground shrink-0">
                {Math.round(s.score * 100)}% match
              </span>
            </div>
            {!compact && (
              <p className="text-muted-foreground leading-relaxed line-clamp-3">{s.snippet}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
