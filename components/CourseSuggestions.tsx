"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useAuth } from "@/components/AuthGate";
import { LibraryThumbnail, useItemChannel } from "@/components/LibraryCard";
import { useLibrary } from "@/components/useLibrary";
import { useThumbnailTint } from "@/components/useThumbnailTint";
import { buildLibrary, sortLibrary, type LibraryItem } from "@/lib/library";
import { preloadYouTubeIframeApi } from "@/lib/youtube-iframe-api";

const MAX_SUGGESTIONS = 3;

function SuggestionRow({ item }: { item: LibraryItem }) {
  const channel = useItemChannel(item);
  const tint = useThumbnailTint(item.thumbnail);
  return (
    <li>
      <Link
        href={item.href}
        onPointerEnter={preloadYouTubeIframeApi}
        onFocus={preloadYouTubeIframeApi}
        className="group relative isolate flex gap-2 rounded-lg"
      >
        <span
          aria-hidden
          style={tint}
          className="card-tint pointer-events-none absolute -inset-1.5 -z-10 scale-95 rounded-xl opacity-0 transition duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 motion-reduce:transition-none"
        />
        <LibraryThumbnail item={item} className="w-[168px] shrink-0" />
        <span className="min-w-0 pt-0.5">
          <span className="line-clamp-2 text-sm leading-5 font-medium">{item.title}</span>
          <span className="mt-1 block truncate text-xs text-fg-muted">{channel}</span>
        </span>
      </Link>
    </li>
  );
}

// youtube.com's "Up next" column, made of the other courses the learner is
// in the middle of, most recently watched first.
export default function CourseSuggestions({
  excludeKind,
  excludeId,
}: {
  excludeKind: LibraryItem["kind"];
  excludeId: string;
}) {
  const { user, cachedUserIdHint } = useAuth();
  const { videos, courses } = useLibrary(user?.id ?? cachedUserIdHint);
  const items = useMemo(() => {
    const inProgress = buildLibrary(videos, courses).filter(
      (item) =>
        item.status === "in-progress" && !(item.kind === excludeKind && item.id === excludeId),
    );
    return sortLibrary(inProgress, "recent").slice(0, MAX_SUGGESTIONS);
  }, [courses, excludeId, excludeKind, videos]);

  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-label="More courses">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <SuggestionRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </ul>
    </section>
  );
}
