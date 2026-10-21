"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
import RichDescription, { HASHTAG, hashtagUrl } from "@/components/RichDescription";
import { LetterAvatar } from "@/components/ui";
import { type VideoAbout } from "@/lib/youtube-metadata";

type WatchLayoutProps = {
  theater: boolean;
  player: ReactNode;
  // Title, actions and description under the player.
  details: ReactNode;
  // The right-hand column: notes and the lesson list.
  secondary: ReactNode;
};

// youtube.com's watch page: no sidebar, the player sized to fit the window
// next to a 402px column, or across the full width in theater mode. The
// areas are arranged by CSS grid (.watch-grid in globals.css) so the player
// never moves in the DOM, and switching modes doesn't reload the video.
export default function WatchLayout({
  theater,
  player,
  details,
  secondary,
}: WatchLayoutProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  // --primary-height: from the top of the video to the bottom of the title
  // and channel row, so a side panel can match the left column exactly.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const playerSlot = playerRef.current;
    const detailsSlot = detailsRef.current;
    if (!grid || !playerSlot || !detailsSlot) return;
    const measure = () => {
      const frame = playerSlot.firstElementChild ?? playerSlot;
      const header = detailsSlot.querySelector("[data-video-header]");
      const bottom = (header ?? frame).getBoundingClientRect().bottom;
      const height = Math.round(bottom - frame.getBoundingClientRect().top);
      grid.style.setProperty("--primary-height", `${Math.max(320, height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(playerSlot);
    observer.observe(detailsSlot);
    return () => observer.disconnect();
  }, [theater]);

  return (
    <AppShell guide="drawer">
      <div ref={gridRef} className="watch-grid" data-theater={theater ? "" : undefined}>
        <div ref={playerRef} className="watch-player">{player}</div>
        <div ref={detailsRef} className="watch-details min-w-0">{details}</div>
        <div className="watch-secondary flex min-w-0 flex-col gap-4">{secondary}</div>
      </div>
    </AppShell>
  );
}

type VideoDetailsProps = {
  title: string;
  // Null until the channel is known; a skeleton shows meanwhile.
  owner: { name: string; avatar: string | null } | null;
  actions: ReactNode;
  // The video's YouTube description, views and date; null while loading.
  about: VideoAbout | null;
  // Shown when YouTube has no description (the course's or the user's own).
  fallbackDescription: string;
  onSeek: (seconds: number) => void;
};

const compactViews = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fullViews = new Intl.NumberFormat("en");
const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// "4 years ago", "3 weeks ago", like youtube.com.
function timeAgo(date: Date) {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relativeTime.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

const LINE_PX = 20;
// The box's bottom padding (p-3), so its edge lines up, not its text.
const BOX_PADDING_PX = 12;

// youtube.com's description box: views, date and hashtags in bold on top,
// then the text cut off with "...more" until it's opened. Beside a side
// column (lessons, notes, suggestions) the cut-off text reaches down to the
// bottom of that column; stacked on small screens it shows ten lines.
function DescriptionBox({
  about,
  text,
  onSeek,
}: {
  about: VideoAbout | null;
  text: string;
  onSeek: (seconds: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clampPx, setClampPx] = useState(10 * LINE_PX);
  // The exact room down to the column's bottom; the text is cut on whole
  // lines and the box fills the rest, so its edge lines up exactly.
  const [fillPx, setFillPx] = useState(0);
  const [isLong, setIsLong] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const published = about?.publishDate ? new Date(about.publishDate) : null;
  const hashtags = [...new Set(text.match(HASHTAG) ?? [])].slice(0, 3);

  useLayoutEffect(() => {
    const textEl = textRef.current;
    if (!textEl || expanded) return;
    const grid = textEl.closest(".watch-grid");
    const side = grid?.querySelector(".watch-secondary");
    const measure = () => {
      let height = 10 * LINE_PX;
      let fill = 0;
      if (side) {
        const sideBox = side.getBoundingClientRect();
        const textBox = textEl.getBoundingClientRect();
        const room = sideBox.bottom - textBox.top - BOX_PADDING_PX;
        // Only when the column is beside the description (not below it on
        // small screens) and reaches past its first few lines.
        if (sideBox.left >= textBox.right - 1 && room >= 3 * LINE_PX) {
          height = Math.floor(room / LINE_PX) * LINE_PX;
          fill = Math.floor(room);
        }
      }
      const long = textEl.scrollHeight > height + 1;
      setClampPx(height);
      setIsLong(long);
      setFillPx(long ? fill : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(textEl);
    // The grid resizes when theater mode moves the column under the video.
    if (grid) observer.observe(grid);
    if (side) observer.observe(side);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div
      className={`group mt-3 rounded-xl bg-surface p-3 text-sm leading-5 ${
        expanded ? "" : "cursor-pointer hover:bg-surface-hover"
      }`}
      onClick={() => {
        if (!expanded) {
          setExpanded(true);
        }
      }}
    >
      {about?.viewCount != null || published ? (
        <p className="flex flex-wrap gap-x-2 font-medium">
          {about?.viewCount != null ? (
            <span>
              {expanded
                ? `${fullViews.format(about.viewCount)} views`
                : `${compactViews.format(about.viewCount)} views`}
            </span>
          ) : null}
          {published && !Number.isNaN(published.getTime()) ? (
            <span>
              {expanded
                ? published.toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : timeAgo(published)}
            </span>
          ) : null}
          {hashtags.map((tag) => (
            <a
              key={tag}
              href={hashtagUrl(tag)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="text-link hover:underline"
            >
              {tag}
            </a>
          ))}
        </p>
      ) : null}
      {text ? (
        <div style={expanded || !fillPx ? undefined : { minHeight: fillPx }}>
          <div className="relative">
            <p
              ref={textRef}
              className="overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere]"
              style={expanded ? undefined : { maxHeight: clampPx }}
            >
              <RichDescription text={text} onSeek={onSeek} />
            </p>
            {!expanded && isLong ? (
              <span className="absolute right-0 bottom-0 bg-surface pl-1 font-medium before:absolute before:top-0 before:right-full before:h-full before:w-8 before:bg-gradient-to-r before:from-transparent before:to-surface group-hover:bg-surface-hover group-hover:before:to-surface-hover">
                ...more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {expanded ? (
        <button
          type="button"
          className="mt-4 font-medium"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(false);
          }}
        >
          Show less
        </button>
      ) : !isLong ? (
        <span className="font-medium">...more</span>
      ) : null}
    </div>
  );
}

export function VideoDetails({
  title,
  owner,
  actions,
  about,
  fallbackDescription,
  onSeek,
}: VideoDetailsProps) {
  const text = about?.description.trim() || fallbackDescription.trim();
  return (
    <>
      <div data-video-header>
        <h1 className="mt-3 line-clamp-2 text-xl leading-7 font-bold break-words">{title}</h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {owner?.avatar ? (
              <img
                src={owner.avatar}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-full bg-chip object-cover"
              />
            ) : owner ? (
              <LetterAvatar name={owner.name} size={40} />
            ) : (
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-chip" />
            )}
            {owner ? (
              <p className="min-w-0 truncate text-base font-medium">{owner.name}</p>
            ) : (
              <span aria-hidden className="h-4 w-32 rounded bg-chip" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
      {about || text ? (
        <DescriptionBox key={title} about={about} text={text} onSeek={onSeek} />
      ) : null}
    </>
  );
}
