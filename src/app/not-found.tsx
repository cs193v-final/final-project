import type { Metadata } from "next";
import { ErrorScreen } from "@/components/ErrorScreen";
import { GAME_NAME } from "@/site";

export const metadata: Metadata = { title: `Page not found · ${GAME_NAME}` };

/**
 * Any URL the app doesn't have, and any `notFound()` (#229). It renders inside
 * the root layout, so the header's home link is there too. Next sends the root
 * not-found with every page, so it stays a Server Component (Next 16 docs,
 * not-found.md).
 */
export default function NotFound() {
  return (
    <ErrorScreen
      title="Page not found"
      message="There's no page at this address. Check the link, or start again from here."
    />
  );
}
