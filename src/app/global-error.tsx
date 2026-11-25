"use client"; // error boundaries are Client Components (Next 16 docs, error.md)

import { ErrorScreen, UNEXPECTED_ERROR } from "@/components/ErrorScreen";
import { Button } from "@/components/ui/controls";
import { GAME_NAME } from "@/site";
import "./globals.css";

/**
 * An error in the root layout itself (#229). It replaces the layout, so it
 * brings its own `<html>` and `<body>`, the global styles and a `<title>` (a
 * Client Component can't export `metadata`). There's no header, and the links
 * load a fresh page. Like `error.tsx`, it never shows `error`.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>{`${UNEXPECTED_ERROR.title} · ${GAME_NAME}`}</title>
        <ErrorScreen {...UNEXPECTED_ERROR} action={<Button onClick={() => retry()}>Try again</Button>} reload />
      </body>
    </html>
  );
}
