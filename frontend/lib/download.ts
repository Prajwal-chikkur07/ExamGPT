/**
 * Client-side download utilities. All run locally — no backend round-trip.
 *
 * Supported formats:
 *  - markdown   .md   : raw markdown
 *  - text       .txt  : markdown stripped to plain text
 *  - pdf              : opens a print window scoped to the answer, user picks "Save as PDF"
 *  - word       .doc  : HTML wrapped with Word MIME headers — Word opens it directly
 */

function safeName(s: string): string {
  return (s || "answer").replace(/[^\w\d\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "answer";
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadMarkdown(content: string, title: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${safeName(title)}.md`);
}

export function downloadText(content: string, title: string) {
  const text = markdownToPlainText(content);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, `${safeName(title)}.txt`);
}

export function downloadWord(content: string, title: string) {
  // Word will happily open an HTML document saved with a .doc extension if we
  // wrap it in the right MIME envelope.
  const html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; color: #1a1a1a; max-width: 720px; padding: 40px; }
  h1, h2, h3 { font-family: Georgia, serif; }
  h1 { font-size: 22pt; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13pt; }
  p { margin: 0 0 10pt; }
  ul, ol { margin: 0 0 10pt 24pt; }
  table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
  th, td { border: 1px solid #999; padding: 6pt 8pt; text-align: left; }
  pre { background: #f4f4f4; padding: 10pt; border: 1px solid #ddd; font-family: Menlo, monospace; }
  code { background: #f4f4f4; padding: 1pt 3pt; font-family: Menlo, monospace; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${markdownToHtml(content)}
</body></html>`;
  const blob = new Blob(["﻿", html], {
    type: "application/msword;charset=utf-8",
  });
  triggerBlobDownload(blob, `${safeName(title)}.doc`);
}

export function downloadPDF(content: string, title: string) {
  // Use a hidden iframe instead of window.open — popup blockers and the loss of
  // user-gesture context (e.g. when triggered from inside Radix DropdownMenu)
  // make window.open unreliable.
  const html = `<!DOCTYPE html>
<html><head>
<meta charset='utf-8'>
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm; }
  html, body { background: #fff; color: #1a1a1a; font-family: Georgia, "Times New Roman", serif; line-height: 1.65; }
  body { max-width: 720px; margin: 0 auto; padding: 24px; }
  .title { font-family: Georgia, serif; font-size: 22pt; font-weight: 600; margin: 0 0 16pt; }
  h1, h2, h3, h4 { font-family: Georgia, serif; }
  h1 { font-size: 18pt; margin: 18pt 0 8pt; }
  h2 { font-size: 15pt; margin: 14pt 0 6pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 9pt; }
  ul, ol { margin: 0 0 9pt 22pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 11pt; }
  th, td { border: 1px solid #999; padding: 5pt 7pt; text-align: left; }
  th { background: #efe9d8; }
  pre { background: #f3eddc; border: 1px solid #ccc6b1; padding: 9pt 11pt; font-family: Menlo, monospace; font-size: 10.5pt; overflow-x: auto; }
  code { background: #f3eddc; padding: 1pt 3pt; font-family: Menlo, monospace; font-size: 10.5pt; }
  blockquote { border-left: 3px solid #b08a4f; padding-left: 10pt; color: #444; font-style: italic; margin: 9pt 0; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 14pt 0; }
</style>
</head>
<body>
<div class="title">${escapeHtml(title)}</div>
${markdownToHtml(content)}
</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1500);
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      win.focus();
      win.print();
    } finally {
      cleanup();
    }
  };

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
}

/* ───────────────────── helpers ───────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** A minimal markdown → HTML pass good enough for printing exam-style answers.
 *  We deliberately avoid pulling in a heavy markdown lib for downloads. */
function markdownToHtml(md: string): string {
  if (!md) return "";
  let text = md.replace(/\r\n?/g, "\n");

  // Code fences
  text = text.replace(/```([a-zA-Z]*)?\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
  });

  // Block tokens: split by blank lines
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const blockRaw of blocks) {
    const block = blockRaw.trim();
    if (!block) continue;
    // Already HTML?
    if (/^<(pre|h\d|ul|ol|table)/.test(block)) {
      out.push(block);
      continue;
    }
    // Headings
    const h = block.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    // Unordered list
    if (/^[*\-•]\s/.test(block)) {
      const items = block.split(/\n/).map((l) =>
        l.replace(/^[*\-•]\s+/, "").trim()
      );
      out.push("<ul>" + items.map((i) => `<li>${inline(i)}</li>`).join("") + "</ul>");
      continue;
    }
    // Ordered list
    if (/^\d+\.\s/.test(block)) {
      const items = block.split(/\n/).map((l) =>
        l.replace(/^\d+\.\s+/, "").trim()
      );
      out.push("<ol>" + items.map((i) => `<li>${inline(i)}</li>`).join("") + "</ol>");
      continue;
    }
    // Blockquote
    if (/^>\s/.test(block)) {
      const lines = block.split(/\n/).map((l) => l.replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(lines.join(" "))}</blockquote>`);
      continue;
    }
    // Plain paragraph — preserve newlines as line breaks
    out.push(`<p>${inline(block).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("\n");
}

function inline(s: string): string {
  let t = escapeHtml(s);
  // Inline code
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold (**)
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic (* or _)
  t = t.replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
  t = t.replace(/(^|\W)\*([^*]+)\*(?=$|\W)/g, "$1<em>$2</em>");
  return t;
}

function markdownToPlainText(md: string): string {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^[*\-•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
