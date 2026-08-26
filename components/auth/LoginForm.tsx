"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/login/actions";
import { LoginView } from "@/components/auth/LoginView";

export function LoginForm({
  configured,
  nextPath,
  unconfiguredMessage,
}: {
  configured: boolean;
  nextPath: string;
  unconfiguredMessage: string;
}) {
  const [state, action, pending] = useActionState(loginAction, null);

  return (
    <LoginView
      configured={configured}
      nextPath={nextPath}
      error={state?.message ?? null}
      pending={pending}
      formAction={action}
      unconfiguredMessage={unconfiguredMessage}
    />
  );
}
