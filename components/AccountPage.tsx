"use client";

import Image from "next/image";
import { useState, type FormEvent, type ReactNode } from "react";

import profilePhoto from "@/app/profile.jpg";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/components/AuthGate";
import {
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  sendPasswordResetEmail,
} from "@/components/AuthPage";
import PageTitle from "@/components/PageTitle";
import { Button, inputClasses } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { showToast } from "@/lib/toast";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line p-5 sm:p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-fg-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function TextInput({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  invalid = false,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  invalid?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        className={`${inputClasses} ${invalid ? "border-danger focus:border-danger" : ""}`}
      />
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`text-sm ${tone === "error" ? "text-danger" : "text-fg"}`}
    >
      {children}
    </p>
  );
}

function EmailSection() {
  const { user, redirectResult } = useAuth();
  const currentEmail = user?.email ?? "";
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  // Set once Supabase has sent the confirmation link(s).
  const [sentTo, setSentTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // An email change waiting for its confirmation link to be opened.
  const pendingEmail = sentTo || user?.new_email || "";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const next = email.trim();
    if (!isValidEmail(next)) {
      setError("Enter a valid email address");
      return;
    }
    if (next.toLowerCase() === currentEmail.toLowerCase()) {
      setError("That's already your email address");
      return;
    }
    setSubmitting(true);
    try {
      const { error: updateError } = await getSupabaseClient().auth.updateUser(
        { email: next },
        { emailRedirectTo: `${window.location.origin}/account` },
      );
      if (updateError) {
        throw updateError;
      }
      setSentTo(next);
      setEmail("");
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Section
      title="Email"
      description="The address you sign in with. A new address only takes effect once you confirm it."
    >
      <div className="mb-5 flex items-center gap-3">
        <Image src={profilePhoto} alt="" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">Current email</p>
          <p className="truncate text-sm">{currentEmail}</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {redirectResult.message ? <Notice tone="info">{redirectResult.message}</Notice> : null}
        {redirectResult.error ? <Notice tone="error">{redirectResult.error}</Notice> : null}
        {pendingEmail ? (
          <Notice tone="info">
            We sent a confirmation link to <span className="font-medium">{pendingEmail}</span>.
            Open it to finish the change. If your old address also gets a link, open that one
            too.
          </Notice>
        ) : null}
        <TextInput
          id="account-new-email"
          label="New email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          invalid={Boolean(error)}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={submitting || !email.trim()}>
            {submitting ? "Please wait..." : "Change email"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const { user } = useAuth();
  const email = user?.email ?? "";
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ field: "current" | "new" | "confirm"; message: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!current) {
      setError({ field: "current", message: "Enter your current password" });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({
        field: "new",
        message: `Use ${MIN_PASSWORD_LENGTH} characters or more for your password`,
      });
      return;
    }
    if (confirm !== password) {
      setError({ field: "confirm", message: "Those passwords didn't match. Try again." });
      return;
    }
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      // Signing in again checks the current password, and the fresh session
      // also satisfies Supabase's "secure password change" setting.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signInError) {
        setError({
          field: "current",
          message:
            signInError.code === "invalid_credentials"
              ? "Wrong password. Try again."
              : signInError.message,
        });
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw updateError;
      }
      setCurrent("");
      setPassword("");
      setConfirm("");
      showToast("Password changed");
    } catch (submitError) {
      setError({ field: "new", message: errorMessage(submitError) });
    } finally {
      setSubmitting(false);
    }
  };

  const sendReset = async () => {
    setSendingReset(true);
    try {
      await sendPasswordResetEmail(email);
      showToast(`Reset link sent to ${email}`);
    } catch (resetError) {
      showToast(errorMessage(resetError));
    } finally {
      setSendingReset(false);
    }
  };

  const type = showPassword ? "text" : "password";
  return (
    <Section
      title="Password"
      description={`Use ${MIN_PASSWORD_LENGTH} or more characters. You need your current password to change it.`}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Lets password managers file the new password under this account. */}
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <TextInput
          id="account-current-password"
          label="Current password"
          type={type}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          invalid={error?.field === "current"}
        />
        <TextInput
          id="account-new-password"
          label="New password"
          type={type}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalid={error?.field === "new"}
        />
        <TextInput
          id="account-confirm-password"
          label="Confirm new password"
          type={type}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={error?.field === "confirm"}
        />
        {error ? <Notice tone="error">{error.message}</Notice> : null}
        <label className="inline-flex w-fit cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
            className="h-4 w-4 accent-[var(--fg)]"
          />
          Show passwords
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="link" onClick={() => void sendReset()} disabled={sendingReset}>
            {sendingReset ? "Sending..." : "Forgot password?"}
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Please wait..." : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

// /account: change the sign-in email and password. Opened from the
// account menu.
export default function AccountPage() {
  const { user } = useAuth();
  return (
    <AppShell>
      <PageTitle name="Account" />
      <main className="max-w-[1280px] px-4 pt-6 pb-16 sm:px-6">
        <h1 className="text-4xl font-bold">Account</h1>
        <p className="mt-2 text-sm text-fg-muted">Manage how you sign in to Course Viewer</p>
        {user ? (
          <div className="mt-8 max-w-2xl space-y-6">
            <EmailSection />
            <PasswordSection />
          </div>
        ) : (
          <div className="mt-8 max-w-2xl space-y-6" aria-hidden>
            {[0, 1].map((index) => (
              <div key={index} className="h-64 animate-pulse rounded-xl bg-chip" />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
