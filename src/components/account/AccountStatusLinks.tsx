"use client";
// The parts of the header's login status that depend on the URL (#134). The
// root layout can't read the URL on the server, so these read it in the
// browser (usePathname, useSearchParams). AccountStatus renders them inside its
// <Suspense> boundary.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { loginPath, parseWelcome, WELCOME_PARAM, type Welcome } from "@/auth/next-path";

/**
 * "Log in", coming back to this page afterwards (`/login?next=/play?game=…`).
 * On the login and sign-up pages it keeps the page's own `next`, so
 * `/account` → log in → "Create an account" → header "Log in" still comes
 * back to `/account`.
 */
export function LoginLink({ className }: { className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  const onAuthPage = pathname === "/login" || pathname === "/register";
  const next = onAuthPage ? (params.get("next") ?? undefined) : query ? `${pathname}?${query}` : pathname;
  return (
    <Link href={loginPath(next)} className={className}>
      Log in
    </Link>
  );
}

const WELCOME_TEXT: Record<Welcome, (username: string) => string> = {
  login: (username) => `Logged in as ${username}.`,
  signup: (username) => `Account created. Logged in as ${username}.`,
};

/**
 * "Logged in as …", once, on the page a login or sign-up lands on (it adds
 * `?welcome=`). Without it, going home after logging in (#132) gives a screen
 * reader nothing but the home page's title. A `role="status"` region that is
 * already on the page, so the text is announced when it appears: the header
 * renders it logged out too (with `username` null), so it exists before the
 * login redirect fills it in. The flag is then removed from the URL, so
 * reloading or sharing the link doesn't repeat it, and the message goes away
 * on the next page, for good: coming back to that page doesn't repeat it.
 */
export function WelcomeStatus({ username }: { username: string | null }) {
  const pathname = usePathname();
  const welcome = parseWelcome(useSearchParams().get(WELCOME_PARAM));
  const [shown, setShown] = useState<{ welcome: Welcome; pathname: string } | null>(null);

  useEffect(() => {
    if (!welcome) return;
    // In an effect, not during render: the empty status region must be on the
    // page before its text arrives, or screen readers may not announce it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown({ welcome, pathname });
    const url = new URL(window.location.href);
    url.searchParams.delete(WELCOME_PARAM);
    // `null`, not `window.history.state`: Next's patched replaceState only
    // updates its router (and `useSearchParams`) when the state isn't its own,
    // so passing its state would let `?welcome=` come back on the next router
    // update (Next 16 docs, "Linking and Navigating", window.history.replaceState).
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [welcome, pathname]);

  // The header stays mounted across navigations: forget the message once we
  // leave its page, so coming back doesn't show (and announce) it again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shown && shown.pathname !== pathname) setShown(null);
  }, [pathname, shown]);

  const text = shown && username && shown.pathname === pathname ? WELCOME_TEXT[shown.welcome](username) : "";
  return (
    <p role="status" className="text-zinc-700 dark:text-zinc-300">
      {text}
    </p>
  );
}
