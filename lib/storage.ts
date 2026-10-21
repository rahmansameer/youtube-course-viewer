"use client";

import { getSupabaseClient } from "@/lib/supabase";

export type VideoRecord = {
  id: string;
  youtubeUrl: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number | null;
  currentTime: number;
  createdAt: string;
  updatedAt: string;
  notes: string;
  completed: boolean;
  // False for playlist lessons that weren't also added on their own; those
  // stay off the home page.
  standalone: boolean;
};

export type CourseRecord = {
  // The YouTube playlist ID.
  id: string;
  youtubeUrl: string;
  title: string;
  description: string;
  channel: string;
  thumbnail: string;
  lessonIds: string[];
  createdAt: string;
  updatedAt: string;
};

type CourseRow = {
  user_id: string;
  id: string;
  youtube_url: string;
  title: string;
  description: string;
  channel: string;
  thumbnail: string;
  lesson_ids: string[];
  created_at: string;
  updated_at: string;
};

type VideoRow = {
  user_id: string;
  id: string;
  youtube_url: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number | null;
  current_time_seconds: number;
  created_at: string;
  updated_at: string;
  notes: string;
  completed: boolean;
  // Missing until supabase/migrations/002_playlist_courses.sql has been run.
  standalone?: boolean;
};

export const COURSES_SETUP_MESSAGE =
  "Playlist courses need a one-time database update. Run supabase/migrations/002_playlist_courses.sql in the Supabase SQL Editor, then try again.";

// PostgREST reports a table or column that doesn't exist yet with these codes.
function isMissingSchemaError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return ["PGRST204", "PGRST205", "42P01", "42703"].includes(code);
}

const LEGACY_STORAGE_KEY = "course-shelf-v1";
const PLAYBACK_CHECKPOINT_PREFIX = "youtube-course-viewer-playback-v1";
const VIDEO_CACHE_PREFIX = "youtube-course-viewer-video-v1";
const VIDEOS_CACHE_PREFIX = "youtube-course-viewer-videos-v1";
const COURSES_CACHE_PREFIX = "youtube-course-viewer-courses-v1";

// Screens that show the library re-read the caches when they change.
const libraryListeners = new Set<() => void>();

export function subscribeToLibraryCache(listener: () => void) {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

function emitLibraryChange() {
  for (const listener of libraryListeners) {
    listener();
  }
}

const videoCache = new Map<string, VideoRecord>();
const videosCache = new Map<string, VideoRecord[]>();
const coursesCache = new Map<string, CourseRecord[]>();

export type PlaybackCheckpoint = {
  currentTime: number;
  duration: number | null;
  savedAt: number;
};

function getPlaybackCheckpointKey(userId: string, id: string) {
  return `${PLAYBACK_CHECKPOINT_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(id)}`;
}

function getVideoCacheKey(userId: string, id: string) {
  return `${VIDEO_CACHE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(id)}`;
}

function getVideosCacheKey(userId: string) {
  return `${VIDEOS_CACHE_PREFIX}:${encodeURIComponent(userId)}`;
}

function getCoursesCacheKey(userId: string) {
  return `${COURSES_CACHE_PREFIX}:${encodeURIComponent(userId)}`;
}

export function getCachedCourses(userId: string): CourseRecord[] | null {
  const key = getCoursesCacheKey(userId);
  const inMemoryCourses = coursesCache.get(key);
  if (inMemoryCourses) {
    return inMemoryCourses;
  }

  let value: unknown;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("The cached playlist courses could not be read.", {
      cause: error,
    });
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const courses = value
    .map((item) => normalizeCourse(item))
    .filter((course): course is CourseRecord => course !== null);
  coursesCache.set(key, courses);
  return courses;
}

export function cacheCourses(userId: string, courses: CourseRecord[]) {
  const key = getCoursesCacheKey(userId);
  coursesCache.set(key, courses);
  emitLibraryChange();
  try {
    window.localStorage.setItem(key, JSON.stringify(courses));
  } catch (error) {
    throw new Error("Your courses could not be cached on this device.", {
      cause: error,
    });
  }
}

// Lets the watch page switch lessons without a round trip: the course page
// loads every lesson row up front and hands them to getCachedVideo.
export function primeVideoCache(userId: string, videos: VideoRecord[]) {
  for (const video of videos) {
    const key = getVideoCacheKey(userId, video.id);
    if (!videoCache.has(key)) {
      videoCache.set(key, video);
    }
  }
}

export function getCachedVideos(userId: string): VideoRecord[] | null {
  const key = getVideosCacheKey(userId);
  const inMemoryVideos = videosCache.get(key);
  if (inMemoryVideos) {
    return inMemoryVideos;
  }

  // The library lives in localStorage so a fresh visit paints instantly from
  // the last known copy while it revalidates; older tabs cached it per session.
  let raw: string | null;
  try {
    raw =
      window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch (error) {
    throw new Error("The cached course library could not be read.", {
      cause: error,
    });
  }
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("The cached course library data is not valid.", {
      cause: error,
    });
  }
  if (!Array.isArray(value)) {
    throw new Error("The cached course library has an unexpected format.");
  }

  const videos = value
    .map((item) => normalizeVideo(item))
    .filter((video): video is VideoRecord => video !== null);
  videosCache.set(key, videos);
  return videos;
}

export function cacheVideos(userId: string, videos: VideoRecord[]) {
  const key = getVideosCacheKey(userId);
  videosCache.set(key, videos);
  emitLibraryChange();
  try {
    window.localStorage.setItem(key, JSON.stringify(videos));
    window.sessionStorage.removeItem(key);
  } catch (error) {
    throw new Error("The course library could not be cached on this device.", {
      cause: error,
    });
  }
}

export function clearCachedVideos(userId: string) {
  const key = getVideosCacheKey(userId);
  const coursesKey = getCoursesCacheKey(userId);
  videosCache.delete(key);
  coursesCache.delete(coursesKey);
  emitLibraryChange();
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(coursesKey);
    window.sessionStorage.removeItem(key);
  } catch (error) {
    throw new Error("The cached course library could not be removed.", {
      cause: error,
    });
  }
}

function updateCachedVideos(userId: string, update: (videos: VideoRecord[]) => VideoRecord[]) {
  const cached = getCachedVideos(userId);
  if (cached) {
    cacheVideos(userId, update(cached));
  }
}

export function getCachedVideo(
  userId: string,
  id: string,
): VideoRecord | null {
  const key = getVideoCacheKey(userId, id);
  const inMemoryVideo = videoCache.get(key);
  if (inMemoryVideo) {
    return inMemoryVideo;
  }

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch (error) {
    throw new Error("The cached video could not be read from this tab.", {
      cause: error,
    });
  }
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("The cached video data is not valid.", { cause: error });
  }

  const video = normalizeVideo(value);
  if (!video || video.id !== id) {
    return null;
  }

  videoCache.set(key, video);
  return video;
}

export function cacheVideo(userId: string, video: VideoRecord) {
  const key = getVideoCacheKey(userId, video.id);
  videoCache.set(key, video);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(video));
  } catch (error) {
    throw new Error("The video could not be cached in this tab.", {
      cause: error,
    });
  }
  updateCachedVideos(userId, (videos) => {
    const existingIndex = videos.findIndex((item) => item.id === video.id);
    if (existingIndex === -1) {
      return videos;
    }
    return videos.map((item) => (item.id === video.id ? video : item));
  });
}

export function clearCachedVideo(userId: string, id: string) {
  const key = getVideoCacheKey(userId, id);
  videoCache.delete(key);
  try {
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(getPlaybackCheckpointKey(userId, id));
  } catch (error) {
    throw new Error("The stale video cache and progress could not be removed.", {
      cause: error,
    });
  }
  updateCachedVideos(userId, (videos) => videos.filter((video) => video.id !== id));
}

export function savePlaybackCheckpoint(
  userId: string,
  id: string,
  currentTime: number,
  duration: number | null,
) {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return;
  }

  const checkpoint: PlaybackCheckpoint = {
    currentTime,
    duration:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : null,
    savedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(
      getPlaybackCheckpointKey(userId, id),
      JSON.stringify(checkpoint),
    );
  } catch (error) {
    throw new Error("Playback progress could not be saved on this device.", {
      cause: error,
    });
  }
}

export function getPlaybackCheckpoint(
  userId: string,
  id: string,
): PlaybackCheckpoint | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(getPlaybackCheckpointKey(userId, id));
  } catch (error) {
    throw new Error("Playback progress could not be read from this device.", {
      cause: error,
    });
  }
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("Saved playback progress is not valid.", { cause: error });
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("currentTime" in value) ||
    typeof value.currentTime !== "number" ||
    !Number.isFinite(value.currentTime) ||
    value.currentTime < 0 ||
    !("savedAt" in value) ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  ) {
    return null;
  }

  return {
    currentTime: value.currentTime,
    duration:
      "duration" in value &&
      typeof value.duration === "number" &&
      Number.isFinite(value.duration) &&
      value.duration > 0
        ? value.duration
        : null,
    savedAt: value.savedAt,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeVideo(value: unknown): VideoRecord | null {
  if (!isObject(value) || typeof value.id !== "string") {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: value.id,
    youtubeUrl: typeof value.youtubeUrl === "string" ? value.youtubeUrl : "",
    title: typeof value.title === "string" ? value.title : "Untitled video",
    description: typeof value.description === "string" ? value.description : "",
    thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : "",
    duration:
      typeof value.duration === "number" && Number.isFinite(value.duration)
        ? value.duration
        : null,
    currentTime:
      typeof value.currentTime === "number" &&
      Number.isFinite(value.currentTime)
        ? value.currentTime
        : 0,
    createdAt:
      typeof value.createdAt === "string" && value.createdAt
        ? value.createdAt
        : now,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : now,
    notes: typeof value.notes === "string" ? value.notes : "",
    completed: Boolean(value.completed),
    standalone: value.standalone !== false,
  };
}

function normalizeCourse(value: unknown): CourseRecord | null {
  if (!isObject(value) || typeof value.id !== "string") {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: value.id,
    youtubeUrl: typeof value.youtubeUrl === "string" ? value.youtubeUrl : "",
    title: typeof value.title === "string" ? value.title : "Untitled course",
    description: typeof value.description === "string" ? value.description : "",
    channel: typeof value.channel === "string" ? value.channel : "",
    thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : "",
    lessonIds: Array.isArray(value.lessonIds)
      ? value.lessonIds.filter((id): id is string => typeof id === "string")
      : [],
    createdAt:
      typeof value.createdAt === "string" && value.createdAt
        ? value.createdAt
        : now,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : now,
  };
}

function courseToRow(userId: string, course: CourseRecord): CourseRow {
  return {
    user_id: userId,
    id: course.id,
    youtube_url: course.youtubeUrl,
    title: course.title,
    description: course.description,
    channel: course.channel,
    thumbnail: course.thumbnail,
    lesson_ids: course.lessonIds,
    created_at: course.createdAt,
    updated_at: course.updatedAt,
  };
}

function courseFromRow(row: CourseRow): CourseRecord {
  return {
    id: row.id,
    youtubeUrl: row.youtube_url,
    title: row.title,
    description: row.description,
    channel: row.channel,
    thumbnail: row.thumbnail,
    lessonIds: row.lesson_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// `standalone` is only sent when it matters, so single videos still save on a
// database that hasn't had the playlist migration yet.
function toRow(
  userId: string,
  video: VideoRecord,
  writeStandalone = false,
): VideoRow {
  return {
    ...(writeStandalone || !video.standalone
      ? { standalone: video.standalone }
      : {}),
    user_id: userId,
    id: video.id,
    youtube_url: video.youtubeUrl,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    duration: video.duration,
    current_time_seconds: video.currentTime,
    created_at: video.createdAt,
    updated_at: video.updatedAt,
    notes: video.notes,
    completed: video.completed,
  };
}

function fromRow(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    youtubeUrl: row.youtube_url,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    duration: row.duration,
    currentTime: row.current_time_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes,
    completed: row.completed,
    standalone: row.standalone !== false,
  };
}

async function importLegacyVideos(userId: string) {
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Your saved browser library could not be read, so it was kept on this device.",
    );
  }

  if (!isObject(parsed) || !Array.isArray(parsed.videos)) {
    throw new Error(
      "Your saved browser library has an unexpected format and was kept on this device.",
    );
  }

  const videos = parsed.videos
    .map((item) => normalizeVideo(item))
    .filter((video): video is VideoRecord => video !== null);

  if (videos.length > 0) {
    const { error } = await getSupabaseClient()
      .from("course_videos")
      .upsert(videos.map((video) => toRow(userId, video)), {
        onConflict: "user_id,id",
        ignoreDuplicates: true,
      });

    if (error) {
      throw error;
    }
  }

  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function loadVideos(userId: string): Promise<VideoRecord[]> {
  await importLegacyVideos(userId);

  const { data, error } = await getSupabaseClient()
    .from("course_videos")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as VideoRow[]).map(fromRow);
}

export async function getVideo(
  userId: string,
  id: string,
): Promise<VideoRecord | null> {
  await importLegacyVideos(userId);

  const { data, error } = await getSupabaseClient()
    .from("course_videos")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? fromRow(data as VideoRow) : null;
}

export async function saveVideo(
  userId: string,
  video: VideoRecord,
  { writeStandalone = false } = {},
) {
  const { error } = await getSupabaseClient()
    .from("course_videos")
    .upsert(toRow(userId, video, writeStandalone), {
      onConflict: "user_id,id",
    });

  if (error) {
    throw error;
  }
}

const ID_CHUNK_SIZE = 150;

function chunk<T>(items: T[], size = ID_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function loadVideosByIds(
  userId: string,
  ids: string[],
): Promise<VideoRecord[]> {
  const pages = await Promise.all(
    chunk(ids).map(async (idChunk) => {
      const { data, error } = await getSupabaseClient()
        .from("course_videos")
        .select("*")
        .eq("user_id", userId)
        .in("id", idChunk);
      if (error) {
        throw error;
      }
      return (data as VideoRow[]).map(fromRow);
    }),
  );
  return pages.flat();
}

// Returns null when the courses table doesn't exist yet, so the library can
// still show single videos before the playlist migration has been run.
export async function loadCourses(
  userId: string,
): Promise<CourseRecord[] | null> {
  const { data, error } = await getSupabaseClient()
    .from("courses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw error;
  }

  return (data as CourseRow[]).map(courseFromRow);
}

export async function getCourse(
  userId: string,
  id: string,
): Promise<CourseRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("courses")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw error;
  }

  return data ? courseFromRow(data as CourseRow) : null;
}

// Adds lesson rows that don't exist yet; rows already in the library keep
// their progress, notes and standalone flag.
export async function addLessonVideos(userId: string, lessons: VideoRecord[]) {
  for (const lessonChunk of chunk(lessons)) {
    const { error } = await getSupabaseClient()
      .from("course_videos")
      .upsert(
        lessonChunk.map((lesson) =>
          toRow(userId, { ...lesson, standalone: false }, true),
        ),
        { onConflict: "user_id,id", ignoreDuplicates: true },
      );
    if (error) {
      if (isMissingSchemaError(error)) {
        throw new Error(COURSES_SETUP_MESSAGE, { cause: error });
      }
      throw error;
    }
  }
}

export async function saveCourse(
  userId: string,
  course: CourseRecord,
  lessons: VideoRecord[],
) {
  await addLessonVideos(userId, lessons);
  const { error } = await getSupabaseClient()
    .from("courses")
    .upsert(courseToRow(userId, course), { onConflict: "user_id,id" });
  if (error) {
    if (isMissingSchemaError(error)) {
      throw new Error(COURSES_SETUP_MESSAGE, { cause: error });
    }
    throw error;
  }
}

export async function updateCourse(
  userId: string,
  id: string,
  updates: Partial<
    Pick<
      CourseRecord,
      "title" | "description" | "channel" | "thumbnail" | "lessonIds"
    >
  >,
) {
  const row: Partial<CourseRow> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.channel !== undefined) row.channel = updates.channel;
  if (updates.thumbnail !== undefined) row.thumbnail = updates.thumbnail;
  if (updates.lessonIds !== undefined) row.lesson_ids = updates.lessonIds;

  const { data, error } = await getSupabaseClient()
    .from("courses")
    .update(row)
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("This course is no longer in your library.");
  }
}

// Removes the course and the lesson rows only it was using. Lessons that are
// also standalone videos or part of another course are kept.
export async function deleteCourse(
  userId: string,
  course: CourseRecord,
  otherCourses: CourseRecord[],
) {
  const { data, error } = await getSupabaseClient()
    .from("courses")
    .delete()
    .eq("user_id", userId)
    .eq("id", course.id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("This course is no longer in your library.");
  }

  const sharedIds = new Set(otherCourses.flatMap((other) => other.lessonIds));
  const orphanIds = course.lessonIds.filter((id) => !sharedIds.has(id));
  for (const idChunk of chunk(orphanIds)) {
    const { error: lessonsError } = await getSupabaseClient()
      .from("course_videos")
      .delete()
      .eq("user_id", userId)
      .eq("standalone", false)
      .in("id", idChunk);
    if (lessonsError) {
      throw lessonsError;
    }
  }
}

export async function updateVideo(
  userId: string,
  id: string,
  updates: Partial<VideoRecord>,
) {
  const row: Partial<VideoRow> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.youtubeUrl !== undefined) row.youtube_url = updates.youtubeUrl;
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.thumbnail !== undefined) row.thumbnail = updates.thumbnail;
  if (updates.duration !== undefined) row.duration = updates.duration;
  if (updates.currentTime !== undefined) {
    row.current_time_seconds = updates.currentTime;
  }
  if (updates.createdAt !== undefined) row.created_at = updates.createdAt;
  if (updates.updatedAt !== undefined) row.updated_at = updates.updatedAt;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.completed !== undefined) row.completed = updates.completed;
  if (updates.standalone !== undefined) row.standalone = updates.standalone;

  const { data, error } = await getSupabaseClient()
    .from("course_videos")
    .update(row)
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("This video is no longer in your library.");
  }
}

// Marks many videos complete, or resets their progress, in a few requests.
export async function updateVideoProgressMany(
  userId: string,
  ids: string[],
  updates: { completed: boolean; currentTime?: number },
) {
  const row: Partial<VideoRow> = {
    completed: updates.completed,
    updated_at: new Date().toISOString(),
  };
  if (updates.currentTime !== undefined) {
    row.current_time_seconds = updates.currentTime;
  }
  for (const idChunk of chunk(ids)) {
    const { error } = await getSupabaseClient()
      .from("course_videos")
      .update(row)
      .eq("user_id", userId)
      .in("id", idChunk);
    if (error) {
      throw error;
    }
  }
  return row.updated_at as string;
}

export async function deleteVideo(userId: string, id: string) {
  const { data, error } = await getSupabaseClient()
    .from("course_videos")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("This video is no longer in your library.");
  }
  clearCachedVideo(userId, id);
}
