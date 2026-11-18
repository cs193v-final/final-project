import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { logoutAction } from "@/app/account/actions";
import { requireUser } from "@/auth/session";

export const metadata: Metadata = { title: "Your account · Zoom Out" };

export default function AccountPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-sm">
        <Link href="/" className="text-sm font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
          ← Back to start
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
      {/* Reads the session cookie, so it renders per request behind a boundary. */}
      <Suspense fallback={<p>Loading…</p>}>
        <SignedIn />
      </Suspense>
    </main>
  );
}

async function SignedIn() {
  const user = await requireUser("/account");
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p>
        Signed in as <strong>{user.username}</strong>.
      </p>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-md border border-zinc-400 px-4 py-2 font-semibold hover:bg-zinc-100 dark:border-zinc-500 dark:hover:bg-zinc-800"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
