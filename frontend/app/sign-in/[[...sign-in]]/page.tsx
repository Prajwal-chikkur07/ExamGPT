import { SignIn } from "@clerk/nextjs";
import { BookMarked } from "lucide-react";

export default function Page() {
  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-paper text-paper-foreground">
      {/* Left — brand panel (hidden on mobile) */}
      <div className="hidden md:flex md:w-1/2 flex-col justify-between p-12 border-r border-paper-border/60 bg-paper-foreground text-paper">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-paper text-paper-foreground flex items-center justify-center">
            <BookMarked className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span
              className="font-semibold text-[15px]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              ExamGPT
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-paper/70">
              Answer Book
            </span>
          </div>
        </div>

        <div>
          <h1
            className="text-5xl leading-[1.05] tracking-tight mb-4"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Your exam answers,
            <br />
            <span className="text-paper/60 italic">written like a topper.</span>
          </h1>
          <p className="text-[14.5px] text-paper/70 leading-relaxed max-w-md">
            Upload your notes once. Ask any question — get a model university
            answer grounded in your own material, formatted by marks.
          </p>
        </div>

        <div className="text-[10.5px] uppercase tracking-[0.22em] text-paper/50">
          Sign in to begin
        </div>
      </div>

      {/* Right — auth widget */}
      <div className="flex-1 flex items-center justify-center px-4 py-10 md:py-0">
        <div className="w-full max-w-md flex flex-col items-center">
          {/* Mobile brand (visible only on small screens) */}
          <div className="md:hidden flex items-center gap-2.5 mb-8">
            <div className="h-9 w-9 rounded-md bg-paper-foreground text-paper flex items-center justify-center">
              <BookMarked className="h-4 w-4" />
            </div>
            <div className="flex flex-col leading-tight">
              <span
                className="font-semibold text-[15px]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                ExamGPT
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-paper-muted">
                Answer Book
              </span>
            </div>
          </div>

          <SignIn signUpUrl="/sign-up" />
        </div>
      </div>
    </div>
  );
}
