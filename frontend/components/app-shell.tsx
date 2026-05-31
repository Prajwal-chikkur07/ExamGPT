"use client";

import { useState } from "react";
import Link from "next/link";
import { BookMarked, Menu } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { SidebarContent } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Desktop sidebar — already a cream paper-plain inside SidebarContent */}
      <aside className="hidden md:flex w-[280px] shrink-0 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden data-[state=open]:animate-fade-in" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-[280px] md:hidden flex flex-col data-[state=open]:animate-slide-in-left"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Main column */}
      <main className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Mobile-only top bar — looks like the spine/header strip of a notebook */}
        <header className="md:hidden flex items-center gap-2 h-14 px-3 border-b border-paper-border/60 bg-paper text-paper-foreground sticky top-0 z-30 shadow-sm">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="h-10 w-10 inline-flex items-center justify-center rounded-md text-paper-muted hover:bg-paper-foreground/6 hover:text-paper-foreground transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-paper-foreground text-paper flex items-center justify-center">
              <BookMarked className="h-3.5 w-3.5" />
            </div>
            <span
              className="font-semibold text-[15px] text-paper-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              ExamGPT
            </span>
          </Link>
        </header>

        <div className="flex-1 min-h-0">{children}</div>
      </main>
    </div>
  );
}
