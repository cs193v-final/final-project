"use client";
// The parts of the header's login status that depend on the URL (#134). The
// root layout can't read the URL on the server, so these read it in the
// browser (usePathname, useSearchParams). AccountStatus renders them inside its
// <Suspense> boundary.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { loginPath, parseWelcome, WELCOME_PARAM, type Welcome } from "@/auth/next-path";

/** "Log in", coming back to this page afterwards (`/login?next=/play?game=…`). */
export function LoginLink({ className }: { className?: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return (
    <Link href={loginPath(query ? `${pathname}?${query}` : pathname)} className={className}>
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
 * already on the page, so the text is announced when it appears. The flag is
 * then removed from the URL, so reloading or sharing the link doesn't repeat
 * it, and the message goes away on the next page.
 */
export function WelcomeStatus({ username }: { username: string }) {
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
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [welcome, pathname]);

  const text = shown && shown.pathname === pathname ? WELCOME_TEXT[shown.welcome](username) : "";
  return (
    <p role="status" className="text-zinc-700 dark:text-zinc-300">
      {text}
    </p>
  );
}
