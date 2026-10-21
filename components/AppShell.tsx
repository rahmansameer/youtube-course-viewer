"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import profilePhoto from "@/app/profile.jpg";
import { useAuth } from "@/components/AuthGate";
import { useHomeTheme, type ThemeMode } from "@/components/HomeTheme";
import Icon, { type IconName } from "@/components/Icon";
import { Button, Dialog, IconButton, Menu } from "@/components/ui";
import { useLibrary } from "@/components/useLibrary";
import { isTypingTarget } from "@/components/useWidePlayer";
import { buildLibrary, sortLibrary } from "@/lib/library";

type AppShellProps = {
  children: ReactNode;
  // "auto": a sidebar on wide screens (home, notes). "drawer": hidden until
  // the menu button is pressed, so the watch page stays distraction-free.
  guide?: "auto" | "drawer";
  // Live search on the home page; elsewhere the search box opens home.
  search?: { value: string; onChange: (value: string) => void };
  onAddCourse?: () => void;
};

export function Logo() {
  return (
    <Link href="/" aria-label="Course Viewer home" className="flex items-center gap-1.5 px-2 py-4">
      <img src="/favicon.ico" alt="" width={24} height={24} className="h-6 w-6" />
      <span className="text-[19px] font-bold tracking-[-0.04em] text-fg">Course Viewer</span>
    </Link>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play or pause"],
  ["J / L", "Back or forward 10 seconds"],
  ["← / →", "Back or forward 5 seconds"],
  ["M", "Mute or unmute"],
  ["Shift + N", "Next lesson"],
  ["Shift + P", "Previous lesson"],
  ["Shift + . / ,", "Faster or slower"],
  ["T", "Theater mode"],
  ["F", "Fullscreen"],
  ["?", "Show keyboard shortcuts"],
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose}>
      <dl className="divide-y divide-line">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <dt className="text-fg">{action}</dt>
            <dd className="font-mono text-xs text-fg-muted">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function AccountMenu({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { user, signOut } = useAuth();
  const { themeMode, setThemeMode } = useHomeTheme();
  const themes: [ThemeMode, string][] = [
    ["system", "Use device theme"],
    ["dark", "Dark theme"],
    ["light", "Light theme"],
  ];

  return (
    <Menu
      header={
        <>
          <div className="flex items-center gap-3 px-4 pt-2 pb-3">
            <Image src={profilePhoto} alt="" className="h-10 w-10 rounded-full object-cover" />
            <div className="min-w-0">
              <p className="text-xs text-fg-muted">Signed in as</p>
              <p className="truncate text-sm text-fg">{user?.email ?? ""}</p>
            </div>
          </div>
          <div className="mb-2 border-t border-line" />
          <p className="px-4 pt-1 pb-1 text-xs text-fg-muted">Appearance</p>
        </>
      }
      items={[
        ...themes.map(([mode, label]) => ({
          label,
          checked: themeMode === mode,
          onSelect: () => setThemeMode(mode),
        })),
        "divider" as const,
        { label: "Keyboard shortcuts", icon: "keyboard" as IconName, onSelect: onShowShortcuts },
        {
          label: "Sign out",
          icon: "logout" as IconName,
          onSelect: () => {
            void signOut().catch(() => {});
          },
        },
      ]}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label="Account menu"
          className="ml-2 inline-flex h-8 w-8 overflow-hidden rounded-full"
        >
          <Image src={profilePhoto} alt="" className="h-8 w-8 object-cover" priority />
        </button>
      )}
    />
  );
}

function SearchBox({
  search,
  autoFocus = false,
  onDone,
}: {
  search?: AppShellProps["search"];
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [localValue, setLocalValue] = useState("");
  const value = search ? search.value : localValue;
  const setValue = search ? search.onChange : setLocalValue;
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      role="search"
      className="flex w-full max-w-[640px] items-center"
      onSubmit={(event) => {
        event.preventDefault();
        inputRef.current?.blur();
        if (!search) {
          router.push(value.trim() ? `/?q=${encodeURIComponent(value.trim())}` : "/");
        }
        onDone?.();
      }}
    >
      <div className="relative flex h-10 min-w-0 flex-1 items-center rounded-l-full border border-line bg-canvas pl-4 focus-within:border-link">
        <input
          ref={inputRef}
          type="search"
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search your courses"
          aria-label="Search your courses"
          className="h-full min-w-0 flex-1 bg-transparent pr-2 text-base text-fg outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <IconButton
            icon="close"
            label="Clear search"
            className="mr-1"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </div>
      <button
        type="submit"
        aria-label="Search"
        title="Search"
        className="inline-flex h-10 w-16 shrink-0 items-center justify-center rounded-r-full border border-l-0 border-line bg-chip text-fg transition-colors hover:bg-chip-hover"
      >
        <Icon name="search" />
      </button>
    </form>
  );
}

function GuideLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-6 rounded-[10px] px-3 text-sm transition-colors ${
        active ? "bg-chip font-medium hover:bg-chip-hover" : "hover:bg-chip"
      }`}
    >
      <Icon name={icon} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function GuideContent() {
  const pathname = usePathname();
  const { user, cachedUserIdHint } = useAuth();
  const { videos, courses } = useLibrary(user?.id ?? cachedUserIdHint);
  const continueItems = useMemo(
    () =>
      sortLibrary(
        buildLibrary(videos, courses).filter((item) => item.status === "in-progress"),
        "recent",
      ).slice(0, 7),
    [courses, videos],
  );

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3 py-3">
      <GuideLink href="/" icon="home" label="Home" active={pathname === "/"} />
      <GuideLink href="/notes" icon="notes" label="Notes" active={pathname === "/notes"} />
      {continueItems.length > 0 ? (
        <>
          <div className="my-3 border-t border-line" />
          <h2 className="px-3 pt-1 pb-1 text-base font-medium">Continue learning</h2>
          {continueItems.map((item) => (
            <Link
              key={`${item.kind}:${item.id}`}
              href={item.href}
              className="flex h-10 items-center gap-6 rounded-[10px] px-3 text-sm transition-colors hover:bg-chip"
            >
              {item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover"
                />
              ) : (
                <Icon name="playlist" />
              )}
              <span className="truncate">{item.title}</span>
            </Link>
          ))}
        </>
      ) : null}
    </nav>
  );
}

function MiniGuide() {
  const pathname = usePathname();
  const items: [string, IconName, string][] = [
    ["/", "home", "Home"],
    ["/notes", "notes", "Notes"],
  ];
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-1 pt-1">
      {items.map(([href, icon, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="flex h-[74px] flex-col items-center justify-center gap-1.5 rounded-[10px] text-[10px] transition-colors hover:bg-chip"
        >
          <Icon name={icon} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default function AppShell({
  children,
  guide = "auto",
  search,
  onAddCourse,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // On wide screens the menu button collapses the sidebar to icons only.
  const [guideCollapsed, setGuideCollapsed] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleGuide = () => {
    if (guide === "auto" && window.matchMedia("(min-width: 1280px)").matches) {
      setGuideCollapsed((value) => !value);
    } else {
      setDrawerOpen((value) => !value);
    }
  };

  const showSidebar = guide === "auto";
  const contentPadding = showSidebar
    ? guideCollapsed
      ? "md:pl-[72px]"
      : "md:pl-[72px] xl:pl-60"
    : "";

  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-4 bg-canvas px-4">
        {mobileSearch ? (
          <div className="flex w-full items-center gap-2 sm:hidden">
            <IconButton icon="arrowBack" label="Back" onClick={() => setMobileSearch(false)} />
            <SearchBox search={search} autoFocus onDone={() => setMobileSearch(false)} />
          </div>
        ) : null}
        <div className={`flex shrink-0 items-center ${mobileSearch ? "max-sm:hidden" : ""}`}>
          <IconButton icon="menu" label="Guide" onClick={toggleGuide} />
          <Logo />
        </div>
        <div className="hidden min-w-0 flex-1 justify-center sm:flex">
          <SearchBox search={search} />
        </div>
        <div className={`flex shrink-0 items-center gap-1 ${mobileSearch ? "max-sm:hidden" : ""}`}>
          <IconButton
            icon="search"
            label="Search"
            className="sm:hidden"
            onClick={() => setMobileSearch(true)}
          />
          <Button
            icon="add"
            onClick={() => (onAddCourse ? onAddCourse() : router.push("/?add=1"))}
            className="max-sm:w-10 max-sm:px-0 max-sm:pl-0"
            aria-label="Add course"
          >
            <span className="max-sm:hidden">Add course</span>
          </Button>
          <AccountMenu onShowShortcuts={() => setShortcutsOpen(true)} />
        </div>
      </header>

      {showSidebar ? (
        <aside
          className={`scroll-thin fixed top-14 bottom-0 left-0 z-30 hidden overflow-y-auto bg-canvas md:block ${
            guideCollapsed ? "w-[72px]" : "w-[72px] xl:w-60"
          }`}
        >
          <div className={guideCollapsed ? "" : "xl:hidden"}>
            <MiniGuide />
          </div>
          {guideCollapsed ? null : (
            <div className="hidden xl:block">
              <GuideContent />
            </div>
          )}
        </aside>
      ) : null}

      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="scroll-thin absolute top-0 bottom-0 left-0 w-60 overflow-y-auto bg-canvas">
            <div className="flex h-14 items-center px-4">
              <IconButton icon="menu" label="Close guide" onClick={() => setDrawerOpen(false)} />
              <Logo />
            </div>
            <GuideContent />
          </aside>
        </div>
      ) : null}

      <div className={`pt-14 ${contentPadding}`}>{children}</div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
