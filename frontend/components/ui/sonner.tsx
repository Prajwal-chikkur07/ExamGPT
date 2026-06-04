"use client";

import { Toaster as SonnerToaster } from "sonner";

// Sonner's `richColors` paints success toasts bright green, which clashes with
// the warm "paper" theme. Override the success palette to the app's dark ink +
// amber accent. Error/warning keep their default semantic colors.
const successPalette: React.CSSProperties = {
  // @ts-expect-error -- Sonner reads these custom properties off the container.
  "--success-bg": "hsl(28 25% 16%)",
  "--success-text": "hsl(38 28% 92%)",
  "--success-border": "hsl(30 92% 42%)",
};

export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      {...props}
      style={{ ...successPalette, ...props.style }}
    />
  );
}
