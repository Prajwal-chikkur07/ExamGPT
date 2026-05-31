"use client";

import { useEffect, useState } from "react";
import { File as FileIcon, Loader2, Trash2, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { documentsApi } from "@/lib/api";
import type { DocumentMeta } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md";

export function UploadZone() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  async function refresh() {
    try {
      setDocs(await documentsApi.list());
    } catch (err) {
      toast.error("Failed to load documents", { description: String(err) });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setProgress(`Indexing ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const result = await documentsApi.upload(files);
      toast.success(
        `Indexed ${result.documents.length} doc(s) — ${result.indexed_chunks} chunks`
      );
      await refresh();
    } catch (err) {
      toast.error("Upload failed", { description: String(err) });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      await documentsApi.delete(id);
      toast.success("Deleted");
      await refresh();
    } catch (err) {
      toast.error("Failed to delete", { description: String(err) });
    }
  }

  return (
    <div className="space-y-5">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`block rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-paper-accent bg-paper-accent-bg/60"
            : "border-paper-border bg-paper-foreground/3 hover:bg-paper-foreground/6"
        }`}
      >
        <input
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
        />
        <div className="flex flex-col items-center gap-3">
          {uploading ? (
            <Loader2 className="h-8 w-8 text-paper-accent animate-spin" />
          ) : (
            <UploadIcon className="h-8 w-8 text-paper-accent" />
          )}
          <div>
            <div className="font-medium text-paper-foreground">
              {progress ?? "Drop PDF, DOCX, PPTX, or TXT files here"}
            </div>
            <div className="text-xs text-paper-muted mt-1">
              or click to browse · multi-file supported
            </div>
          </div>
        </div>
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">
            Indexed documents <span className="text-muted-foreground">({docs.length})</span>
          </h3>
        </div>
        {docs.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No documents indexed yet. Upload your notes to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <Card key={d.id}>
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                      <FileIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{d.filename}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="uppercase">
                          {d.file_type}
                        </Badge>
                        <span>{d.pages} pages</span>
                        <span>·</span>
                        <span>{d.chunks} chunks</span>
                        <span>·</span>
                        <span>{formatDate(d.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(d.id, d.filename)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
