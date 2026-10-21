"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { User } from "@supabase/auth-js";

import Icon from "@/components/Icon";
import PageTitle from "@/components/PageTitle";
import { HomeThemeProvider } from "@/components/HomeTheme";
import {
  isAuthPath,
  readAuthSessionHint,
  SIGN_IN_PATH,
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


// Where to go after signing in: the page that sent the visitor to /signin, if
// it's a page of this app, otherwise home.
function readNextPath() {
  try {
    const next = new URLSearchParams(window.location.search).get("next") ?? "";
    return next.startsWith("/") && !next.startsWith("//") && !isAuthPath(next.split("?")[0])
      ? next
      : "/";
  } catch {
    return "/";
  }
}

function Spinner() {
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

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = isAuthPath(pathname);
  // The layout is static, so the session hint cookie is read in the browser.
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

  // Signed out: every app page goes to /signin (proxy.ts already does this
  // on the server when there's no session cookie). Signed in: /signin and
  // /signup go on.
  useEffect(() => {
    if (loading || authError) {
      return;
    }
    if (!user && !isAuthPage) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(
        next === "/" ? SIGN_IN_PATH : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`,
      );
    } else if (user && isAuthPage) {
      router.replace(readNextPath());
    }
  }, [authError, isAuthPage, loading, router, user]);

  if (isAuthPage) {
    if (loading) {
      // Returning visitors are likely signed in and about to move on; the
      // inline script in app/layout.tsx hides the form for them meanwhile.
      return <div data-auth-fallback="">{children}</div>;
    }
    return user ? <Spinner /> : <>{children}</>;
  }

  if (loading) {
    if (isHydrated && hasStoredSession) {
      return (
        <AuthContext.Provider
          value={{ user, loading, cachedUserIdHint: storedUserIdHint, signOut }}
        >
          <HomeThemeProvider>{children}</HomeThemeProvider>
        </AuthContext.Provider>
      );
    }

    // Watch pages are server-rendered shells, safe to show before hydration.
    if (pathname.startsWith("/watch/") || pathname.startsWith("/course/")) {
      return (
        <AuthContext.Provider
          value={{ user, loading, cachedUserIdHint: storedUserIdHint, signOut }}
        >
          <HomeThemeProvider>{children}</HomeThemeProvider>
        </AuthContext.Provider>
      );
    }

    return <Spinner />;
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
      {user ? <HomeThemeProvider>{children}</HomeThemeProvider> : <Spinner />}
    </AuthContext.Provider>
  );
}
