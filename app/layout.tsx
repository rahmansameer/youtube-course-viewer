import type { Metadata } from "next";
import { Roboto } from "next/font/google";

import AuthGate from "@/components/AuthGate";
import { AUTH_SESSION_HINT_SCRIPT } from "@/lib/auth-session-hint";
import { SITE_NAME } from "@/lib/site";
import { STORAGE_MIGRATION_SCRIPT } from "@/lib/storage-migration";
import "./globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-roboto",
});

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "").origin;
  } catch {
    return null;
  }
})();

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  description:
    "Personal library for tracking long-form YouTube videos and courses.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} h-full antialiased`}
      data-theme="system"
      suppressHydrationWarning
    >
      <head>
        {/* First in <head> so the browser finds the tab icon right away. */}
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32" />
        <script
          dangerouslySetInnerHTML={{
            __html: `${STORAGE_MIGRATION_SCRIPT}
try {
  const mode = localStorage.getItem("youtube-course-viewer-home-theme");
  document.documentElement.dataset.theme =
    mode === "dark" || mode === "light" || mode === "system" ? mode : "system";
} catch {
  document.documentElement.dataset.theme = "system";
}
${AUTH_SESSION_HINT_SCRIPT}`,
          }}
        />
        {SUPABASE_ORIGIN ? (
          // The library request is CORS, so warm an anonymous connection.
          <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
        ) : null}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://yt3.googleusercontent.com" />
      </head>
      <body className="min-h-full bg-canvas text-fg">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
