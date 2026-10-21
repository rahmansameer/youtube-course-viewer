"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";

import Icon, { type IconName } from "@/components/Icon";
import { getToast, subscribeToast } from "@/lib/toast";

// ---------- Buttons ----------
//
// One button system for the whole app, following youtube.com:
// - primary: filled, high contrast (like "Subscribe")
// - tonal:   soft gray pill (like "Share" or "Save" under a video)
// - text:    no fill until hovered (dialog actions, "Sort by")
// - link:    blue text (dialog confirm, "Sign in" style actions)

export type ButtonVariant = "primary" | "tonal" | "text" | "link";
export type ButtonSize = "sm" | "md";

export function buttonClasses({
  variant = "tonal",
  size = "md",
  iconOnly = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
} = {}) {
  const sizing = iconOnly
    ? size === "sm"
      ? "h-8 w-8"
      : "h-10 w-10"
    : size === "sm"
      ? "h-8 px-3 text-xs"
      : "h-9 px-4 text-sm";
  const tone = {
    primary: "bg-inverse text-on-inverse hover:opacity-85",
    tonal: "bg-chip text-fg hover:bg-chip-hover",
    text: "text-fg hover:bg-chip",
    link: "text-link hover:bg-link/10",
  }[variant];
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 ${sizing} ${tone} ${className}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
};

export function Button({
  variant = "tonal",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({
        variant,
        size,
        className: `${icon ? (size === "sm" ? "pl-2" : "pl-3") : ""} ${className ?? ""}`,
      })}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 18 : 22} /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "tonal",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
}) {
  return (
    <Link
      className={buttonClasses({
        variant,
        size,
        className: `${icon ? "pl-3" : ""} ${className ?? ""}`,
      })}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 18 : 22} /> : null}
      {children}
    </Link>
  );
}

// Round, transparent icon button (masthead, menus, player-adjacent actions).
export function IconButton({
  icon,
  label,
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-fg transition-colors hover:bg-chip active:bg-chip-hover disabled:pointer-events-none disabled:opacity-40 ${
        size === "sm" ? "h-8 w-8" : "h-10 w-10"
      } ${className}`}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? 20 : 24} />
    </button>
  );
}

// ---------- Chips ----------

export function Chip({
  selected,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors ${
        selected
          ? "bg-inverse text-on-inverse"
          : "bg-chip text-fg hover:bg-chip-hover"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------- Menu ----------

export type MenuItem =
  | {
      label: string;
      icon?: IconName;
      onSelect: () => void;
      danger?: boolean;
      checked?: boolean;
      href?: undefined;
    }
  | {
      label: string;
      icon?: IconName;
      href: string;
      external?: boolean;
      onSelect?: undefined;
      danger?: undefined;
      checked?: undefined;
    }
  | "divider";

type MenuProps = {
  items: MenuItem[];
  // Renders the trigger; spread `triggerProps` onto a button.
  trigger: (triggerProps: {
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
    onClick: () => void;
  }) => ReactNode;
  align?: "left" | "right";
  header?: ReactNode;
  className?: string;
};

type MenuPosition = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
};

export function Menu({
  items,
  trigger,
  align = "right",
  header,
  className = "",
}: MenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const open = position !== null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const shouldOpen = typeof next === "function" ? next(open) : next;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!shouldOpen || !rect) {
      setPosition(null);
      return;
    }
    // The menu is fixed to the viewport (in a portal, so scrolling panels
    // can't clip it) and opens upward when there's more room above.
    const spaceBelow = window.innerHeight - rect.bottom;
    const below = spaceBelow >= 320 || spaceBelow >= rect.top;
    setPosition({
      ...(below
        ? { top: rect.bottom + 4 }
        : { bottom: window.innerHeight - rect.top + 4 }),
      ...(align === "right"
        ? { right: Math.max(8, window.innerWidth - rect.right) }
        : { left: Math.max(8, rect.left) }),
      maxHeight: Math.max(160, (below ? spaceBelow : rect.top) - 16),
    });
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setPosition(null);
      }
    };
    const close = (event: Event) => {
      // Scrolling inside the menu itself is fine.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      setPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosition(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const itemClass =
    "flex h-10 w-full items-center gap-4 px-4 text-left text-sm text-fg transition-colors hover:bg-chip";

  return (
    <div ref={rootRef} className={className}>
      {trigger({
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
        onClick: () => setOpen((value) => !value),
      })}
      {position
        ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={position}
          className="scroll-thin fixed z-[120] min-w-56 overflow-y-auto rounded-xl bg-menu py-2 text-fg shadow-menu ring-1 ring-line"
        >
          {header}
          {items.map((item, index) => {
            if (item === "divider") {
              return <div key={`divider-${index}`} className="my-2 border-t border-line" />;
            }
            const content = (
              <>
                {item.icon ? (
                  <Icon name={item.icon} className={item.danger ? "text-danger" : ""} />
                ) : item.checked !== undefined ? (
                  <span className="inline-flex w-6 justify-center">
                    {item.checked ? <Icon name="check" /> : null}
                  </span>
                ) : null}
                <span className={`flex-1 ${item.danger ? "text-danger" : ""}`}>
                  {item.label}
                </span>
              </>
            );
            if (item.href !== undefined) {
              return item.external ? (
                <a
                  key={item.label}
                  role="menuitem"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={itemClass}
                  onClick={() => setOpen(false)}
                >
                  {content}
                </a>
              ) : (
                <Link
                  key={item.label}
                  role="menuitem"
                  href={item.href}
                  className={itemClass}
                  onClick={() => setOpen(false)}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={item.checked}
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ---------- Dialog ----------

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = "max-w-md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl bg-menu text-fg shadow-menu ${width}`}
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <IconButton icon="close" label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {children}
        </div>
        {footer ? (
          <div className="flex justify-end gap-2 px-6 pt-2 pb-5">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Form fields ----------

export const inputClasses =
  "w-full rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-link";

// ---------- Media ----------

export function DurationBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute right-1 bottom-1 inline-flex items-center gap-1 rounded bg-black/60 px-1 py-px text-xs font-medium text-white tabular-nums">
      {children}
    </span>
  );
}

// YouTube's resume bar: a red line along the bottom of a thumbnail.
export function ResumeBar({ percent }: { percent: number }) {
  if (percent <= 0) {
    return null;
  }
  return (
    <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-[#717171]/60">
      <span
        className="block h-full bg-brand"
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </span>
  );
}

export function ProgressLine({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1 overflow-hidden rounded-full bg-chip-hover"
    >
      <div
        className="h-full rounded-full bg-brand"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

// Letter avatar for channels, which the app has no images for.
export function LetterAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: `hsl(${hash} 45% 45%)`,
      }}
    >
      {letter}
    </span>
  );
}

// ---------- Empty results ----------

// youtube.com's empty state, kept small: a muted icon, a title and one
// line of advice, centered.
export function EmptyResults({
  icon = "search",
  title = "No results found",
  message = "Try different keywords or remove search filters",
}: {
  icon?: IconName;
  title?: string;
  message?: string;
}) {
  return (
    <div role="status" className="flex flex-col items-center px-4 py-24 text-center">
      <Icon name={icon} size={32} className="text-fg-muted" />
      <p className="mt-3 text-base font-medium">{title}</p>
      <p className="mt-1 text-sm text-fg-muted">{message}</p>
    </div>
  );
}

// ---------- Snackbar ----------

export function Toaster() {
  const toast = useSyncExternalStore(subscribeToast, getToast, () => null);
  if (!toast) {
    return null;
  }
  return (
    <div
      role="status"
      className="fixed bottom-6 left-6 z-[110] max-w-[calc(100vw-3rem)] rounded-lg bg-inverse px-4 py-3.5 text-sm text-on-inverse shadow-menu"
    >
      {toast.message}
    </div>
  );
}
