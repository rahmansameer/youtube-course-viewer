"use client";

import { useEffect, useState, type ReactNode } from "react";

import { fetchLinkTitle } from "@/lib/youtube-metadata";

// Renders a YouTube description the way youtube.com does: *bold*, _italic_
// and -strikethrough- text, shortened links, chips for social profiles,
// channels, videos and playlists, blue hashtags and timestamps that seek.

const HASHTAG_PATTERN = "#[\\p{L}\\p{M}\\p{N}_]+";
const TOKEN = new RegExp(
  `(https?:\\/\\/[^\\s]+|${HASHTAG_PATTERN}|\\b(?:\\d{1,2}:)?\\d{1,2}:\\d{2}\\b)`,
  "gu",
);
// YouTube's formatting: markers hugging the text, not inside words.
const FORMAT = /(?<![\p{L}\p{N}*_-])([*_-])(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}*_-])/gu;
export const HASHTAG = new RegExp(HASHTAG_PATTERN, "gu");

// Sites YouTube shows as "icon / handle" chips.
const SOCIAL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "github.com",
  "tiktok.com",
  "threads.net",
  "discord.gg",
  "discord.com",
  "t.me",
  "telegram.me",
  "reddit.com",
  "pinterest.com",
  "snapchat.com",
  "twitch.tv",
  "patreon.com",
  "medium.com",
  "spotify.com",
  "open.spotify.com",
  "soundcloud.com",
];

type Link =
  | { kind: "external"; url: string }
  | { kind: "social"; url: string; host: string; handle: string }
  | { kind: "channel"; url: string; handle: string }
  | { kind: "video"; url: string; videoId: string }
  | { kind: "playlist"; url: string; playlistId: string };

function classifyLink(raw: string): Link {
  // A trailing period or bracket usually ends the sentence, not the link.
  const url = raw.replace(/[.,)\]!?:;]+$/, "");
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www|m)\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (host === "youtu.be" && segments[0]) {
      return { kind: "video", url, videoId: segments[0] };
    }
    if (host === "youtube.com" || host === "music.youtube.com") {
      const videoId =
        parsed.searchParams.get("v") ??
        (segments[0] === "shorts" || segments[0] === "live" ? segments[1] : null);
      if (videoId) return { kind: "video", url, videoId };
      const playlistId = parsed.searchParams.get("list");
      if (segments[0] === "playlist" && playlistId) {
        return { kind: "playlist", url, playlistId };
      }
      if (segments[0]?.startsWith("@")) {
        return { kind: "channel", url, handle: decodeURIComponent(segments[0]) };
      }
      if (["channel", "c", "user"].includes(segments[0] ?? "") && segments[1]) {
        return { kind: "channel", url, handle: segments[0] === "channel" ? "YouTube channel" : segments[1] };
      }
    }
    const social = SOCIAL_HOSTS.find((name) => host === name || host.endsWith(`.${name}`));
    if (social && segments.length > 0) {
      return { kind: "social", url, host, handle: decodeURIComponent(segments[segments.length === 1 ? 0 : segments[0] === "in" ? 1 : 0]) };
    }
  } catch {
    // Not a URL after all; shown as a plain link.
  }
  return { kind: "external", url };
}

function shorten(url: string) {
  return url.length > 40 ? `${url.slice(0, 37)}...` : url;
}

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

// 18px tall in a 22px line, so chips on neighboring lines keep a small gap.
const chipClass =
  "mx-0.5 inline-flex h-[18px] max-w-full items-center gap-1.5 rounded-full bg-chip-hover/60 px-2 align-middle text-[13px] leading-none text-fg no-underline transition-colors hover:bg-chip-hover";

function Favicon({ host }: { host: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
      alt=""
      width={14}
      height={14}
      className="inline h-3.5 w-3.5 shrink-0 rounded-sm"
    />
  );
}

function LinkTitle({ url, fallback }: { url: string; fallback: string }) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLinkTitle(url).then((found) => {
      if (!cancelled) setTitle(found);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const text = title ?? fallback;
  return <span className="truncate">{text.length > 45 ? `${text.slice(0, 42)}...` : text}</span>;
}

function LinkView({ link }: { link: Link }) {
  const common = { href: link.url, target: "_blank", rel: "noreferrer", onClick: stop } as const;
  switch (link.kind) {
    case "social":
      return (
        <a {...common} className={chipClass}>
          <Favicon host={link.host} />
          <span className="truncate">/ {link.handle}</span>
        </a>
      );
    case "channel":
      return (
        <a {...common} className={chipClass}>
          <Favicon host="youtube.com" />
          <span className="truncate">{link.handle}</span>
        </a>
      );
    case "video":
    case "playlist":
      return (
        <a {...common} className={chipClass}>
          {link.kind === "video" ? (
            <img
              src={`https://i.ytimg.com/vi/${link.videoId}/default.jpg`}
              alt=""
              className="inline h-3 w-[18px] shrink-0 rounded-sm object-cover"
            />
          ) : (
            <Favicon host="youtube.com" />
          )}
          <span className="text-fg-muted">•</span>
          <LinkTitle url={link.url} fallback={link.kind === "video" ? "YouTube video" : "YouTube playlist"} />
        </a>
      );
    default:
      return (
        <a {...common} className="text-link hover:underline">
          {shorten(link.url)}
        </a>
      );
  }
}

function toSeconds(clock: string) {
  return clock.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function hashtagUrl(tag: string) {
  return `https://www.youtube.com/hashtag/${encodeURIComponent(tag.slice(1).toLowerCase())}`;
}

function Linkified({ text, onSeek }: { text: string; onSeek: (seconds: number) => void }) {
  return (
    <>
      {text.split(TOKEN).map((part, index) => {
        if (index % 2 === 0) {
          return part;
        }
        if (part.startsWith("http")) {
          const link = classifyLink(part);
          // Keep punctuation that was trimmed off the link.
          const rest = part.slice(link.url.length);
          return (
            <span key={index}>
              <LinkView link={link} />
              {rest}
            </span>
          );
        }
        if (part.startsWith("#")) {
          return (
            <a
              key={index}
              href={hashtagUrl(part)}
              target="_blank"
              rel="noreferrer"
              onClick={stop}
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

export default function RichDescription({
  text,
  onSeek,
}: {
  text: string;
  onSeek: (seconds: number) => void;
}) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(FORMAT)) {
    const start = match.index ?? 0;
    // Skip markers that are really part of a link, like "-" in a URL.
    const before = text.slice(0, start);
    if (/https?:\/\/\S*$/.test(before) || match[2].includes("://")) continue;
    nodes.push(<Linkified key={`t${cursor}`} text={text.slice(cursor, start)} onSeek={onSeek} />);
    const inner = <Linkified text={match[2]} onSeek={onSeek} />;
    nodes.push(
      match[1] === "*" ? (
        <strong key={`f${start}`} className="font-medium">
          {inner}
        </strong>
      ) : match[1] === "_" ? (
        <em key={`f${start}`}>{inner}</em>
      ) : (
        <s key={`f${start}`}>{inner}</s>
      ),
    );
    cursor = start + match[0].length;
  }
  nodes.push(<Linkified key={`t${cursor}`} text={text.slice(cursor)} onSeek={onSeek} />);
  return <>{nodes}</>;
}
