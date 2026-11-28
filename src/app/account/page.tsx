import type { Metadata } from "next";
import { GAME_NAME } from "@/site";
import { Suspense } from "react";

import { changePasswordAction, deleteAccountAction, logoutAction } from "@/app/account/actions";
import { requireUser } from "@/auth/session";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/account/AccountSettings";
import { Button, CARD, PAGE_TITLE, TextLink } from "@/components/ui/controls";

export const metadata: Metadata = { title: `Your account · ${GAME_NAME}` };

export default function AccountPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-sm">
        {/* "Home", like /daily, /leaderboard and the site header (#80). The arrow is decoration. */}
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className={PAGE_TITLE}>Your account</h1>
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
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className={`${CARD} flex flex-col items-center gap-4 p-5`}>
        <p>
          Signed in as <strong>{user.username}</strong>.
        </p>
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">
            Log out
          </Button>
        </form>
      </div>
      {/* Change the password and delete the account (#234). */}
      <ChangePasswordForm action={changePasswordAction} />
      <DeleteAccountForm action={deleteAccountAction} username={user.username} />
    </div>
  );
}
