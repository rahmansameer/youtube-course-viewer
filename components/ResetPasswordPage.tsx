"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/AuthGate";
import {
  AuthLayout,
  Field,
  MIN_PASSWORD_LENGTH,
  ShowPasswordToggle,
} from "@/components/AuthPage";
import { Button, ButtonLink } from "@/components/ui";
import { FORGOT_PASSWORD_PATH, SIGN_IN_PATH } from "@/lib/auth-session-hint";
import { getSupabaseClient } from "@/lib/supabase";
import { showToast } from "@/lib/toast";

// Where the password reset email's link lands (see sendPasswordResetEmail).
// The link signs the visitor in for this tab; here they choose the new
// password. An expired or used link, or a visit without one, explains what
// to do instead.
export default function ResetPasswordPage() {
  const router = useRouter();
  const { user, recovering, endRecovery, redirectResult } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setPasswordError("");
    setConfirmError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use ${MIN_PASSWORD_LENGTH} characters or more for your password`);
      return;
    }
    if (confirm !== password) {
      setConfirmError("Those passwords didn't match. Try again.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password });
      if (error) {
        throw error;
      }
      endRecovery();
      showToast("Password changed");
      router.replace("/");
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Something went wrong. Try again.",
      );
      setSubmitting(false);
    }
  };

  if (!user || !recovering) {
    // Signed in normally: the account page changes the password, after
    // checking the current one.
    const signedIn = Boolean(user);
    return (
      <AuthLayout
        title="Reset password"
        heading={
          signedIn ? "You're signed in" : redirectResult.error ? "Link expired" : "Reset your password"
        }
        actions={
          signedIn ? (
            <ButtonLink href="/account" variant="primary" className="h-10 px-6">
              Go to account
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href={SIGN_IN_PATH} variant="text">
                Sign in
              </ButtonLink>
              <ButtonLink href={FORGOT_PASSWORD_PATH} variant="primary" className="h-10 px-6">
                Send a new link
              </ButtonLink>
            </>
          )
        }
      >
        <p className="text-sm text-fg">
          {signedIn
            ? "To change your password, go to your account page."
            : redirectResult.error
              ? `${redirectResult.error}. Reset links work once and expire after a while, so ask for a new one.`
              : "Open the link from your password reset email to choose a new password, or ask for a new link."}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset password"
      heading="Choose a new password"
      subheading={
        <>
          for <span className="font-medium">{user.email}</span>
        </>
      }
      onSubmit={() => void handleSubmit()}
      actions={
        <Button type="submit" variant="primary" disabled={submitting} className="h-10 px-6">
          {submitting ? "Please wait..." : "Save password"}
        </Button>
      }
    >
      <div className="space-y-6">
        <Field
          id="reset-password"
          label="New password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
          error={passwordError}
        />
        <div>
          <Field
            id="reset-password-confirm"
            label="Confirm"
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={confirmError}
          />
          <ShowPasswordToggle checked={showPassword} onChange={setShowPassword} />
          {passwordError || confirmError ? null : (
            <p className="mt-2 text-xs text-fg-muted">
              Use {MIN_PASSWORD_LENGTH} or more characters.
            </p>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
