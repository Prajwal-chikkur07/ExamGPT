import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "ExamGPT — Your Personal Exam Assistant",
  description:
    "Upload notes, ask anything, solve question papers, and revise — all grounded in your study materials.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-[100dvh]">
        <AppShell>{children}</AppShell>
        <Toaster richColors theme="dark" position="top-center" />
      </body>
    </html>
  );
}
