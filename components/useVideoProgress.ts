"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/AuthGate";
import { isWatchedToEnd } from "@/lib/library";
import {
  cacheVideo,
  clearCachedVideo,
  getCachedVideo,
  getCachedVideos,
  getPlaybackCheckpoint,
  getVideo,
  savePlaybackCheckpoint,
  updateVideo,
  type VideoRecord,
} from "@/lib/storage";

// Loads one video row and keeps its playback progress and notes saved: on
// this device every second, and in Supabase every few seconds and on pause.
// Used by the single-video watch page and for each lesson of a course.
export function useVideoProgress(videoId: string) {
  const { user, cachedUserIdHint } = useAuth();
  const userId = user?.id;
  const cacheUserId = userId ?? cachedUserIdHint;
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const videoRef = useRef<VideoRecord | null>(null);
  const videoOwnerRef = useRef("");
  const progressSaveRef = useRef<Promise<void>>(Promise.resolve());
  const lastRemoteProgressSaveRef = useRef(0);
  const notesSaveTimeoutRef = useRef<number | null>(null);
  const pendingNotesRef = useRef<string | null>(null);
  const lastSavedSnapshotRef = useRef<{
    currentTime: number;
    duration: number | null;
  } | null>(null);

  const restorePlaybackCheckpoint = useCallback(
    (found: VideoRecord | null) => {
      if (!found || !cacheUserId) {
        return found;
      }

      const checkpoint = getPlaybackCheckpoint(cacheUserId, videoId);
      const serverUpdatedAt = Date.parse(found.updatedAt);
      if (
        !checkpoint ||
        (Number.isFinite(serverUpdatedAt) &&
          checkpoint.savedAt <= serverUpdatedAt)
      ) {
        return found;
      }

      return {
        ...found,
        currentTime: checkpoint.currentTime,
        duration: checkpoint.duration ?? found.duration,
        completed:
          found.completed ||
          isWatchedToEnd(checkpoint.currentTime, checkpoint.duration),
      };
    },
    [cacheUserId, videoId],
  );

  useEffect(() => {
    if (!userId || !videoId) {
      return;
    }

    let cancelled = false;
    setError("");
    const owner = `${userId}:${videoId}`;
    if (videoOwnerRef.current !== owner) {
      videoOwnerRef.current = owner;
      videoRef.current = null;
      setVideo(null);
      lastSavedSnapshotRef.current = null;
      setLoading(true);
    }

    void getVideo(userId, videoId)
      .then((found) => {
        if (!cancelled) {
          const restored = restorePlaybackCheckpoint(found);
          setVideo(restored);
          videoRef.current = restored;
          lastSavedSnapshotRef.current = restored
            ? {
                currentTime: Math.round(restored.currentTime),
                duration: restored.duration,
              }
            : null;
          if (restored) {
            cacheVideo(userId, restored);
          } else {
            clearCachedVideo(userId, videoId);
          }
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "This video could not be loaded.",
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
  }, [videoId, userId, restorePlaybackCheckpoint]);

  useLayoutEffect(() => {
    if (!cacheUserId || !videoId) {
      return;
    }

    lastSavedSnapshotRef.current = null;
    videoOwnerRef.current = `${cacheUserId}:${videoId}`;
    try {
      const cachedVideo =
        getCachedVideo(cacheUserId, videoId) ??
        getCachedVideos(cacheUserId)?.find((item) => item.id === videoId) ??
        null;
      const cached = restorePlaybackCheckpoint(cachedVideo);
      if (cached) {
        videoRef.current = cached;
        setVideo(cached);
        lastSavedSnapshotRef.current = {
          currentTime: Math.round(cached.currentTime),
          duration: cached.duration,
        };
        setLoading(false);
        setError("");
      } else {
        videoRef.current = null;
        setVideo(null);
        setLoading(true);
      }
    } catch (cacheError) {
      setError(
        cacheError instanceof Error
          ? cacheError.message
          : "The cached video could not be restored.",
      );
    }
  }, [cacheUserId, videoId, restorePlaybackCheckpoint]);

  const persistUpdate = useCallback(
    (updates: Partial<VideoRecord>, fallbackMessage: string) => {
      if (!userId) {
        return;
      }
      progressSaveRef.current = progressSaveRef.current
        .then(() => updateVideo(userId, videoId, updates))
        .catch((saveError: unknown) => {
          setError(
            saveError instanceof Error ? saveError.message : fallbackMessage,
          );
        });
    },
    [userId, videoId],
  );

  const saveProgress = useCallback(
    (currentTime: number, duration: number, forcePersist = false) => {
      // A player that is being replaced can still report its last position;
      // never apply it to the next lesson.
      if (!videoRef.current || videoRef.current.id !== videoId || !userId) {
        return;
      }

      const safeDuration =
        duration > 0 ? duration : (videoRef.current.duration ?? null);
      const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
      const previous = videoRef.current;
      const roundedCurrent = Math.round(safeCurrentTime);
      const lastSnapshot = lastSavedSnapshotRef.current;
      try {
        cacheVideo(userId, {
          ...previous,
          currentTime: safeCurrentTime,
          duration: safeDuration,
        });
        savePlaybackCheckpoint(userId, videoId, safeCurrentTime, safeDuration);
      } catch (checkpointError) {
        setError(
          checkpointError instanceof Error
            ? checkpointError.message
            : "Playback progress could not be saved on this device.",
        );
      }
      const isSameProgress =
        previous &&
        lastSnapshot &&
        lastSnapshot.currentTime === roundedCurrent &&
        lastSnapshot.duration === safeDuration;

      if (isSameProgress) {
        if (!forcePersist) {
          return;
        }
      }

      // Finishing a lesson is permanent; rewatching part of it later doesn't
      // mark it unfinished again (the learner can still do that by hand).
      const isCompleted =
        previous.completed || isWatchedToEnd(safeCurrentTime, safeDuration);

      const nextVideo: VideoRecord = {
        ...previous,
        currentTime: safeCurrentTime,
        duration: safeDuration,
        updatedAt: new Date().toISOString(),
        completed: isCompleted,
      };

      lastSavedSnapshotRef.current = {
        currentTime: roundedCurrent,
        duration: safeDuration,
      };
      videoRef.current = nextVideo;
      setVideo((prev) => {
        if (!prev || prev.id !== videoId) {
          return prev;
        }

        const prevRounded = Math.round(prev.currentTime);
        if (
          prevRounded === roundedCurrent &&
          prev.duration === safeDuration &&
          prev.completed === isCompleted
        ) {
          return prev;
        }

        return nextVideo;
      });

      const now = Date.now();
      if (
        !forcePersist &&
        isCompleted === previous.completed &&
        now - lastRemoteProgressSaveRef.current < 5000
      ) {
        return;
      }
      lastRemoteProgressSaveRef.current = now;
      persistUpdate(
        {
          currentTime: safeCurrentTime,
          duration: safeDuration,
          completed: isCompleted,
        },
        "Playback progress could not be saved.",
      );
    },
    [persistUpdate, userId, videoId],
  );

  const setCompleted = useCallback(
    (completed: boolean) => {
      const previous = videoRef.current;
      if (!previous || previous.id !== videoId || !userId) {
        return;
      }
      const nextVideo: VideoRecord = {
        ...previous,
        completed,
        updatedAt: new Date().toISOString(),
      };
      videoRef.current = nextVideo;
      setVideo(nextVideo);
      try {
        cacheVideo(userId, nextVideo);
      } catch (cacheError) {
        setError(
          cacheError instanceof Error
            ? cacheError.message
            : "The video could not be cached in this tab.",
        );
      }
      persistUpdate({ completed }, "The lesson could not be updated.");
    },
    [persistUpdate, userId, videoId],
  );

  const persistNotes = useCallback(
    (notes: string) => {
      if (!userId) {
        return;
      }
      void updateVideo(userId, videoId, { notes }).catch(
        (saveError: unknown) => {
          setError(
            saveError instanceof Error
              ? saveError.message
              : "Your notes could not be saved.",
          );
        },
      );
    },
    [userId, videoId],
  );

  const updateNotes = useCallback(
    (notes: string) => {
      if (!videoRef.current || videoRef.current.id !== videoId) {
        return;
      }

      const nextVideo = { ...videoRef.current, notes };
      if (userId) {
        try {
          cacheVideo(userId, nextVideo);
        } catch (cacheError) {
          setError(
            cacheError instanceof Error
              ? cacheError.message
              : "The video could not be cached in this tab.",
          );
        }
      }
      setVideo(nextVideo);
      videoRef.current = nextVideo;
      pendingNotesRef.current = notes;
      if (notesSaveTimeoutRef.current !== null) {
        window.clearTimeout(notesSaveTimeoutRef.current);
      }
      notesSaveTimeoutRef.current = window.setTimeout(() => {
        pendingNotesRef.current = null;
        notesSaveTimeoutRef.current = null;
        persistNotes(notes);
      }, 500);
    },
    [persistNotes, userId, videoId],
  );

  // Saves notes still waiting for the debounce when the lesson changes or the
  // page closes.
  useEffect(
    () => () => {
      if (notesSaveTimeoutRef.current !== null) {
        window.clearTimeout(notesSaveTimeoutRef.current);
        notesSaveTimeoutRef.current = null;
        if (pendingNotesRef.current !== null) {
          persistNotes(pendingNotesRef.current);
          pendingNotesRef.current = null;
        }
      }
    },
    [persistNotes],
  );

  return {
    video,
    loading,
    error,
    setError,
    saveProgress,
    setCompleted,
    updateNotes,
  };
}
