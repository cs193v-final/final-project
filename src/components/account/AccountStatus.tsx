// The header's login status (#53), for the `account` slot of SiteHeader (#50).
// A Server Component: it reads the session cookie, so the layout renders it
// behind a <Suspense> boundary. Without a cookie it never touches the database.
import Link from "next/link";

import { logoutAction } from "@/app/account/actions";
import { getCurrentUserOrLoggedOut } from "@/auth/session";
import { FOCUS_RING } from "@/components/ui/controls";
import type { PublicUser } from "@/game/types";

import { LoginLink, WelcomeStatus } from "./AccountStatusLinks";

// The same look as the header's Leaderboard link (SiteHeader), with the same focus ring (#183).
const linkClass = `-mx-2 inline-block rounded-md px-2 py-2 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-800 ${FOCUS_RING}`;

/** What the header shows for a user, or for nobody. Split out so it can be tested without cookies. */
export function AccountStatusView({ user }: { user: PublicUser | null }) {
  return (
    <div className="flex items-center gap-4">
      {/* Outside the branch, so the same (empty) status region is already on
          the page when a login switches the header over and fills it in: many
          screen readers don't announce a live region added with its text. */}
      <WelcomeStatus username={user?.username ?? null} />
      {user ? (
        <>
          <Link href="/account" className={linkClass}>
            {user.username}
          </Link>
          {/* A form, not a link: Next prefetches links, which could log someone out. */}
          <form action={logoutAction}>
            <button type="submit" className={linkClass}>
              Log out
            </button>
          </form>
        </>
      ) : (
        <LoginLink className={linkClass} />
      )}
    </div>
  );
}

/**
 * The header is on every page, including ones that don't need the database
 * (practice). If the session can't be checked (database down or not
 * configured), it shows "Log in" instead of breaking the page. `/account`
 * still fails loudly through `requireUser`.
 */
export async function AccountStatus() {
  return <AccountStatusView user={await getCurrentUserOrLoggedOut()} />;
}
