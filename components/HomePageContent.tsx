"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AddCourseModal, { type AddCourseValues } from "@/components/AddCourseModal";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/components/AuthGate";
import Icon from "@/components/Icon";
import LibraryCard, { type LibraryCardAction } from "@/components/LibraryCard";
import PageTitle from "@/components/PageTitle";
import { Button, Chip, Dialog, EmptyResults, Menu } from "@/components/ui";
import {
  commitLibrary,
  setCoursesAvailable,
  useLibrary,
} from "@/components/useLibrary";
import {
  buildLibrary,
  createLessonRecord,
  sortLibrary,
  type CourseStatus,
  type LibraryItem,
  type LibrarySort,
} from "@/lib/library";
import {
  cacheVideo,
  cacheVideos,
  COURSES_SETUP_MESSAGE,
  deleteCourse,
  deleteVideo,
  saveCourse,
  saveVideo,
  updateCourse,
  updateVideo,
  updateVideoProgressMany,
  type CourseRecord,
  type VideoRecord,
} from "@/lib/storage";
import { showToast } from "@/lib/toast";
import { getVideoThumbnail } from "@/lib/youtube";
import { fetchVideoDuration } from "@/lib/youtube-iframe-api";
import { prefetchVideoChannels } from "@/lib/youtube-metadata";

type LibraryFilter = "all" | CourseStatus | "playlists" | "videos";

const FILTERS: [LibraryFilter, string][] = [
  ["all", "All"],
  ["in-progress", "In progress"],
  ["not-started", "Not started"],
  ["completed", "Completed"],
  ["playlists", "Playlists"],
  ["videos", "Videos"],
];

const SORTS: [LibrarySort, string][] = [
  ["recent", "Last watched"],
  ["added", "Recently added"],
  ["title", "Title (A–Z)"],
  ["progress", "Most progress"],
];

const VIEW_STORAGE_KEY = "youtube-course-viewer-library-view";

// AuthGate renders the home page only after hydration, so browser storage and
// the URL can be read during the first render.
function readStoredView(): { filter: LibraryFilter; sort: LibrarySort } {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(VIEW_STORAGE_KEY) ?? "null",
    );
    if (typeof value === "object" && value !== null) {
      const { filter, sort } = value as Record<string, unknown>;
      return {
        filter: FILTERS.some(([key]) => key === filter) ? (filter as LibraryFilter) : "all",
        sort: SORTS.some(([key]) => key === sort) ? (sort as LibrarySort) : "recent",
      };
    }
  } catch {
    // Fall back to the defaults below.
  }
  return { filter: "all", sort: "recent" };
}

function readUrlParam(name: string) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function matchesFilter(item: LibraryItem, filter: LibraryFilter) {
  switch (filter) {
    case "all":
      return true;
    case "playlists":
      return item.kind === "playlist";
    case "videos":
      return item.kind === "video";
    default:
      return item.status === filter;
  }
}

function HomePageContent() {
  const { user, cachedUserIdHint } = useAuth();
  const userId = user?.id;
  const libraryUserId = userId ?? cachedUserIdHint;
  const { videos, courses, loading, error, coursesAvailable } = useLibrary(libraryUserId);
  const [isModalOpen, setIsModalOpen] = useState(() => readUrlParam("add") === "1");
  const [editingItem, setEditingItem] = useState<LibraryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [{ filter, sort }, setView] = useState(readStoredView);
  const [query, setQuery] = useState(() => readUrlParam("q") ?? "");

  // Keep ?q= in the address bar in step with the search box.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("add");
      if (query.trim()) {
        url.searchParams.set("q", query.trim());
      } else {
        url.searchParams.delete("q");
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      // Only the address bar is affected.
    }
  }, [query]);

  const updateView = (next: { filter?: LibraryFilter; sort?: LibrarySort }) => {
    setView((current) => {
      const view = { ...current, ...next };
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
      } catch {
        // Only this visit remembers the choice.
      }
      return view;
    });
  };

  const commit = (nextVideos: VideoRecord[], nextCourses: CourseRecord[] = courses) => {
    if (userId) {
      commitLibrary(userId, nextVideos, nextCourses);
    }
  };

  // Videos added before durations were looked up on save (or lessons whose
  // playlist couldn't be read in full) have no length yet; fill them in one
  // at a time in the background.
  const durationLookupsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!userId || loading) {
      return;
    }
    const missing = videos.filter(
      (video) => !video.duration && !durationLookupsRef.current.has(video.id),
    );
    if (missing.length === 0) {
      return;
    }
    for (const video of missing) {
      durationLookupsRef.current.add(video.id);
    }

    void (async () => {
      for (const video of missing) {
        const duration = await fetchVideoDuration(video.id);
        if (!duration) {
          continue;
        }
        try {
          // Keep updated_at: looking up a length isn't watching.
          await updateVideo(userId, video.id, { duration, updatedAt: video.updatedAt });
          cacheVideo(userId, { ...video, duration });
        } catch {
          // Left for the watch page to record.
        }
      }
    })();
  }, [loading, userId, videos]);

  const addCourse = async (values: AddCourseValues): Promise<void> => {
    if (!user) {
      throw new Error("Sign in to save courses.");
    }
    const now = new Date().toISOString();

    if (values.kind === "playlist") {
      const { playlist } = values;
      if (coursesAvailable === false) {
        throw new Error(COURSES_SETUP_MESSAGE);
      }
      if (courses.some((course) => course.id === playlist.id)) {
        throw new Error(
          "This playlist is already in your library. Open it and choose Sync playlist to pick up new videos.",
        );
      }
      const course: CourseRecord = {
        id: playlist.id,
        youtubeUrl: values.youtubeUrl,
        title: values.title,
        description: values.description,
        channel: playlist.channel,
        thumbnail: playlist.thumbnail,
        lessonIds: playlist.videos.map((video) => video.id),
        createdAt: now,
        updatedAt: now,
      };
      const lessons = playlist.videos.map((video) =>
        createLessonRecord(video, playlist.id, now),
      );
      await saveCourse(user.id, course, lessons);
      setCoursesAvailable(user.id, true);
      const known = new Set(videos.map((video) => video.id));
      commit(
        [...videos, ...lessons.filter((lesson) => !known.has(lesson.id))],
        [course, ...courses],
      );
      showToast(`Added to your courses · ${lessons.length} lessons`);
    } else {
      const { videoId } = values;
      const existing = videos.find((video) => video.id === videoId);
      const nextVideo: VideoRecord = existing
        ? {
            ...existing,
            youtubeUrl: values.youtubeUrl,
            title: values.title || existing.title,
            description: values.description,
            thumbnail: existing.thumbnail || getVideoThumbnail(videoId),
            duration: existing.duration ?? (await fetchVideoDuration(videoId)),
            standalone: true,
          }
        : {
            id: videoId,
            youtubeUrl: values.youtubeUrl,
            title: values.title || "Untitled video",
            description: values.description,
            thumbnail: getVideoThumbnail(videoId),
            duration: await fetchVideoDuration(videoId),
            currentTime: 0,
            createdAt: now,
            updatedAt: now,
            notes: "",
            completed: false,
            standalone: true,
          };
      // A lesson row that is now also its own course needs the flag flipped.
      await saveVideo(user.id, nextVideo, {
        writeStandalone: existing ? !existing.standalone : false,
      });
      commit(
        existing
          ? videos.map((video) => (video.id === videoId ? nextVideo : video))
          : [nextVideo, ...videos],
      );
      showToast(existing?.standalone ? "Video updated" : "Added to your courses");
    }
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const editItem = async (item: LibraryItem, values: { title: string; description: string }) => {
    if (!user) {
      throw new Error("Sign in to save courses.");
    }
    if (item.kind === "playlist") {
      await updateCourse(user.id, item.id, values);
      commit(
        videos,
        courses.map((course) => (course.id === item.id ? { ...course, ...values } : course)),
      );
    } else {
      await updateVideo(user.id, item.id, { ...values, updatedAt: item.video?.updatedAt });
      commit(videos.map((video) => (video.id === item.id ? { ...video, ...values } : video)));
    }
    setIsModalOpen(false);
    setEditingItem(null);
    showToast("Changes saved");
  };

  const setItemProgress = async (item: LibraryItem, completed: boolean) => {
    if (!user) {
      return;
    }
    const ids = item.kind === "playlist" ? (item.course?.lessonIds ?? []) : [item.id];
    try {
      // Marking complete keeps positions; resetting starts every lesson over.
      const updatedAt = await updateVideoProgressMany(user.id, ids, {
        completed,
        ...(completed ? {} : { currentTime: 0 }),
      });
      const idSet = new Set(ids);
      const nextVideos = videos.map((video) => {
        if (!idSet.has(video.id)) {
          return video;
        }
        const next = {
          ...video,
          completed,
          currentTime: completed ? video.currentTime : 0,
          updatedAt,
        };
        try {
          // Also replaces the watch page's per-tab copy.
          cacheVideo(user.id, next);
        } catch {
          // The watch page reloads the row from Supabase anyway.
        }
        return next;
      });
      cacheVideos(user.id, nextVideos);
      showToast(completed ? "Marked as completed" : "Progress reset");
    } catch (progressError) {
      showToast(errorMessage(progressError, "The progress could not be updated."));
    }
  };

  const handleAction = (item: LibraryItem, action: LibraryCardAction) => {
    if (action === "edit") {
      setEditingItem(item);
      setIsModalOpen(true);
    } else if (action === "delete") {
      setDeleteTarget(item);
    } else {
      void setItemProgress(item, action === "complete");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !user) {
      return;
    }

    setDeleting(true);
    try {
      if (deleteTarget.kind === "playlist" && deleteTarget.course) {
        const course = deleteTarget.course;
        const otherCourses = courses.filter((item) => item.id !== course.id);
        await deleteCourse(user.id, course, otherCourses);
        const sharedIds = new Set(otherCourses.flatMap((item) => item.lessonIds));
        const removedIds = new Set(course.lessonIds.filter((id) => !sharedIds.has(id)));
        commit(
          videos.filter((video) => video.standalone || !removedIds.has(video.id)),
          otherCourses,
        );
      } else {
        // A video that is also a lesson stays in its course.
        const isLesson = courses.some((course) => course.lessonIds.includes(deleteTarget.id));
        if (isLesson) {
          await updateVideo(user.id, deleteTarget.id, {
            standalone: false,
            updatedAt: deleteTarget.video?.updatedAt,
          });
          commit(
            videos.map((video) =>
              video.id === deleteTarget.id ? { ...video, standalone: false } : video,
            ),
          );
        } else {
          await deleteVideo(user.id, deleteTarget.id);
          commit(videos.filter((video) => video.id !== deleteTarget.id));
        }
      }
      setDeleteTarget(null);
      showToast("Removed from your courses");
    } catch (deleteError) {
      showToast(errorMessage(deleteError, "The course could not be deleted."));
    } finally {
      setDeleting(false);
    }
  };

  const library = useMemo(() => buildLibrary(videos, courses), [videos, courses]);

  // Look up each course's channel while the home page is idle, so the watch
  // page opens with the channel name and picture already known.
  useEffect(() => {
    if (loading || library.length === 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void prefetchVideoChannels(
        library.map((item) =>
          item.kind === "playlist"
            ? (item.resumeLesson?.id ?? item.course?.lessonIds[0] ?? "")
            : item.id,
        ).filter(Boolean),
      );
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [library, loading]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      sortLibrary(
        library.filter(
          (item) =>
            matchesFilter(item, filter) &&
            (!normalizedQuery ||
              item.title.toLowerCase().includes(normalizedQuery) ||
              item.channel.toLowerCase().includes(normalizedQuery) ||
              item.description.toLowerCase().includes(normalizedQuery)),
        ),
        sort,
      ),
    [filter, library, normalizedQuery, sort],
  );

  const openAddModal = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };
  const sortLabel = SORTS.find(([key]) => key === sort)?.[1] ?? "Sort";

  return (
    <AppShell search={{ value: query, onChange: setQuery }} onAddCourse={openAddModal}>
      <PageTitle name="Home" />
      <main className="px-4 pb-16 sm:px-6">
        {loading && library.length === 0 ? (
          <div
            aria-hidden
            className="grid grid-cols-1 gap-x-4 gap-y-10 pt-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index}>
                <div className="aspect-video animate-pulse rounded-xl bg-chip" />
                <div className="mt-3 h-4 w-11/12 animate-pulse rounded bg-chip" />
                <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-chip" />
              </div>
            ))}
          </div>
        ) : error && library.length === 0 ? (
          <div className="mx-auto max-w-md py-24 text-center">
            <p className="text-lg font-medium">Your courses couldn&apos;t load</p>
            <p className="mt-2 text-sm text-fg-muted">{error}</p>
          </div>
        ) : library.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
            <span className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-chip">
              <Icon name="school" size={48} className="text-fg-muted" />
            </span>
            <h1 className="mt-6 text-2xl font-bold">Start your first course</h1>
            <p className="mt-2 text-sm text-fg-muted">
              Paste a YouTube playlist and it becomes a course: lessons in order,
              progress that&apos;s saved, and notes for every lesson.
            </p>
            <Button variant="primary" icon="add" className="mt-6" onClick={openAddModal}>
              Add course
            </Button>
          </div>
        ) : (
          <>
            <div className="sticky top-14 z-20 -mx-4 flex items-center gap-3 bg-canvas px-4 py-3 sm:-mx-6 sm:px-6">
              <div
                role="toolbar"
                aria-label="Filter courses"
                className="flex min-w-0 flex-1 gap-3 overflow-x-auto scrollbar-none"
              >
                {FILTERS.map(([key, label]) => (
                  <Chip
                    key={key}
                    selected={filter === key}
                    onClick={() => updateView({ filter: key })}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
              <Menu
                items={SORTS.map(([key, label]) => ({
                  label,
                  checked: sort === key,
                  onSelect: () => updateView({ sort: key }),
                }))}
                trigger={(props) => (
                  <Button {...props} variant="text" icon="sort" aria-label={`Sort by: ${sortLabel}`}>
                    <span className="max-md:hidden">{sortLabel}</span>
                  </Button>
                )}
              />
            </div>

            {normalizedQuery && visibleItems.length > 0 ? (
              <p className="pt-2 pb-1 text-sm text-fg-muted">
                {visibleItems.length} result{visibleItems.length === 1 ? "" : "s"} for “
                {query.trim()}”
              </p>
            ) : null}

            {visibleItems.length === 0 ? (
              normalizedQuery ? (
                <EmptyResults />
              ) : (
                <EmptyResults
                  icon="school"
                  title={
                    filter === "completed"
                      ? "No completed courses yet"
                      : filter === "in-progress"
                        ? "Nothing in progress"
                        : "Nothing here yet"
                  }
                  message="Courses move here as you watch them"
                />
              )
            ) : (
              <div className="grid grid-cols-1 gap-x-4 gap-y-10 pt-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visibleItems.map((item, index) => (
                  <LibraryCard
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    eagerThumbnail={index < 4}
                    onAction={handleAction}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Dialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "playlist" ? "Delete course?" : "Delete video?"}
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="text" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={deleting} onClick={confirmDelete}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          {deleteTarget?.kind === "playlist"
            ? `“${deleteTarget.title}”, its ${deleteTarget.lessonCount} lessons, and their progress and notes will be removed.`
            : `“${deleteTarget?.title ?? ""}” and its progress and notes will be removed.`}
        </p>
      </Dialog>

      <AddCourseModal
        open={isModalOpen}
        editing={editingItem}
        coursesAvailable={coursesAvailable !== false}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onAdd={addCourse}
        onEdit={editItem}
      />
    </AppShell>
  );
}

export default function HomePage() {
  return <HomePageContent />;
}
