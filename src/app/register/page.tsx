import type { Metadata } from "next";
import Link from "next/link";

import { registerAction } from "@/app/account/actions";
import { AccountForm } from "@/components/account/AccountForm";

export const metadata: Metadata = { title: "Create an account · Zoom Out" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-sm">
        <Link href="/" className="text-sm font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
          ← Back to start
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Create an account</h1>
      <AccountForm mode="register" action={registerAction} />
    </main>
  );
}
