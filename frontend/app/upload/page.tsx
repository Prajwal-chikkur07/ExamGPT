"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { UploadZone } from "@/components/upload-zone";

export default function UploadPage() {
  const router = useRouter();
  return (
    <div className="h-full flex flex-col bg-paper text-paper-foreground overflow-y-auto">
      <div className="flex-1 min-h-0 px-4 md:px-10 py-8 md:py-12">
        <div className="max-w-3xl mx-auto w-full animate-fade-in">
          {/* Eyebrow row */}
          <div className="flex items-center gap-2 mb-6 text-[10.5px] tracking-[0.24em] uppercase text-paper-muted/80">
            <FolderOpen className="h-3 w-3" />
            <span>Notes Library · Permanent Index</span>
            <span className="flex-1 border-t border-dashed border-paper-border/70 ml-2" />
            <button
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-1 text-paper-muted hover:text-paper-foreground transition tracking-[0.18em]"
            >
              <ArrowLeft className="h-3 w-3" /> Home
            </button>
          </div>

          {/* Hero */}
          <h1
            className="text-3xl md:text-5xl leading-[1.05] tracking-tight text-paper-foreground mb-4"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Files searchable across
            <br />
            <span className="text-paper-muted/70 italic">every answer sheet.</span>
          </h1>
          <p className="text-[15px] md:text-base text-paper-muted leading-relaxed max-w-xl mb-8">
            Upload notes that should be available to <em>every</em> chat.
            For a one-off file like a single question paper, attach it inside the
            chat with the + button instead — that stays private to that conversation.
          </p>

          {/* Divider */}
          <div className="border-t border-paper-border/60 mb-7" />

          {/* Upload area */}
          <UploadZone />
        </div>
      </div>

      <div className="text-[10.5px] text-paper-muted/70 text-center py-3 tracking-[0.18em] uppercase border-t border-paper-border/40">
        Files indexed here power every conversation
      </div>
    </div>
  );
}
