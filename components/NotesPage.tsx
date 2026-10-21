"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import AppShell from "@/components/AppShell";
import { useAuth } from "@/components/AuthGate";
import { notesToHtml } from "@/components/CourseNotes";
import PageTitle from "@/components/PageTitle";
import { EmptyResults } from "@/components/ui";
import { useLibrary } from "@/components/useLibrary";
import { type VideoRecord } from "@/lib/storage";

type NoteEntry = {
  video: VideoRecord;
  href: string;
  lessonNumber: number | null;
};

type NoteGroup = {
  id: string;
  title: string;
  href: string | null;
  entries: NoteEntry[];
};

function plainText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// One lesson's notes. Long notes are cut to a fixed height with a fade and
// "Show more", so a page with many notes stays easy to scan.
function NoteCard({
  entry,
  onClickNotes,
}: {
  entry: NoteEntry;
  onClickNotes: (event: MouseEvent<HTMLDivElement>, entry: NoteEntry) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const html = useMemo(() => notesToHtml(entry.video.notes), [entry.video.notes]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && !expanded) {
      setOverflows(body.scrollHeight > body.clientHeight + 1);
    }
  }, [expanded, html]);

  return (
    <li className="pt-5">
      <Link href={entry.href} className="hover:underline">
        <h3 className="line-clamp-2 text-base leading-5.5 font-medium">
          {entry.lessonNumber ? `${entry.lessonNumber}. ` : ""}
          {entry.video.title}
        </h3>
      </Link>
      <div className="mt-2">
        <div className="rounded-xl bg-surface px-4 py-3">
          <div className="relative">
            <div
              ref={bodyRef}
              className={`course-notes-editor text-sm leading-6 [overflow-wrap:anywhere] ${
                expanded ? "" : "max-h-48 overflow-hidden"
              }`}
              onClick={(event) => onClickNotes(event, entry)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {overflows && !expanded ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent"
              />
            ) : null}
          </div>
          {overflows ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-2 text-sm font-medium"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function NotesPage() {
  const router = useRouter();
  const { user, cachedUserIdHint } = useAuth();
  const { videos, courses, loading } = useLibrary(user?.id ?? cachedUserIdHint);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const byId = new Map(videos.map((video) => [video.id, video]));
    const hasNotes = (video: VideoRecord | undefined): video is VideoRecord =>
      Boolean(video && plainText(video.notes));
    const result: NoteGroup[] = [];
    const shown = new Set<string>();

    for (const course of courses) {
      const entries = course.lessonIds.flatMap((id, index) => {
        const video = byId.get(id);
        if (!hasNotes(video)) {
          return [];
        }
        shown.add(id);
        return [{ video, href: `/course?list=${course.id}&v=${id}`, lessonNumber: index + 1 }];
      });
      if (entries.length > 0) {
        result.push({
          id: course.id,
          title: course.title,
          href: `/course?list=${course.id}`,
          entries,
        });
      }
    }

    const singles = videos
      .filter((video) => video.standalone && !shown.has(video.id) && hasNotes(video))
      .map((video) => ({ video, href: `/watch?v=${video.id}`, lessonNumber: null }));
    if (singles.length > 0) {
      result.push({ id: "videos", title: "Videos", href: null, entries: singles });
    }
    return result;
  }, [courses, videos]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = normalizedQuery
    ? groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter(
            ({ video }) =>
              video.title.toLowerCase().includes(normalizedQuery) ||
              group.title.toLowerCase().includes(normalizedQuery) ||
              plainText(video.notes).toLowerCase().includes(normalizedQuery),
          ),
        }))
        .filter((group) => group.entries.length > 0)
    : groups;
  const noteCount = groups.reduce((sum, group) => sum + group.entries.length, 0);

  // Timestamps open the lesson here, at that moment, instead of on YouTube.
  const openTimestamp = (event: MouseEvent<HTMLDivElement>, entry: NoteEntry) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    event.preventDefault();
    try {
      const url = new URL(link.href);
      const seconds = Number(url.searchParams.get("t")?.replace(/s$/, ""));
      if (url.searchParams.get("v") === entry.video.id && Number.isFinite(seconds)) {
        router.push(`${entry.href}${entry.href.includes("?") ? "&" : "?"}t=${seconds}`);
        return;
      }
    } catch {
      // Not a URL we understand; open it as a normal link.
    }
    window.open(link.href, "_blank", "noopener,noreferrer");
  };

  return (
    <AppShell search={{ value: query, onChange: setQuery }}>
      <PageTitle name="Notes" />
      <main className="max-w-[1280px] px-4 pt-6 pb-16 sm:px-6">
        <h1 className="text-4xl font-bold">Notes</h1>
        {noteCount > 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            {noteCount} note{noteCount === 1 ? "" : "s"}
          </p>
        ) : null}

        {loading && groups.length === 0 ? (
          <div className="mt-10 space-y-6" aria-hidden>
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-chip" />
                <div className="h-16 animate-pulse rounded-xl bg-chip" />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyResults
            icon="notes"
            title="No notes yet"
            message="Notes you write while watching show up here"
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyResults />
        ) : (
          <div className="mt-2">
            {visibleGroups.map((group) => (
              <section key={group.id} className="pt-10">
                <h2 className="text-xl font-bold">
                  {group.href ? (
                    <Link href={group.href} className="hover:underline">
                      {group.title}
                    </Link>
                  ) : (
                    group.title
                  )}
                </h2>
                <ul>
                  {group.entries.map((entry) => (
                    <NoteCard key={entry.video.id} entry={entry} onClickNotes={openTimestamp} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
