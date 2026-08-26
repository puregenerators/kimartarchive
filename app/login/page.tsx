import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/LoginForm";
import { getAppAccessState } from "@/lib/auth/access";
import {
  authNotConfiguredMessage,
  readAppAccessPassword,
  safeInternalPath,
} from "@/lib/auth/session";

export const metadata = {
  title: "Sign in · Kim Artwork Archive",
  description: "Private access to the Kim Artwork Archive.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ next?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const nextPath = safeInternalPath(params.next);
  const access = await getAppAccessState();
  if (access.ok) {
    redirect(nextPath);
  }

  const configured = Boolean(readAppAccessPassword());

  return (
    <LoginForm
      configured={configured}
      nextPath={nextPath}
      unconfiguredMessage={configured ? "" : authNotConfiguredMessage()}
    />
  );
}
