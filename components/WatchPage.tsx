"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import AppShell from "@/components/AppShell";
import CourseNotes from "@/components/CourseNotes";
import CourseSuggestions from "@/components/CourseSuggestions";
import PageTitle from "@/components/PageTitle";
import { Button, ButtonLink, IconButton, Menu } from "@/components/ui";
import { useVideoProgress } from "@/components/useVideoProgress";
import { useWidePlayer } from "@/components/useWidePlayer";
import WatchLayout, { VideoDetails } from "@/components/WatchLayout";
import YouTubePlayer, { type PlayerHandle } from "@/components/YouTubePlayer";
import { getStartTime } from "@/lib/library";
import { preloadYouTubeIframeApi } from "@/lib/youtube-iframe-api";
import {
  fetchVideoChannel,
  fetchVideoAbout,
  getCachedVideoChannel,
  getCachedVideoAbout,
  type ChannelInfo,
  type VideoAbout,
} from "@/lib/youtube-metadata";

// "?t=83" (from a timestamp on the notes page) opens the video at 1:23.
// It's applied once and then dropped from the address bar.
export function takeStartParam(): number | null {
  try {
    const url = new URL(window.location.href);
    const seconds = Number(url.searchParams.get("t"));
    if (!url.searchParams.has("t") || !Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    url.searchParams.delete("t");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    return seconds;
  } catch {
    return null;
  }
}

// The player area before the video record is known.
export function PlayerPlaceholder({ message }: { message?: string }) {
  return (
    <div className="grid aspect-video place-items-center rounded-xl bg-black text-sm text-white/70">
      {message ?? (
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white/90" />
      )}
    </div>
  );
}

export function NotFound({ title, message }: { title: string; message: string }) {
  return (
    <AppShell guide="drawer">
      <PageTitle name={title} />
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{message}</p>
        <ButtonLink href="/" variant="primary" className="mt-6">
          Back to your courses
        </ButtonLink>
      </div>
    </AppShell>
  );
}

// What /watch and /course show while the page reads its address (the static
// HTML for a direct visit): the layout with an empty player.
export function WatchFallback() {
  return (
    <WatchLayout theater={false} player={<PlayerPlaceholder />} details={null} secondary={null} />
  );
}

export default function WatchPage() {
  const videoId = useSearchParams().get("v") ?? "";
  const { video, loading, error, saveProgress, setCompleted, updateNotes } =
    useVideoProgress(videoId);
  // A single video opens with its notes beside it.
  const [notesOpen, setNotesOpen] = useState(true);
  const { isWidePlayer: theater, toggleWidePlayer: toggleTheater } = useWidePlayer();
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [youtubeDescription, setYoutubeDescription] = useState<VideoAbout | null>(null);
  const playerHandleRef = useRef<PlayerHandle | null>(null);
  const pendingStartRef = useRef<number | null>(null);

  useEffect(() => {
    // Fetch the player API while the video record loads instead of after.
    preloadYouTubeIframeApi();
  }, []);

  useLayoutEffect(() => {
    pendingStartRef.current = takeStartParam();
  }, []);

  // Saving the position moves the player there, before or after it loads.
  useEffect(() => {
    const start = pendingStartRef.current;
    if (video && start !== null) {
      pendingStartRef.current = null;
      saveProgress(start, video.duration ?? 0, true);
    }
  }, [saveProgress, video]);

  // Show the remembered channel and description before paint, then refresh.
  useLayoutEffect(() => {
    setChannel(videoId ? getCachedVideoChannel(videoId) : null);
    setYoutubeDescription(videoId ? getCachedVideoAbout(videoId) : null);
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    if (videoId) {
      void fetchVideoAbout(videoId).then((found) => {
        if (!cancelled && found !== null) {
          setYoutubeDescription(found);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    if (videoId) {
      void fetchVideoChannel(videoId).then((found) => {
        if (!cancelled && found?.name) {
          setChannel(found);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const toggleNotes = () => setNotesOpen((open) => !open);

  if (!video && !loading) {
    return (
      <NotFound
        title={error ? "Couldn't load this video" : "Video not found"}
        message={error || "It may have been removed from your courses."}
      />
    );
  }

  const youtubeUrl = video?.youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`;

  return (
    <>
      <PageTitle name={video?.title ?? "Watch"} />
      <WatchLayout
        theater={theater}
        player={
          // Starts from the URL's id right away, not after the saved record
          // loads; the player seeks to the saved position once it arrives.
          videoId ? (
            <YouTubePlayer
              videoId={videoId}
              currentTime={video ? getStartTime(video) : 0}
              positionKnown={Boolean(video)}
              expanded={theater}
              onToggleTheater={toggleTheater}
              onTimeUpdate={saveProgress}
              handleRef={playerHandleRef}
            />
          ) : (
            <PlayerPlaceholder />
          )
        }
        details={
          video ? (
            <VideoDetails
              title={video.title}
              owner={channel}
              about={youtubeDescription}
              fallbackDescription={video.description}
              onSeek={(seconds) => playerHandleRef.current?.seekTo(seconds)}
              actions={
                <>
                  <Button
                    icon={video.completed ? "checkCircle" : "check"}
                    aria-pressed={video.completed}
                    onClick={() => setCompleted(!video.completed)}
                  >
                    {video.completed ? "Completed" : "Mark as complete"}
                  </Button>
                  <Button icon="notes" aria-pressed={notesOpen} onClick={toggleNotes}>
                    Notes
                  </Button>
                  <Menu
                    items={[
                      {
                        label: theater ? "Default view (t)" : "Theater mode (t)",
                        icon: "expand",
                        onSelect: toggleTheater,
                      },
                      { label: "Open on YouTube", icon: "openInNew", href: youtubeUrl, external: true },
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
            {video && notesOpen ? (
              <CourseNotes
                key={video.id}
                notes={video.notes}
                videoId={video.id}
                currentTime={video.currentTime}
                onChange={updateNotes}
                onSeek={(seconds) => playerHandleRef.current?.seekTo(seconds)}
                onClose={toggleNotes}
              />
            ) : null}
            {video && !theater ? (
              <CourseSuggestions excludeKind="video" excludeId={video.id} />
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
