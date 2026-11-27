import type { Metadata } from "next";

import { registerAction } from "@/app/account/actions";
import { AccountPageForm } from "@/components/account/AccountPageForm";
import { PAGE_TITLE, TextLink } from "@/components/ui/controls";

export const metadata: Metadata = { title: "Create an account · Zoom Out" };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-sm">
        {/* "Home", like /daily, /leaderboard and the site header (#80). The arrow is decoration. */}
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className={PAGE_TITLE}>Create an account</h1>
      {/* `?next=` (where to go after, #134) is request data: see AccountPageForm. */}
      <AccountPageForm searchParams={searchParams} mode="register" action={registerAction} />
    </main>
  );
}
