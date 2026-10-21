"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  cacheCourses,
  cacheVideos,
  getCachedCourses,
  getCachedVideos,
  loadCourses,
  loadVideos,
  subscribeToLibraryCache,
  type CourseRecord,
  type VideoRecord,
} from "@/lib/storage";

// The library (videos + playlist courses) lives in the storage caches, which
// every screen writes to. This hook reads them, revalidates against Supabase
// on mount, and re-renders whenever any screen changes them, so the home
// grid, the sidebar and the notes page always agree.

type LibraryStatus = {
  loading: boolean;
  error: string;
  // Null until a load says whether the playlist migration has run.
  coursesAvailable: boolean | null;
};

export type LibrarySnapshot = LibraryStatus & {
  videos: VideoRecord[];
  courses: CourseRecord[];
  hasCache: boolean;
};

const EMPTY_VIDEOS: VideoRecord[] = [];
const EMPTY_COURSES: CourseRecord[] = [];
const EMPTY: LibrarySnapshot = {
  videos: EMPTY_VIDEOS,
  courses: EMPTY_COURSES,
  hasCache: false,
  loading: false,
  error: "",
  coursesAvailable: null,
};

const statuses = new Map<string, LibraryStatus>();
const inflight = new Map<string, Promise<void>>();
const statusListeners = new Set<() => void>();
let lastSnapshot: { key: unknown[]; value: LibrarySnapshot } | null = null;

function setStatus(userId: string, status: Partial<LibraryStatus>) {
  statuses.set(userId, {
    ...(statuses.get(userId) ?? { loading: false, error: "", coursesAvailable: null }),
    ...status,
  });
  for (const listener of statusListeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  statusListeners.add(listener);
  const unsubscribeCache = subscribeToLibraryCache(listener);
  return () => {
    statusListeners.delete(listener);
    unsubscribeCache();
  };
}

function getSnapshot(userId: string | null | undefined): LibrarySnapshot {
  if (!userId) {
    return EMPTY;
  }
  let videos: VideoRecord[] | null = null;
  let courses: CourseRecord[] | null = null;
  let cacheError = "";
  try {
    videos = getCachedVideos(userId);
    courses = getCachedCourses(userId);
  } catch (error) {
    cacheError =
      error instanceof Error ? error.message : "Your cached library could not be read.";
  }
  const status = statuses.get(userId);
  const key = [userId, videos, courses, status, cacheError];
  // useSyncExternalStore needs the same object back until something changes.
  if (
    lastSnapshot &&
    lastSnapshot.key.length === key.length &&
    lastSnapshot.key.every((part, index) => part === key[index])
  ) {
    return lastSnapshot.value;
  }
  const value: LibrarySnapshot = {
    videos: videos ?? EMPTY_VIDEOS,
    courses: courses ?? EMPTY_COURSES,
    hasCache: videos !== null,
    loading: status?.loading ?? videos === null,
    error: status?.error || cacheError,
    coursesAvailable: status?.coursesAvailable ?? null,
  };
  lastSnapshot = { key, value };
  return value;
}

export function refreshLibrary(userId: string): Promise<void> {
  const running = inflight.get(userId);
  if (running) {
    return running;
  }
  setStatus(userId, { loading: getCachedVideosSafe(userId) === null });
  const request = Promise.all([loadVideos(userId), loadCourses(userId)])
    .then(([videos, courses]) => {
      cacheVideos(userId, videos);
      cacheCourses(userId, courses ?? []);
      setStatus(userId, {
        loading: false,
        error: "",
        coursesAvailable: courses !== null,
      });
    })
    .catch((error: unknown) => {
      setStatus(userId, {
        loading: false,
        error:
          error instanceof Error ? error.message : "Your course library could not be loaded.",
      });
    })
    .finally(() => {
      inflight.delete(userId);
    });
  inflight.set(userId, request);
  return request;
}

function getCachedVideosSafe(userId: string) {
  try {
    return getCachedVideos(userId);
  } catch {
    return null;
  }
}

// Saves a changed library to the caches (Supabase was already updated by the
// caller); every screen using useLibrary re-renders with it.
export function commitLibrary(
  userId: string,
  videos: VideoRecord[],
  courses: CourseRecord[],
) {
  try {
    cacheVideos(userId, videos);
    cacheCourses(userId, courses);
  } catch (error) {
    setStatus(userId, {
      error:
        error instanceof Error
          ? error.message
          : "Your course library could not be cached on this device.",
    });
  }
}

export function setCoursesAvailable(userId: string, available: boolean) {
  setStatus(userId, { coursesAvailable: available });
}

export function useLibrary(userId: string | null | undefined): LibrarySnapshot {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getSnapshot(userId),
    () => EMPTY,
  );

  useEffect(() => {
    if (userId) {
      void refreshLibrary(userId);
    }
  }, [userId]);

  return snapshot;
}
