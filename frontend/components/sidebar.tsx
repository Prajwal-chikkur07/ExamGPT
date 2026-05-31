"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FolderClosed } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatList } from "./chat-list";

interface Props {
  onNavigate?: () => void;
}

export function SidebarContent({ onNavigate }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full min-h-0 paper-plain">
      {/* Masthead — looks like the cover of a journal */}
      <div className="px-5 pt-5 pb-4 border-b border-paper-border/60 relative">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 group"
        >
          <div className="h-9 w-9 rounded-md bg-paper-foreground text-paper flex items-center justify-center">
            <BookMarked className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span
              className="font-semibold text-[15px] text-paper-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              ExamGPT
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-paper-muted">
              Answer Book
            </span>
          </div>
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatList onNavigate={onNavigate} />
      </div>

      <div className="border-t border-paper-border/60 p-2">
        <Link
          href="/upload"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13.5px] transition-colors",
            "text-paper-muted hover:text-paper-foreground hover:bg-paper-foreground/6",
            pathname === "/upload" && "bg-paper-foreground/8 text-paper-foreground"
          )}
        >
          <FolderClosed className="h-4 w-4" />
          Notes Library
        </Link>
      </div>

      <div
        className="px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-paper-muted/70 text-center border-t border-paper-border/60"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Grounded in your uploads
      </div>
    </div>
  );
}

export function Sidebar() {
  return null;
}
