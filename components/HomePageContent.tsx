"use client";

import { useEffect, useRef, useState } from "react";

import AppHeader from "@/components/AppHeader";
import AddVideoModal from "@/components/AddVideoModal";
import PageTitle from "@/components/PageTitle";
import { useAuth } from "@/components/AuthGate";
import VideoCard from "@/components/VideoCard";
import {
  cacheVideos,
  deleteVideo,
  getCachedVideos,
  loadVideos,
  saveVideo,
  updateVideo,
  type VideoRecord,
} from "@/lib/storage";
import { fetchVideoDuration } from "@/lib/youtube-iframe-api";
import { extractVideoId, getVideoThumbnail } from "@/lib/youtube";

function haveSameVideos(left: VideoRecord[], right: VideoRecord[]) {
  return (
    left.length === right.length &&
    left.every((video, index) => {
      const other = right[index];
      return (
        video.id === other.id &&
        video.youtubeUrl === other.youtubeUrl &&
        video.title === other.title &&
        video.description === other.description &&
        video.thumbnail === other.thumbnail &&
        video.duration === other.duration &&
        video.currentTime === other.currentTime &&
        video.createdAt === other.createdAt &&
        video.updatedAt === other.updatedAt &&
        video.notes === other.notes &&
        video.completed === other.completed
      );
    })
  );
}

function HomePageContent() {
  const { user, cachedUserIdHint } = useAuth();
  const userId = user?.id;
  const cachedUserId = userId ?? cachedUserIdHint;
  const [initialData] = useState(() => {
    if (!cachedUserId || typeof window === "undefined") {
      return {
        videos: [] as VideoRecord[],
        error: "",
        hasCache: false,
      };
    }
    try {
      const cachedVideos = getCachedVideos(cachedUserId);
      return {
        videos: cachedVideos ?? [],
        error: "",
        hasCache: cachedVideos !== null,
      };
    } catch (cacheError) {
      return {
        videos: [] as VideoRecord[],
        error:
          cacheError instanceof Error
            ? cacheError.message
            : "Your cached course library could not be loaded.",
        hasCache: false,
      };
    }
  });
  const [videos, setVideos] = useState<VideoRecord[]>(initialData.videos);
  const [loading, setLoading] = useState(!initialData.hasCache);
  const [error, setError] = useState(initialData.error);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const hasCachedVideosRef = useRef(initialData.hasCache);
  // Start the library request from the session hint instead of waiting for
  // Supabase Auth to restore the session; RLS still scopes the rows to the
  // signed-in account, and a different account re-runs this with its own id.
  const libraryUserId = cachedUserId;
  useEffect(() => {
    if (!libraryUserId) {
      return;
    }

    let cancelled = false;
    if (!hasCachedVideosRef.current) {
      setLoading(true);
    }
    void loadVideos(libraryUserId)
      .then((loadedVideos) => {
        if (!cancelled) {
          setVideos((currentVideos) =>
            haveSameVideos(currentVideos, loadedVideos)
              ? currentVideos
              : loadedVideos,
          );
          setError("");
          hasCachedVideosRef.current = true;
          try {
            cacheVideos(libraryUserId, loadedVideos);
          } catch (cacheError) {
            setError(
              cacheError instanceof Error
                ? cacheError.message
                : "Your course library could not be cached on this device.",
            );
          }

        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Your course library could not be loaded.",
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
  }, [libraryUserId]);

  // Courses added before durations were looked up on save still show
  // "--:--"; fill them in one at a time once the library has loaded.
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
          await updateVideo(userId, video.id, { duration });
        } catch {
          // Leave it for the watch page to record; the card keeps "--:--".
          continue;
        }
        setVideos((currentVideos) => {
          const updatedVideos = currentVideos.map((item) =>
            item.id === video.id && !item.duration
              ? { ...item, duration }
              : item,
          );
          try {
            cacheVideos(userId, updatedVideos);
          } catch {
            // The next library load re-caches the saved duration.
          }
          return updatedVideos;
        });
      }
    })();
  }, [loading, userId, videos]);

  const handleSave = async ({
    youtubeUrl,
    title,
    description,
  }: {
    youtubeUrl: string;
    title: string;
    description: string;
  }): Promise<void> => {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error("Please paste a valid YouTube single-video URL.");
    }

    const existing = videos.find((video) => video.id === videoId);
    const now = new Date().toISOString();

    const nextVideo: VideoRecord = existing
      ? {
          ...existing,
          youtubeUrl,
          title: title || existing.title,
          description,
          thumbnail: existing.thumbnail || getVideoThumbnail(videoId),
          duration: existing.duration ?? (await fetchVideoDuration(videoId)),
          updatedAt: now,
        }
      : {
          id: videoId,
          youtubeUrl,
          title: title || "Untitled course",
          description,
          thumbnail: getVideoThumbnail(videoId),
          duration: await fetchVideoDuration(videoId),
          currentTime: 0,
          createdAt: now,
          updatedAt: now,
          notes: "",
          completed: false,
        };

    if (!user) {
      throw new Error("Sign in to save videos.");
    }
    await saveVideo(user.id, nextVideo);
    const updatedVideos = existing
      ? videos.map((video) => (video.id === videoId ? nextVideo : video))
      : [nextVideo, ...videos];
    setVideos(updatedVideos);
    setError("");
    try {
      cacheVideos(user.id, updatedVideos);
    } catch (cacheError) {
      setError(
        cacheError instanceof Error
          ? cacheError.message
          : "Your course library could not be cached on this device.",
      );
    }
    setSelectedVideo(null);
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    const videoToDelete = videos.find((video) => video.id === id);
    if (videoToDelete) {
      setDeleteTarget(videoToDelete);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !user) {
      return;
    }

    setDeleting(true);
    try {
      await deleteVideo(user.id, deleteTarget.id);
      const updatedVideos = videos.filter(
        (video) => video.id !== deleteTarget.id,
      );
      setVideos(updatedVideos);
      setDeleteTarget(null);
      setError("");
      try {
        cacheVideos(user.id, updatedVideos);
      } catch (cacheError) {
        setError(
          cacheError instanceof Error
            ? cacheError.message
            : "Your course library could not be cached on this device.",
        );
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The video could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 md:px-8">
      <PageTitle name="My Courses" />
      <AppHeader
        onAddVideo={() => {
          setSelectedVideo(null);
          setIsModalOpen(true);
        }}
      />

      {error ? (
        <p role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading && videos.length === 0 ? (
        <div aria-hidden className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
            >
              <div className="aspect-video animate-pulse bg-zinc-200" />
              <div className="space-y-3 p-4 pt-5">
                <div className="h-5 w-3/4 animate-pulse rounded bg-zinc-200" />
                <div className="h-2 animate-pulse rounded-full bg-zinc-200" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-200" />
              </div>
            </div>
          ))}
        </div>
      ) : loading ? null : error && videos.length === 0 ? null : videos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center shadow-sm">
          <p className="text-lg font-medium text-zinc-700">
            No saved videos yet.
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Add a YouTube course URL to start your personal library.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {videos.map((video, index) => (
            <VideoCard
              key={video.id}
              video={video}
              eagerThumbnail={index < 3}
              onEdit={(videoToEdit) => {
                setSelectedVideo(videoToEdit);
                setIsModalOpen(true);
              }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-video-title"
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg"
          >
            <h2
              id="delete-video-title"
              className="text-lg font-semibold text-zinc-900"
            >
              Delete this video?
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              “{deleteTarget.title}” and its saved progress and notes will be
              removed from your account.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-[#fff] transition hover:bg-red-700"
              >
                {deleting ? "Deleting..." : "Delete video"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AddVideoModal
        open={isModalOpen}
        initialVideo={selectedVideo}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedVideo(null);
        }}
        onSave={handleSave}
      />
    </main>
  );
}

export default function HomePage() {
  return <HomePageContent />;
}
