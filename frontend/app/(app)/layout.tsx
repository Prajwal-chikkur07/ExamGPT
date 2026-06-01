import { AppShell } from "@/components/app-shell";

export default function AuthedAppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
