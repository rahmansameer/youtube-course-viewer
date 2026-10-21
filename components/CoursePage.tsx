"use client";

import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/AuthGate";
import CourseNotes from "@/components/CourseNotes";
import LessonList from "@/components/LessonList";
import PageTitle from "@/components/PageTitle";
import { Button, IconButton, Menu } from "@/components/ui";
import { useVideoProgress } from "@/components/useVideoProgress";
import { isTypingTarget, useWidePlayer } from "@/components/useWidePlayer";
import WatchLayout, { VideoDetails } from "@/components/WatchLayout";
import {
  NotFound,
  PlayerPlaceholder,
  takeStartParam,
} from "@/components/WatchPage";
import YouTubePlayer, { type PlayerHandle } from "@/components/YouTubePlayer";
import {
  createLessonRecord,
  getCourseLessons,
  getStartTime,
  pickResumeLesson,
  summarizeCourse,
} from "@/lib/library";
import {
  addLessonVideos,
  cacheCourses,
  cacheVideo,
  cacheVideos,
  getCachedCourses,
  getCachedVideos,
  getCourse,
  loadVideosByIds,
  primeVideoCache,
  updateCourse,
  updateVideo,
  type CourseRecord,
  type VideoRecord,
} from "@/lib/storage";
import { showToast } from "@/lib/toast";
import { getPlaylistUrl } from "@/lib/youtube";
import { preloadYouTubeIframeApi } from "@/lib/youtube-iframe-api";
import {
  fetchPlaylist,
  fetchVideoChannel,
  fetchVideoAbout,
  getCachedChannelAvatar,
  getCachedVideoAbout,
  getCachedVideoChannel,
  type ChannelInfo,
  type VideoAbout,
} from "@/lib/youtube-metadata";

const AUTOPLAY_STORAGE_KEY = "youtube-course-viewer-autoplay-next";

function readCachedCourse(userId: string | null | undefined, courseId: string) {
  if (!userId) {
    return null;
  }
  try {
    const course = getCachedCourses(userId)?.find((item) => item.id === courseId);
    if (!course) {
      return null;
    }
    const videosById = new Map(
      (getCachedVideos(userId) ?? []).map((video) => [video.id, video]),
    );
    const lessons = getCourseLessons(course, videosById);
    primeVideoCache(userId, lessons);
    return { course, lessons };
  } catch {
    return null;
  }
}

function readLessonParam() {
  try {
    return new URLSearchParams(window.location.search).get("lesson");
  } catch {
    return null;
  }
}

function readAutoplayPreference() {
  try {
    return window.localStorage.getItem(AUTOPLAY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function isNewer(left: VideoRecord, right: VideoRecord) {
  return (Date.parse(left.updatedAt) || 0) > (Date.parse(right.updatedAt) || 0);
}

// Keeps the home page's cached library in step with changes made here.
function updateLibraryCache(
  userId: string,
  course: CourseRecord,
  addedLessons: VideoRecord[] = [],
) {
  try {
    const courses = getCachedCourses(userId);
    if (courses) {
      cacheCourses(
        userId,
        courses.map((item) => (item.id === course.id ? course : item)),
      );
    }
    const videos = getCachedVideos(userId);
    if (videos && addedLessons.length > 0) {
      const known = new Set(videos.map((video) => video.id));
      cacheVideos(userId, [
        ...videos,
        ...addedLessons.filter((lesson) => !known.has(lesson.id)),
      ]);
    }
  } catch {
    // The next home page load re-caches the library.
  }
}

export default function CoursePage() {
  const params = useParams<{ id: string }>();
  const courseId = typeof params?.id === "string" ? params.id : "";
  const { user, cachedUserIdHint } = useAuth();
  const userId = user?.id;
  const cacheUserId = userId ?? cachedUserIdHint;
  const [course, setCourse] = useState<CourseRecord | null>(null);
  const [lessons, setLessons] = useState<VideoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseError, setCourseError] = useState("");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(
    null,
  );
  // A course opens with its lesson list beside the player; notes come up
  // from the Notes button.
  const [notesOpen, setNotesOpen] = useState(false);
  const [autoplayNext, setAutoplayNext] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { isWidePlayer, toggleWidePlayer } = useWidePlayer();
  const playerHandleRef = useRef<PlayerHandle | null>(null);
  const pendingStartRef = useRef<{ lessonId: string; start: number } | null>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [lessonDescription, setLessonDescription] = useState<VideoAbout | null>(null);

  useEffect(() => {
    preloadYouTubeIframeApi();
  }, []);

  // The page is server-rendered as an empty shell, so browser-only state is
  // read before the first paint instead of during the first render.
  useLayoutEffect(() => {
    setSelectedLessonId(readLessonParam());
    setAutoplayNext(readAutoplayPreference());
    const start = takeStartParam();
    const lessonId = readLessonParam();
    pendingStartRef.current = start !== null && lessonId ? { lessonId, start } : null;
  }, []);

  useLayoutEffect(() => {
    const cached = readCachedCourse(cacheUserId, courseId);
    if (cached) {
      setCourse(cached.course);
      setLessons(cached.lessons);
      setLoading(false);
    }
  }, [cacheUserId, courseId]);

  useEffect(() => {
    if (!userId || !courseId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const found = await getCourse(userId, courseId);
      if (!found) {
        return { found: null, rows: [] as VideoRecord[] };
      }
      return { found, rows: await loadVideosByIds(userId, found.lessonIds) };
    })()
      .then(({ found, rows }) => {
        if (cancelled) {
          return;
        }
        setCourse(found);
        if (!found) {
          setLessons([]);
          return;
        }
        primeVideoCache(userId, rows);
        const ordered = getCourseLessons(
          found,
          new Map(rows.map((row) => [row.id, row])),
        );
        // Progress saved in this tab can be newer than what Supabase returned.
        setLessons((current) => {
          const local = new Map(current.map((lesson) => [lesson.id, lesson]));
          return ordered.map((row) => {
            const localRow = local.get(row.id);
            return localRow && isNewer(localRow, row) ? localRow : row;
          });
        });
        updateLibraryCache(userId, found);
        setCourseError("");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setCourseError(
            loadError instanceof Error
              ? loadError.message
              : "This course could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, userId]);

  const lessonIdSet = useMemo(
    () => new Set(lessons.map((lesson) => lesson.id)),
    [lessons],
  );
  const resumeLessonId =
    lessons.length > 0 ? lessons[pickResumeLesson(lessons)].id : null;
  const currentLessonId =
    selectedLessonId && lessonIdSet.has(selectedLessonId)
      ? selectedLessonId
      : resumeLessonId;

  // Pin the lesson once chosen; otherwise finishing it would move the resume
  // pick, and with it the player, to another lesson.
  useEffect(() => {
    if (currentLessonId && currentLessonId !== selectedLessonId) {
      setSelectedLessonId(currentLessonId);
    }
  }, [currentLessonId, selectedLessonId]);

  const {
    video: lesson,
    loading: lessonLoading,
    error: lessonError,
    saveProgress,
    setCompleted,
    updateNotes,
  } = useVideoProgress(currentLessonId ?? "");

  // The uploader of the playing lesson, with their channel picture: the
  // remembered one before paint (or the playlist's channel), then refreshed.
  const courseChannel = course?.channel ?? "";
  useLayoutEffect(() => {
    if (!currentLessonId) {
      return;
    }
    setChannel(
      getCachedVideoChannel(currentLessonId) ??
        (courseChannel
          ? { name: courseChannel, avatar: getCachedChannelAvatar(courseChannel) }
          : null),
    );
  }, [courseChannel, currentLessonId]);

  useEffect(() => {
    let cancelled = false;
    if (currentLessonId) {
      void fetchVideoChannel(currentLessonId).then((found) => {
        if (!cancelled && found?.name) {
          setChannel(found);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [currentLessonId]);

  // The lesson's YouTube description: remembered before paint, then fetched.
  useLayoutEffect(() => {
    setLessonDescription(currentLessonId ? getCachedVideoAbout(currentLessonId) : null);
  }, [currentLessonId]);

  useEffect(() => {
    let cancelled = false;
    if (currentLessonId) {
      void fetchVideoAbout(currentLessonId).then((found) => {
        if (!cancelled && found !== null) {
          setLessonDescription(found);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [currentLessonId]);

  // A timestamp link from the notes page opens its lesson at that moment.
  useEffect(() => {
    const pending = pendingStartRef.current;
    if (lesson && pending && lesson.id === pending.lessonId) {
      pendingStartRef.current = null;
      saveProgress(pending.start, lesson.duration ?? 0, true);
    }
  }, [lesson, saveProgress]);

  // Mirror the playing lesson's live progress into the lesson list.
  useEffect(() => {
    if (!lesson) {
      return;
    }
    setLessons((current) =>
      current.some((item) => item.id === lesson.id && item !== lesson)
        ? current.map((item) => (item.id === lesson.id ? lesson : item))
        : current,
    );
  }, [lesson]);

  const currentIndex = lessons.findIndex((item) => item.id === currentLessonId);
  const previousLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson =
    currentIndex >= 0 && currentIndex < lessons.length - 1
      ? lessons[currentIndex + 1]
      : null;
  const summary = course ? summarizeCourse(course, lessons) : null;

  // Have the next lesson's description ready before it's opened.
  const nextLessonId = nextLesson?.id;
  useEffect(() => {
    if (!nextLessonId) {
      return;
    }
    const timeout = window.setTimeout(() => void fetchVideoAbout(nextLessonId), 2000);
    return () => window.clearTimeout(timeout);
  }, [nextLessonId]);

  const goToLesson = useCallback((lessonId: string) => {
    setSelectedLessonId(lessonId);
    try {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?lesson=${encodeURIComponent(lessonId)}`,
      );
    } catch {
      // The lesson still changes; only the address bar stays behind.
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (autoplayNext && nextLesson) {
      goToLesson(nextLesson.id);
    }
  }, [autoplayNext, goToLesson, nextLesson]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n" && nextLesson) {
        event.preventDefault();
        goToLesson(nextLesson.id);
      } else if (key === "p" && previousLesson) {
        event.preventDefault();
        goToLesson(previousLesson.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToLesson, nextLesson, previousLesson]);

  const toggleAutoplay = (enabled: boolean) => {
    setAutoplayNext(enabled);
    try {
      window.localStorage.setItem(AUTOPLAY_STORAGE_KEY, String(enabled));
    } catch {
      // Applies for this visit only.
    }
  };

  const toggleLessonCompleted = (target: VideoRecord) => {
    if (target.id === currentLessonId) {
      setCompleted(!target.completed);
      return;
    }
    if (!userId) {
      return;
    }
    const nextRecord: VideoRecord = {
      ...target,
      completed: !target.completed,
      updatedAt: new Date().toISOString(),
    };
    setLessons((current) =>
      current.map((item) => (item.id === target.id ? nextRecord : item)),
    );
    try {
      cacheVideo(userId, nextRecord);
    } catch {
      // Supabase still gets the change below.
    }
    void updateVideo(userId, target.id, { completed: nextRecord.completed }).catch(
      (saveError: unknown) => {
        setCourseError(
          saveError instanceof Error
            ? saveError.message
            : "The lesson could not be updated.",
        );
      },
    );
  };

  const syncWithYouTube = async () => {
    if (!course || !userId || syncing) {
      return;
    }
    setSyncing(true);
    try {
      const playlist = await fetchPlaylist(course.id);
      const known = new Map(lessons.map((item) => [item.id, item]));
      const now = new Date().toISOString();
      const added = playlist.videos
        .filter((video) => !known.has(video.id))
        .map((video) => createLessonRecord(video, course.id, now));
      await addLessonVideos(userId, added);

      // Fill in lengths that weren't known when the course was added.
      const durationFixes = playlist.videos.filter(
        (video) => video.duration && !known.get(video.id)?.duration,
      );
      await Promise.all(
        durationFixes
          .filter((video) => known.has(video.id))
          .map((video) =>
            updateVideo(userId, video.id, {
              duration: video.duration,
              updatedAt: known.get(video.id)?.updatedAt,
            }),
          ),
      );
      for (const video of durationFixes) {
        const existing = known.get(video.id);
        if (existing) {
          known.set(video.id, { ...existing, duration: video.duration });
        }
      }

      const lessonIds = playlist.videos.map((video) => video.id);
      const removedCount = course.lessonIds.filter(
        (id) => !lessonIds.includes(id),
      ).length;
      const nextCourse: CourseRecord = {
        ...course,
        lessonIds,
        thumbnail: course.thumbnail || playlist.thumbnail,
        channel: course.channel || playlist.channel,
      };
      if (
        lessonIds.join() !== course.lessonIds.join() ||
        nextCourse.thumbnail !== course.thumbnail ||
        nextCourse.channel !== course.channel
      ) {
        await updateCourse(userId, course.id, {
          lessonIds,
          thumbnail: nextCourse.thumbnail,
          channel: nextCourse.channel,
        });
      }
      for (const lessonRecord of added) {
        known.set(lessonRecord.id, lessonRecord);
      }
      primeVideoCache(userId, added);
      setCourse(nextCourse);
      setLessons(getCourseLessons(nextCourse, known));
      updateLibraryCache(userId, nextCourse, added);

      const changes = [
        added.length > 0
          ? `${added.length} new lesson${added.length === 1 ? "" : "s"} added`
          : "",
        removedCount > 0
          ? `${removedCount} removed from the playlist`
          : "",
      ].filter(Boolean);
      showToast(changes.length > 0 ? `${changes.join(", ")}.` : "Already up to date.");
    } catch (syncError) {
      showToast(
        syncError instanceof Error ? syncError.message : "The playlist could not be synced.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const toggleNotes = () => setNotesOpen((open) => !open);

  if (!course && !loading) {
    return (
      <NotFound
        title={courseError ? "Couldn't load this course" : "Course not found"}
        message={courseError || "It may have been removed from your courses."}
      />
    );
  }

  const error = courseError || lessonError;
  const playlistUrl = course?.youtubeUrl || (course ? getPlaylistUrl(course.id) : "");
  const courseMenuItems = [
    {
      label: syncing ? "Syncing..." : "Sync playlist",
      icon: "sync" as const,
      onSelect: () => void syncWithYouTube(),
    },
    { label: "Open playlist on YouTube", icon: "openInNew" as const, href: playlistUrl, external: true },
  ];

  return (
    <>
      <PageTitle
        name={lesson && course ? `${lesson.title} · ${course.title}` : (course?.title ?? "Course")}
      />
      <WatchLayout
        theater={isWidePlayer}
        player={
          lesson && lesson.id === currentLessonId ? (
            <YouTubePlayer
              key={lesson.id}
              videoId={lesson.id}
              currentTime={getStartTime(lesson)}
              savedDuration={lesson.duration}
              expanded={isWidePlayer}
              onToggleExpanded={toggleWidePlayer}
              onEnded={handleEnded}
              onTimeUpdate={saveProgress}
              onNext={nextLesson ? () => goToLesson(nextLesson.id) : undefined}
              onPrevious={previousLesson ? () => goToLesson(previousLesson.id) : undefined}
              autoplay={{ enabled: autoplayNext, onChange: toggleAutoplay }}
              handleRef={playerHandleRef}
            />
          ) : (
            <PlayerPlaceholder
              message={
                lessonLoading || !currentLessonId ? undefined : "This lesson could not be loaded."
              }
            />
          )
        }
        details={
          course && lesson ? (
            <VideoDetails
              title={lesson.title}
              owner={channel}
              about={lessonDescription}
              fallbackDescription={course.description}
              onSeek={(seconds) => playerHandleRef.current?.seekTo(seconds)}
              actions={
                <>
                  <Button
                    icon={lesson.completed ? "checkCircle" : "check"}
                    aria-pressed={lesson.completed}
                    onClick={() => setCompleted(!lesson.completed)}
                  >
                    {lesson.completed ? "Completed" : "Mark as complete"}
                  </Button>
                  <Button icon="notes" aria-pressed={notesOpen} onClick={toggleNotes}>
                    Notes
                  </Button>
                  <Menu
                    items={[
                      ...courseMenuItems,
                      {
                        label: "Open lesson on YouTube",
                        icon: "openInNew",
                        href: lesson.youtubeUrl || `https://www.youtube.com/watch?v=${lesson.id}`,
                        external: true,
                      },
                    ]}
                    trigger={(props) => (
                      <IconButton {...props} icon="more" label="More actions" className="bg-chip hover:bg-chip-hover" />
                    )}
                  />
                </>
              }
            />
          ) : null
        }
        secondary={
          <>
            {lesson && notesOpen ? (
              <CourseNotes
                key={lesson.id}
                notes={lesson.notes}
                videoId={lesson.id}
                currentTime={lesson.currentTime}
                onChange={updateNotes}
                onSeek={(seconds) => playerHandleRef.current?.seekTo(seconds)}
                onClose={toggleNotes}
              />
            ) : null}
            {course ? (
              <LessonList
                title={course.title}
                channel={course.channel}
                lessons={lessons}
                currentLessonId={currentLessonId}
                percent={summary?.percent ?? 0}
                completedLessons={summary?.completedLessons ?? 0}
                menuItems={courseMenuItems}
                onSelect={goToLesson}
                onToggleCompleted={toggleLessonCompleted}
              />
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}
