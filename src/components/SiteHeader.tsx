"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GAME_NAME } from "@/site";
import { FOCUS_RING } from "./ui/controls";

export type SiteHeaderProps = {
  /**
   * The login status area (logged in as …, log in, log out). Accounts are #53,
   * which fills this slot. Until then it's left out, rather than linking to
   * pages that don't exist. Log out should be a form or button there, not a
   * link: Next prefetches links, which could log someone out by accident.
   */
  account?: ReactNode;
};

/**
 * The bar at the top of every screen (#50), from the root layout. The game's
 * name links home from anywhere, so every screen, including ones we add later,
 * has a way back without each page adding its own.
 */
export function SiteHeader({ account }: SiteHeaderProps) {
  // usePathname needs a Client Component (Next 16 docs, use-pathname.md).
  const pathname = usePathname();
  const onHome = pathname === "/";
  return (
    <header className="w-full border-b border-zinc-200 dark:border-zinc-800">
      <nav aria-label="Site" className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 px-4 py-2">
        <Link
          href="/"
          // Screen readers hear "Zoom Out home". The visible name starts the
          // label (WCAG "label in name"), so voice control "click Zoom Out" works.
          aria-label={`${GAME_NAME} home`}
          aria-current={onHome ? "page" : undefined}
          className={`-mx-2 inline-block rounded-md px-2 py-2 font-semibold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-900 ${FOCUS_RING}`}
        >
          {GAME_NAME}
        </Link>
        {/* Wraps on a phone, so a long username and Log out never overlap the link. */}
        <div className="flex flex-wrap items-center justify-end gap-x-4 text-sm">
          {/* The leaderboard isn't a mode, so it's here rather than a card (#62). */}
          <Link
            href="/leaderboard"
            aria-current={pathname === "/leaderboard" ? "page" : undefined}
            className={`-mx-2 inline-block rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${FOCUS_RING}`}
          >
            Leaderboard
          </Link>
          {account !== undefined && <div>{account}</div>}
        </div>
      </nav>
    </header>
  );
}
