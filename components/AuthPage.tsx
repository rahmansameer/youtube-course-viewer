"use client";

import { useState, type FormEvent } from "react";

import Icon from "@/components/Icon";
import PageTitle from "@/components/PageTitle";
import { Button, Menu } from "@/components/ui";
import { SIGN_IN_PATH, SIGN_UP_PATH, setAuthSessionHint } from "@/lib/auth-session-hint";
import { getSupabaseClient } from "@/lib/supabase";

// Shown in the footer's language menu. Picking one is remembered for the
// visit only; the app itself is in English for now.
const LANGUAGES = [
  "English (United States)",
  "English (United Kingdom)",
  "বাংলা",
  "हिन्दी",
  "اردو",
  "Español",
  "Français",
  "Deutsch",
  "Português (Brasil)",
  "日本語",
];

// Material's outlined text field, as on Google's sign-in page: the label sits
// inside the box and floats onto the border on focus or once filled.
function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  autoFocus = false,
  error,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  error?: string;
}) {
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          placeholder=" "
          aria-invalid={error ? true : undefined}
          className={`peer h-14 w-full rounded-[4px] border bg-transparent px-[15px] text-base text-fg outline-none focus:border-2 focus:px-[14px] ${
            error ? "border-danger focus:border-danger" : "border-field focus:border-link"
          }`}
        />
        <label
          htmlFor={id}
          className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 bg-auth-card px-1 text-base transition-all peer-focus:top-0 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs ${
            error ? "text-danger" : "text-fg-muted peer-focus:text-link"
          }`}
        >
          {label}
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-2 text-xs text-danger">
          <Icon name="close" size={16} className="mt-px" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

// The sign-in / sign-up page at /signin and /signup, laid out like Google's account
// sign-in: a two-column card with the heading on the left and the form on
// the right. AuthGate sends signed-out visitors here and on once signed in.
export default function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const [isSignUp, setIsSignUpState] = useState(mode === "signup");
  // Each mode has its own address, like Google's: /signin and /signup. The
  // switch only rewrites the URL, so whatever was typed stays.
  const setIsSignUp = (signUp: boolean) => {
    setIsSignUpState(signUp);
    try {
      window.history.replaceState(
        null,
        "",
        `${signUp ? SIGN_UP_PATH : SIGN_IN_PATH}${window.location.search}`,
      );
    } catch {
      // The form still switches; only the address bar stays behind.
    }
  };
  const [verifyEmail, setVerifyEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [language, setLanguage] = useState(LANGUAGES[0]);

  const switchMode = () => {
    setIsSignUp(!isSignUp);
    setPassword("");
    setEmailError("");
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailError("");
    setError("");

    if (verifyEmail) {
      setVerifyEmail("");
      setIsSignUp(false);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError("Enter a valid email address");
      return;
    }
    if (isSignUp ? password.length < 6 : !password) {
      setError(isSignUp ? "Use 6 characters or more for your password" : "Enter your password");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          throw signUpError;
        }
        if (!data.session) {
          setAuthSessionHint(null);
          setVerifyEmail(email.trim());
        } else {
          setAuthSessionHint(data.session.user.id);
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          throw signInError;
        }
        setAuthSessionHint(data.session?.user.id ?? null);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const heading = verifyEmail ? "Verify your email" : isSignUp ? "Create an account" : "Sign in";
  const subheading = verifyEmail
    ? null
    : isSignUp
      ? "Enter your email and a password to get started"
      : "to continue to Course Viewer";

  return (
    <div className="flex min-h-screen flex-col items-center bg-auth-card sm:justify-center sm:bg-auth-bg sm:px-4 sm:py-10">
      <PageTitle name={isSignUp ? "Create account" : "Sign in"} />
      <main className="w-full max-w-[1040px] bg-auth-card px-6 pt-10 pb-8 sm:rounded-[28px] sm:p-9">
        <form onSubmit={handleSubmit} noValidate className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          <div>
            <img src="/logo.png" alt="Course Viewer" width={47} height={40} className="h-10 w-auto" />
            <h1 className="mt-6 text-[32px] leading-10 font-normal sm:text-[36px] sm:leading-[44px]">
              {heading}
            </h1>
            {subheading ? <p className="mt-4 text-base text-fg">{subheading}</p> : null}
          </div>

          <div className="flex flex-col md:pt-[76px]">
            {verifyEmail ? (
              <p className="text-sm text-fg">
                We sent a confirmation link to <span className="font-medium">{verifyEmail}</span>.
                Open it, then come back and sign in.
              </p>
            ) : (
              <div className="space-y-6">
                <Field
                  id="auth-email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                  autoFocus
                  error={emailError}
                />
                <div>
                  <Field
                    id="auth-password"
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={setPassword}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    error={error}
                  />
                  <label className="mt-4 inline-flex w-fit cursor-pointer items-center gap-4 text-sm">
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={(event) => setShowPassword(event.target.checked)}
                      className="h-[18px] w-[18px] accent-[var(--fg)]"
                    />
                    Show password
                  </label>
                  {isSignUp && !error ? (
                    <p className="mt-2 text-xs text-fg-muted">Use 6 or more characters.</p>
                  ) : null}
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center justify-end gap-2">
              {verifyEmail ? null : (
                <Button variant="text" onClick={switchMode}>
                  {isSignUp ? "Sign in instead" : "Create account"}
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={submitting} className="h-10 px-6">
                {submitting ? "Please wait..." : verifyEmail ? "Sign in" : "Next"}
              </Button>
            </div>
          </div>
        </form>
      </main>
      <footer className="flex w-full max-w-[1040px] items-center justify-between gap-4 px-6 py-4 text-xs text-fg-muted sm:px-0">
        <Menu
          align="left"
          items={LANGUAGES.map((name) => ({
            label: name,
            checked: name === language,
            onSelect: () => setLanguage(name),
          }))}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label={`Language: ${language}`}
              className="-ml-3 inline-flex items-center gap-2 rounded px-3 py-2 transition-colors hover:bg-chip"
            >
              {language}
              <Icon name="expandMore" size={18} />
            </button>
          )}
        />
        {/* Placeholders until these pages exist. */}
        <nav aria-label="Legal" className="flex gap-1">
          {["Help", "Privacy", "Terms"].map((label) => (
            <a
              key={label}
              href="#"
              onClick={(event) => event.preventDefault()}
              className="rounded px-3 py-2 transition-colors hover:bg-chip"
            >
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
