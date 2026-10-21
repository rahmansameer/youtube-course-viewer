import { type CourseRecord, type VideoRecord } from "@/lib/storage";
import { getPlaylistUrl, getVideoThumbnail } from "@/lib/youtube";

export type CourseStatus = "not-started" | "in-progress" | "completed";

// One home-page entry: a single video, or a playlist with its lessons.
export type LibraryItem = {
  kind: "video" | "playlist";
  id: string;
  href: string;
  youtubeUrl: string;
  title: string;
  description: string;
  channel: string;
  thumbnail: string;
  createdAt: string;
  // When the learner last made progress; null if never started.
  lastActivityAt: string | null;
  totalSeconds: number | null;
  watchedSeconds: number;
  lessonCount: number;
  completedLessons: number;
  percent: number;
  status: CourseStatus;
  // For playlists: the lesson "Continue" opens.
  resumeLesson: { id: string; title: string; index: number } | null;
  video?: VideoRecord;
  course?: CourseRecord;
};

// A lesson counts as finished once the learner reaches its last few seconds,
// so end screens and outros don't keep it open.
export function isWatchedToEnd(currentTime: number, duration: number | null) {
  if (!duration || duration <= 0) {
    return false;
  }
  return currentTime >= duration - Math.max(1, Math.min(20, duration * 0.05));
}

// A finished video opens from the start again instead of on its last frame.
export function getStartTime(video: VideoRecord) {
  return video.completed &&
    video.duration &&
    video.currentTime >= video.duration - 20
    ? 0
    : video.currentTime;
}

export function hasStarted(video: VideoRecord) {
  return video.completed || video.currentTime >= 1;
}

export function watchedSeconds(video: VideoRecord) {
  if (video.completed && video.duration) {
    return video.duration;
  }
  return video.duration
    ? Math.min(video.currentTime, video.duration)
    : video.currentTime;
}

function latest(dates: (string | null)[]) {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const date of dates) {
    const time = date ? Date.parse(date) : NaN;
    if (Number.isFinite(time) && time > bestTime) {
      best = date;
      bestTime = time;
    }
  }
  return best;
}

function videoItem(video: VideoRecord): LibraryItem {
  const watched = watchedSeconds(video);
  const percent = video.completed
    ? 100
    : video.duration
      ? Math.min(100, (watched / video.duration) * 100)
      : 0;
  return {
    kind: "video",
    id: video.id,
    href: `/watch?v=${video.id}`,
    youtubeUrl: video.youtubeUrl,
    title: video.title,
    description: video.description,
    channel: "",
    thumbnail: video.thumbnail,
    createdAt: video.createdAt,
    lastActivityAt: hasStarted(video) ? video.updatedAt : null,
    totalSeconds: video.duration,
    watchedSeconds: watched,
    lessonCount: 1,
    completedLessons: video.completed ? 1 : 0,
    percent,
    status: video.completed
      ? "completed"
      : hasStarted(video)
        ? "in-progress"
        : "not-started",
    resumeLesson: null,
    video,
  };
}

// Picks the lesson to continue: the one last watched if it isn't finished,
// otherwise the next unfinished lesson after it, otherwise the first one.
export function pickResumeLesson(lessons: VideoRecord[]): number {
  if (lessons.length === 0) {
    return -1;
  }
  let lastIndex = -1;
  let lastTime = -Infinity;
  lessons.forEach((lesson, index) => {
    const time = Date.parse(lesson.updatedAt);
    if (hasStarted(lesson) && Number.isFinite(time) && time > lastTime) {
      lastIndex = index;
      lastTime = time;
    }
  });
  if (lastIndex === -1) {
    return 0;
  }
  if (!lessons[lastIndex].completed) {
    return lastIndex;
  }
  for (let offset = 1; offset < lessons.length; offset++) {
    const index = (lastIndex + offset) % lessons.length;
    if (!lessons[index].completed) {
      return index;
    }
  }
  return 0;
}

export function getCourseLessons(
  course: CourseRecord,
  videosById: Map<string, VideoRecord>,
) {
  return course.lessonIds
    .map((id) => videosById.get(id))
    .filter((video): video is VideoRecord => video !== undefined);
}

export function summarizeCourse(course: CourseRecord, lessons: VideoRecord[]) {
  const completedLessons = lessons.filter((lesson) => lesson.completed).length;
  const knownDurations = lessons.every((lesson) => lesson.duration);
  const totalSeconds = knownDurations
    ? lessons.reduce((sum, lesson) => sum + (lesson.duration ?? 0), 0)
    : null;
  const watched = lessons.reduce((sum, lesson) => sum + watchedSeconds(lesson), 0);
  const started = lessons.some(hasStarted);
  const lessonCount = lessons.length || course.lessonIds.length;
  const percent =
    lessonCount > 0 && completedLessons === lessonCount
      ? 100
      : totalSeconds
        ? Math.min(100, (watched / totalSeconds) * 100)
        : lessonCount > 0
          ? (completedLessons / lessonCount) * 100
          : 0;
  return {
    completedLessons,
    lessonCount,
    totalSeconds,
    watchedSeconds: watched,
    percent,
    status: (lessonCount > 0 && completedLessons === lessonCount
      ? "completed"
      : started
        ? "in-progress"
        : "not-started") as CourseStatus,
    lastActivityAt: latest(
      lessons.filter(hasStarted).map((lesson) => lesson.updatedAt),
    ),
  };
}

function playlistItem(
  course: CourseRecord,
  videosById: Map<string, VideoRecord>,
): LibraryItem {
  const lessons = getCourseLessons(course, videosById);
  const summary = summarizeCourse(course, lessons);
  const resumeIndex = pickResumeLesson(lessons);
  const resume = lessons[resumeIndex];
  return {
    kind: "playlist",
    id: course.id,
    href: `/course?list=${course.id}`,
    youtubeUrl: course.youtubeUrl || getPlaylistUrl(course.id),
    title: course.title,
    description: course.description,
    channel: course.channel,
    thumbnail: course.thumbnail,
    createdAt: course.createdAt,
    ...summary,
    resumeLesson: resume
      ? {
          id: resume.id,
          title: resume.title,
          index: course.lessonIds.indexOf(resume.id),
        }
      : null,
    course,
  };
}

export function buildLibrary(
  videos: VideoRecord[],
  courses: CourseRecord[],
): LibraryItem[] {
  const videosById = new Map(videos.map((video) => [video.id, video]));
  return [
    ...courses.map((course) => playlistItem(course, videosById)),
    ...videos.filter((video) => video.standalone).map(videoItem),
  ];
}

export type LibrarySort = "recent" | "added" | "title" | "progress";

export function sortLibrary(items: LibraryItem[], sort: LibrarySort) {
  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  return [...items].sort((left, right) => {
    switch (sort) {
      case "added":
        return time(right.createdAt) - time(left.createdAt);
      case "title":
        return left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      case "progress":
        return right.percent - left.percent;
      case "recent":
      default:
        // Recently watched first; never-started items follow, newest first.
        return (
          time(right.lastActivityAt) - time(left.lastActivityAt) ||
          time(right.createdAt) - time(left.createdAt)
        );
    }
  });
}

export function createLessonRecord(
  lesson: { id: string; title: string; duration: number | null },
  playlistId: string,
  now = new Date().toISOString(),
): VideoRecord {
  return {
    id: lesson.id,
    youtubeUrl: `https://www.youtube.com/watch?v=${lesson.id}&list=${playlistId}`,
    title: lesson.title,
    description: "",
    thumbnail: getVideoThumbnail(lesson.id),
    duration: lesson.duration,
    currentTime: 0,
    createdAt: now,
    updatedAt: now,
    notes: "",
    completed: false,
    standalone: false,
  };
}
