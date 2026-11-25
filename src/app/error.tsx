"use client"; // error boundaries are Client Components (Next 16 docs, error.md)

import { ErrorScreen, UNEXPECTED_ERROR } from "@/components/ErrorScreen";
import { Button } from "@/components/ui/controls";

/**
 * An unexpected error in a page (#229). It renders inside the root layout, so
 * the header still links home; an error in the layout itself is
 * `global-error.tsx`.
 *
 * `error` is never shown: a Client Component's error, and every error in
 * development, carries its real message. Next logs server errors on the
 * server, and React logs the error in the browser's console.
 */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen {...UNEXPECTED_ERROR} action={<Button onClick={() => retry()}>Try again</Button>} />;
}
