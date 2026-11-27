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
    <header className="w-full">
      <nav
        aria-label="Site"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 border-b border-zinc-300 px-4 py-3 dark:border-zinc-700"
      >
        <Link
          href="/"
          // Screen readers hear "Zoom Out home". The visible name starts the
          // label (WCAG "label in name"), so voice control "click Zoom Out" works.
          aria-label={`${GAME_NAME} home`}
          aria-current={onHome ? "page" : undefined}
          className={`group -mx-2 inline-flex items-center gap-2.5 rounded-md px-2 py-1.5 font-display text-xl tracking-tight hover:bg-zinc-200 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
        >
          <BrandGlyph />
          {GAME_NAME}
        </Link>
        {/* Wraps on a phone, so a long username and Log out never overlap the link. */}
        <div className="flex flex-wrap items-center justify-end gap-x-4 text-sm">
          {/* The leaderboard isn't a mode, so it's here rather than a card (#62). */}
          <Link
            href="/leaderboard"
            aria-current={pathname === "/leaderboard" ? "page" : undefined}
            className={`-mx-2 inline-block rounded-md px-2 py-2 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            Leaderboard
          </Link>
          {account !== undefined && <div>{account}</div>}
        </div>
      </nav>
    </header>
  );
}

/** The brand mark (#183): crop corners around a lens, on a Meadow tile with a beveled base. */
function BrandGlyph() {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 place-items-center rounded-lg bg-meadow text-plum shadow-[0_3px_0_#729448]"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
        <path className="brand-corners" d="M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    </span>
  );
}
