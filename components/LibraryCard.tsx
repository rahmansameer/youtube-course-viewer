"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import Icon from "@/components/Icon";
import { useThumbnailTint } from "@/components/useThumbnailTint";
import { DurationBadge, IconButton, Menu, ResumeBar, type MenuItem } from "@/components/ui";
import { type LibraryItem } from "@/lib/library";
import { formatDuration } from "@/lib/youtube";
import { preloadYouTubeIframeApi } from "@/lib/youtube-iframe-api";
import { getCachedChannelName, subscribeToChannels } from "@/lib/youtube-metadata";

export type LibraryCardAction = "edit" | "complete" | "reset" | "delete";

type LibraryCardProps = {
  item: LibraryItem;
  // First-row thumbnails are the grid's largest paint; load them eagerly.
  eagerThumbnail?: boolean;
  onAction: (item: LibraryItem, action: LibraryCardAction) => void;
};

// The card's thumbnail; playlists get YouTube's stacked look.
export function LibraryThumbnail({
  item,
  eager = false,
  className = "",
}: {
  item: LibraryItem;
  eager?: boolean;
  className?: string;
}) {
  const isPlaylist = item.kind === "playlist";
  return (
    <div className={`relative aspect-video ${className}`}>
      {isPlaylist ? (
        <>
          <span aria-hidden className="absolute inset-x-4 top-0 h-full rounded-xl bg-chip" />
          <span
            aria-hidden
            className="absolute inset-x-2 top-1 h-full rounded-xl bg-chip-hover"
          />
        </>
      ) : null}
      <div
        className={`absolute inset-x-0 bottom-0 overflow-hidden rounded-xl bg-chip ${
          isPlaylist ? "top-2" : "top-0"
        }`}
      >
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
        {isPlaylist ? (
          <DurationBadge>
            <Icon name="playlist" size={16} />
            {item.lessonCount} lessons
          </DurationBadge>
        ) : item.totalSeconds ? (
          <DurationBadge>{formatDuration(item.totalSeconds)}</DurationBadge>
        ) : null}
        <ResumeBar percent={item.percent} />
      </div>
    </div>
  );
}

export function libraryMenuItems(
  item: LibraryItem,
  onAction: LibraryCardProps["onAction"],
): MenuItem[] {
  return [
    { label: "Edit details", icon: "edit", onSelect: () => onAction(item, "edit") },
    item.status === "completed"
      ? { label: "Reset progress", icon: "replay", onSelect: () => onAction(item, "reset") }
      : {
          label: "Mark as completed",
          icon: "checkCircle",
          onSelect: () => onAction(item, "complete"),
        },
    ...(item.status === "in-progress"
      ? [
          {
            label: "Reset progress",
            icon: "replay",
            onSelect: () => onAction(item, "reset"),
          } as MenuItem,
        ]
      : []),
    { label: "Open on YouTube", icon: "openInNew", href: item.youtubeUrl, external: true },
    "divider",
    {
      label: item.kind === "playlist" ? "Delete course" : "Delete video",
      icon: "delete",
      danger: true,
      onSelect: () => onAction(item, "delete"),
    },
  ];
}

// Playlists know their channel; a single video's channel is looked up in
// the background and fills in when it arrives.
export function useItemChannel(item: LibraryItem) {
  const cachedChannel = useSyncExternalStore(
    subscribeToChannels,
    () => (item.kind === "video" ? getCachedChannelName(item.id) : ""),
    () => "",
  );
  return item.channel || cachedChannel;
}

export default function LibraryCard({
  item,
  eagerThumbnail = false,
  onAction,
}: LibraryCardProps) {
  const channel = useItemChannel(item);
  const tint = useThumbnailTint(item.thumbnail);
  return (
    // self-start: only as tall as this card, not the tallest in its row.
    <article className="group relative isolate flex min-w-0 flex-col self-start">
      {/* YouTube's hover: a card tinted with the thumbnail's color grows in
          behind the video. */}
      <span
        aria-hidden
        style={tint}
        className="card-tint pointer-events-none absolute -inset-x-2 -top-2 -bottom-3 -z-10 scale-95 rounded-2xl opacity-0 transition duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 motion-reduce:transition-none"
      />
      <Link
        href={item.href}
        aria-label={item.title}
        onPointerEnter={preloadYouTubeIframeApi}
        onFocus={preloadYouTubeIframeApi}
        className="block rounded-xl"
      >
        <LibraryThumbnail item={item} eager={eagerThumbnail} />
      </Link>
      <div className="relative mt-3 flex gap-3 pr-8">
        <div className="min-w-0">
          <Link href={item.href} tabIndex={-1}>
            <h3 className="line-clamp-2 text-base leading-5.5 font-medium text-fg">
              {item.title}
            </h3>
          </Link>
          <p className="mt-1 truncate text-sm text-fg-muted">
            {channel || "\u00a0"}
          </p>
        </div>
        <Menu
          className="absolute top-0 -right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          items={libraryMenuItems(item, onAction)}
          trigger={(props) => (
            <IconButton {...props} icon="more" label={`Actions for ${item.title}`} />
          )}
        />
      </div>
    </article>
  );
}
