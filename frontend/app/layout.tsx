import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
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
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "hsl(28, 30%, 12%)",
          colorBackground: "hsl(42, 36%, 94%)",
          colorText: "hsl(28, 30%, 12%)",
          borderRadius: "0.5rem",
          fontFamily: "var(--font-sans)",
        },
      }}
    >
      <html lang="en" className="dark">
        <body className="min-h-[100dvh]">
          {children}
          <Toaster richColors theme="dark" position="top-center" />
        </body>
      </html>
    </ClerkProvider>
  );
}
