"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

function MarkdownInner({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(
  MarkdownInner,
  (prev, next) => prev.children === next.children && prev.className === next.className,
);
