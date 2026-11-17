// The header's login status (#53), for the `account` slot of SiteHeader (#50).
// A Server Component: it reads the session cookie, so the layout renders it
// behind a <Suspense> boundary. Without a cookie it never touches the database.
import Link from "next/link";

import { logoutAction } from "@/app/account/actions";
import { getCurrentUser } from "@/auth/session";
import type { PublicUser } from "@/game/types";

const linkClass = "font-medium underline underline-offset-2";

/** What the header shows for a user, or for nobody. Split out so it can be tested without cookies. */
export function AccountStatusView({ user }: { user: PublicUser | null }) {
  if (!user) {
    return (
      <Link href="/login" className={linkClass}>
        Log in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Link href="/account" className={linkClass}>
        {user.username}
      </Link>
      {/* A form, not a link: Next prefetches links, which could log someone out. */}
      <form action={logoutAction}>
        <button type="submit" className="rounded-md px-2 py-1 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900">
          Log out
        </button>
      </form>
    </div>
  );
}

/**
 * The header is on every page, including ones that don't need the database
 * (practice). If the session can't be checked (database down or not
 * configured), show "Log in" instead of breaking the page. `/account` still
 * fails loudly through `requireUser`.
 */
export async function AccountStatus() {
  const user = await getCurrentUser().catch((error: unknown) => {
    console.error("Couldn't check the session for the header", error);
    return null;
  });
  return <AccountStatusView user={user} />;
}
