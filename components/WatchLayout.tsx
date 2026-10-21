"use client";

import { useState, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
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
  return (
    <AppShell guide="drawer">
      <div className="watch-grid" data-theater={theater ? "" : undefined}>
        <div className="watch-player">{player}</div>
        <div className="watch-details min-w-0">{details}</div>
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

// Links, hashtags and timestamps, in that order of precedence.
const LINK_OR_TIME =
  /(https?:\/\/[^\s]+|#[\p{L}\p{M}\p{N}_]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/gu;
const HASHTAG = /#[\p{L}\p{M}\p{N}_]+/gu;

function toSeconds(clock: string) {
  return clock.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function hashtagUrl(tag: string) {
  return `https://www.youtube.com/hashtag/${encodeURIComponent(tag.slice(1).toLowerCase())}`;
}

// Like YouTube: links and hashtags open in a new tab, timestamps seek the
// video.
function LinkifiedText({ text, onSeek }: { text: string; onSeek: (seconds: number) => void }) {
  return (
    <>
      {text.split(LINK_OR_TIME).map((part, index) => {
        if (index % 2 === 0) {
          return part;
        }
        if (part.startsWith("http") || part.startsWith("#")) {
          return (
            <a
              key={index}
              href={part.startsWith("#") ? hashtagUrl(part) : part}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="text-link hover:underline"
            >
              {part}
            </a>
          );
        }
        return (
          <button
            key={index}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSeek(toSeconds(part));
            }}
            className="text-link hover:underline"
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

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

// youtube.com's description box: views, date and hashtags in bold on top,
// three lines with "...more" until it's opened.
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
  const published = about?.publishDate ? new Date(about.publishDate) : null;
  const hashtags = [...new Set(text.match(HASHTAG) ?? [])].slice(0, 3);
  const isLong = text.split("\n").length > 3 || text.length > 240;

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
        <div className="relative">
          <p
            className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${
              expanded ? "" : "line-clamp-3"
            }`}
          >
            <LinkifiedText text={text} onSeek={onSeek} />
          </p>
          {!expanded && isLong ? (
            <span className="absolute right-0 bottom-0 bg-surface pl-1 font-medium before:absolute before:top-0 before:right-full before:h-full before:w-8 before:bg-gradient-to-r before:from-transparent before:to-surface group-hover:bg-surface-hover group-hover:before:to-surface-hover">
              ...more
            </span>
          ) : null}
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
      {about || text ? (
        <DescriptionBox key={title} about={about} text={text} onSeek={onSeek} />
      ) : null}
    </>
  );
}
