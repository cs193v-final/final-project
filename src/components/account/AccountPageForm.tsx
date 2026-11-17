// The form on the login and sign-up pages, going back to the page's `?next=`
// afterwards (#134). A Server Component: `next` is request data, so the form
// with it streams in, and the prerendered shell has the same form without it
// instead of a blank space. The streamed form arrives in the same response and
// replaces the shell's without waiting for React to load, so a quick click on
// "Create an account" still keeps `next`. The server action checks `next`
// again, since anyone can post any value.
import { Suspense } from "react";

import { safeNextPath } from "@/auth/next-path";

import { AccountForm, type AccountFormProps } from "./AccountForm";

type Props = Omit<AccountFormProps, "next"> & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function AccountPageForm({ searchParams, ...form }: Props) {
  return (
    <Suspense fallback={<AccountForm {...form} />}>
      <WithNext searchParams={searchParams} {...form} />
    </Suspense>
  );
}

async function WithNext({ searchParams, ...form }: Props) {
  const { next } = await searchParams;
  return <AccountForm {...form} next={safeNextPath(next)} />;
}
