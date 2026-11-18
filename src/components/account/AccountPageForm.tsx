// The form on the login and sign-up pages, going back to the page's `?next=`
// afterwards (#134). One helper for both pages. `next` is request data, so the
// form streams in. The fallback is empty on purpose: a form without `next` in
// the prerendered shell can be used before the real one arrives (after a
// client-side redirect from /account, say), and its "Create an account" link
// or submit would then drop `next`. The server action checks `next` again,
// since anyone can post any value.
import { Suspense } from "react";

import { safeNextPath } from "@/auth/next-path";

import { AccountForm, type AccountFormProps } from "./AccountForm";

type Props = Omit<AccountFormProps, "next"> & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function AccountPageForm({ searchParams, ...form }: Props) {
  return (
    <Suspense fallback={null}>
      <WithNext searchParams={searchParams} {...form} />
    </Suspense>
  );
}

async function WithNext({ searchParams, ...form }: Props) {
  const { next } = await searchParams;
  return <AccountForm {...form} next={safeNextPath(next)} />;
}
