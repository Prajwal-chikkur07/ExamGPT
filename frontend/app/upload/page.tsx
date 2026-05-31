"use client";

import { UploadZone } from "@/components/upload-zone";

export default function UploadPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10">
        <div className="paper px-6 md:px-12 py-8 md:py-10">
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-paper-muted/80 mb-2">
            Notes Library · Permanent Index
          </div>
          <h1
            className="text-2xl md:text-3xl text-paper-foreground mb-2"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Files searchable across every answer sheet
          </h1>
          <p className="text-sm text-paper-muted leading-relaxed mb-6 max-w-xl">
            Upload notes that should be available to <em>every</em> chat.
            For a one-off file like a single question paper, attach it inside the
            chat with the + button instead — that stays private to that conversation.
          </p>
          <UploadZone />
        </div>
      </div>
    </div>
  );
}
