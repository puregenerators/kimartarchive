"use server";

import { redirect } from "next/navigation";

import { clearAppAccessCookie, setAppAccessCookie } from "@/lib/auth/access";
import {
  authNotConfiguredMessage,
  createSessionToken,
  readAppAccessPassword,
  safeInternalPath,
  secretsEqual,
} from "@/lib/auth/session";

export type LoginActionState = {
  ok: false;
  message: string;
} | null;

export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const password = readAppAccessPassword();
  if (!password) {
    return { ok: false, message: authNotConfiguredMessage() };
  }

  const submitted = String(formData.get("password") ?? "");
  if (!secretsEqual(submitted, password)) {
    return { ok: false, message: "Incorrect password." };
  }

  await setAppAccessCookie(createSessionToken(password));
  redirect(safeInternalPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await clearAppAccessCookie();
  redirect("/login");
}
