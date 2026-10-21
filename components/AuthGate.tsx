"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import type { User } from "@supabase/auth-js";

import Icon from "@/components/Icon";
import PageTitle from "@/components/PageTitle";
import { HomeThemeProvider } from "@/components/HomeTheme";
import { Button, Toaster, inputClasses } from "@/components/ui";
import {
  readAuthSessionHint,
  setAuthSessionHint,
} from "@/lib/auth-session-hint";
import { getSupabaseClient, type SupabaseClient } from "@/lib/supabase";
import { clearCachedVideos } from "@/lib/storage";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  cachedUserIdHint: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthGate.");
  }
  return context;
}

const subscribeToNothing = () => () => {};

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The layout is static, so the session hint cookie is read in the browser.
  // Until hydration finishes, "/" renders the sign-in form, which the inline
  // script in app/layout.tsx hides for returning users before first paint.
  const isHydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [{ hasStoredSession, userIdHint: storedUserIdHint }] =
    useState(readAuthSessionHint);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const supabase = useMemo<SupabaseClient | Error>(() => {
    try {
      return getSupabaseClient();
    } catch (error) {
      return error instanceof Error
        ? error
        : new Error("Could not initialize Supabase.");
    }
  }, []);

  useEffect(() => {
    if (supabase instanceof Error) {
      setAuthError(supabase.message);
      setLoading(false);
      return;
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setAuthSessionHint(session?.user.id ?? null);
        setLoading(false);
      },
    );

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          throw error;
        }
        setUser(data.session?.user ?? null);
        setAuthSessionHint(data.session?.user.id ?? null);
        setLoading(false);
      })
      .catch((error: unknown) => {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Could not load your session.",
        );
        setLoading(false);
      });

    return () => authListener.subscription.unsubscribe();
  }, [supabase]);

  const signOut = async () => {
    if (supabase instanceof Error) {
      throw supabase;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    if (user) {
      // The library cache outlives the tab, so don't leave it on a shared device.
      clearCachedVideos(user.id);
    }
    setAuthSessionHint(null);
  };

  if (loading) {
    if (pathname === "/") {
      return (
        <AuthContext.Provider
          value={{ user, loading, cachedUserIdHint: storedUserIdHint, signOut }}
        >
          {isHydrated && hasStoredSession ? (
            <HomeThemeProvider>{children}</HomeThemeProvider>
          ) : (
            <AuthForm hideForStoredSession />
          )}
        </AuthContext.Provider>
      );
    }

    if (pathname.startsWith("/watch/") || pathname.startsWith("/course/")) {
      return (
        <AuthContext.Provider
          value={{ user, loading, cachedUserIdHint: storedUserIdHint, signOut }}
        >
          <HomeThemeProvider>{children}</HomeThemeProvider>
        </AuthContext.Provider>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <PageTitle />
        <span
          role="status"
          aria-label="Connecting to your library"
          className="h-8 w-8 animate-spin rounded-full border-[3px] border-chip-hover border-t-fg-muted"
        />
      </main>
    );
  }

  if (authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <PageTitle name="Error" />
        <div className="max-w-md text-center">
          <Icon name="close" size={40} className="mx-auto mb-3 text-danger" />
          <p role="alert" className="text-sm leading-6 text-fg">
            {authError}
          </p>
        </div>
      </main>
    );
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, cachedUserIdHint: null, signOut }}
    >
      {user ? <HomeThemeProvider>{children}</HomeThemeProvider> : <AuthForm />}
    </AuthContext.Provider>
  );
}

function AuthForm({
  hideForStoredSession = false,
}: {
  hideForStoredSession?: boolean;
}) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
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
          setConfirmationEmail(email.trim());
        } else {
          setAuthSessionHint(data.session.user.id);
        }
      } else {
        const { data, error: signInError } =
          await supabase.auth.signInWithPassword({
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
        submitError instanceof Error
          ? submitError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setIsSignUp((value) => !value);
    setError("");
  };

  if (confirmationEmail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
        <PageTitle name="Check Your Inbox" />
        <section className="w-full max-w-md rounded-xl border border-line p-8 sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight">
            Check your inbox
          </h1>
          <p className="mt-4 text-base text-fg-muted">
            Confirmation link sent to{" "}
            <span className="font-medium text-fg">{confirmationEmail}</span>.
          </p>
          <Button
            variant="primary"
            className="mt-7 h-12 w-full"
            onClick={() => {
              setConfirmationEmail("");
              setIsSignUp(false);
              setError("");
            }}
          >
            Back to sign in
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main
      data-auth-fallback={hideForStoredSession ? "" : undefined}
      className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12"
    >
      <PageTitle name={isSignUp ? "Sign Up" : "Sign In"} />
      <section className="w-full max-w-md rounded-xl border border-line p-8 sm:p-10">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">
          {isSignUp ? "Create account" : "Sign in"}
        </h1>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="auth-email"
              className="mb-2 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              className={`${inputClasses} h-12`}
            />
          </div>
          <div>
            <label
              htmlFor="auth-password"
              className="mb-2 block text-sm font-medium"
            >
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                isSignUp ? "Create a password" : "Enter your password"
              }
              className={`${inputClasses} h-12`}
            />
            {isSignUp ? (
              <p className="mt-2 text-sm text-fg-muted">
                Minimum 6 characters.
              </p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            className="h-12 w-full"
          >
            {submitting ? "Please wait..." : isSignUp ? "Sign up" : "Sign in"}
          </Button>
        </form>

        <p className="mt-7 border-t border-line pt-6 text-center text-sm text-fg-muted">
          {isSignUp ? "Have an account? " : "New here? "}
          <button
            type="button"
            className="font-medium text-link hover:underline"
            onClick={switchMode}
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </section>
    </main>
  );
}
