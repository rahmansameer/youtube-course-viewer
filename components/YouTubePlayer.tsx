"use client";

import {
  faCompress,
  faDownLeftAndUpRightToCenter,
  faExpand,
  faUpRightAndDownLeftFromCenter,
  faPause,
  faPlay,
  faVolumeHigh,
  faVolumeXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import Icon from "@/components/Icon";
import { formatTime } from "@/lib/youtube";
import {
  loadYouTubeIframeApi,
  type YouTubePlayerInstance,
} from "@/lib/youtube-iframe-api";

type YouTubePlayerProps = {
  videoId: string;
  currentTime: number;
  // Shown in the timeline until the player reports the real duration.
  savedDuration?: number | null;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onTimeUpdate: (
    currentTime: number,
    duration: number,
    forcePersist?: boolean,
  ) => void;
};

type VideoTimelineProps = {
  currentTime: number;
  duration: number;
  isPlayerReady: boolean;
  isPlaying: boolean;
  getCurrentTime: () => number;
  seekTo: (seconds: number, forcePersist?: boolean) => void;
};

function VideoTimeline({
  currentTime,
  duration,
  isPlayerReady,
  isPlaying,
  getCurrentTime,
  seekTo,
}: VideoTimelineProps) {
  const [displayTime, setDisplayTime] = useState(currentTime);
  const scrubbingRef = useRef(false);
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const progress = safeDuration > 0 ? displayTime / safeDuration : 0;

  useEffect(() => {
    if (!isPlayerReady || isPlaying || !Number.isFinite(currentTime)) {
      return;
    }
    setDisplayTime(Math.max(0, currentTime));
  }, [currentTime, isPlayerReady, isPlaying]);

  useEffect(() => {
    if (!isPlayerReady || !isPlaying) {
      return;
    }

    let frameId = 0;
    let lastUpdate = 0;
    const updatePlayhead = (timestamp: number) => {
      if (timestamp - lastUpdate >= 1000 / 30) {
        lastUpdate = timestamp;
        if (!scrubbingRef.current) {
          const playerTime = getCurrentTime();
          if (Number.isFinite(playerTime)) {
            setDisplayTime(Math.max(0, playerTime));
          }
        }
      }
      frameId = window.requestAnimationFrame(updatePlayhead);
    };

    frameId = window.requestAnimationFrame(updatePlayhead);
    return () => window.cancelAnimationFrame(frameId);
  }, [getCurrentTime, isPlayerReady, isPlaying]);

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    scrubbingRef.current = true;
    setDisplayTime(Number(event.currentTarget.value));
  };

  const commitSeek = (event: React.SyntheticEvent<HTMLInputElement>) => {
    if (!scrubbingRef.current) {
      return;
    }

    const targetTime = Number(event.currentTarget.value);
    scrubbingRef.current = false;
    setDisplayTime(targetTime);
    seekTo(targetTime, true);
  };

  return (
    <>
      <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-700">
        {formatTime(displayTime)}
      </span>
      <div className="relative flex h-5 min-w-0 flex-1 items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-zinc-200"
        >
          <div
            className="h-full origin-left rounded-full bg-zinc-900"
            style={{
              transform: `scaleX(${Math.min(1, Math.max(0, progress))})`,
            }}
          />
        </div>
        <input
          type="range"
          aria-label="Seek video"
          aria-valuetext={`${formatTime(displayTime)} of ${formatTime(safeDuration)}`}
          min={0}
          max={safeDuration || 1}
          step={0.1}
          value={Math.min(displayTime, safeDuration || 1)}
          disabled={!isPlayerReady || safeDuration <= 0}
          onPointerDown={() => {
            scrubbingRef.current = true;
          }}
          onPointerUp={commitSeek}
          onPointerCancel={commitSeek}
          onChange={handleSeekChange}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
          className="youtube-seekbar relative z-10 h-5 w-full cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-500">
        {formatTime(safeDuration)}
      </span>
    </>
  );
}

export default function YouTubePlayer({
  videoId,
  currentTime,
  savedDuration = null,
  expanded = false,
  onToggleExpanded,
  onTimeUpdate,
}: YouTubePlayerProps) {
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const readyRef = useRef(false);
  const saveIntervalRef = useRef<number | null>(null);
  const lastReportedSecondRef = useRef(-1);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(0);
  const [playerError, setPlayerError] = useState("");
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  // Keeps the loading overlay up until the video actually starts (or settles
  // paused/cued), so YouTube's own buffering spinner never shows after ours.
  const [hasPlaybackSettled, setHasPlaybackSettled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  currentTimeRef.current = currentTime;

  const readDuration = useCallback((player: YouTubePlayerInstance) => {
    const nextDuration = player.getDuration?.() ?? 0;
    if (
      Number.isFinite(nextDuration) &&
      nextDuration > 0 &&
      nextDuration !== durationRef.current
    ) {
      durationRef.current = nextDuration;
      setDuration(nextDuration);
    }
    return durationRef.current;
  }, []);

  const flushProgress = useCallback((forcePersist = false) => {
    const player = playerRef.current;
    if (!readyRef.current || !player?.getCurrentTime) {
      return;
    }

    const current = player.getCurrentTime();
    const duration = readDuration(player);
    const currentSecond = Math.floor(current);
    if (!forcePersist && currentSecond === lastReportedSecondRef.current) {
      return;
    }
    lastReportedSecondRef.current = currentSecond;
    onTimeUpdateRef.current(current, duration, forcePersist);
  }, [readDuration]);

  const seekTo = useCallback(
    (seconds: number, forcePersist = false) => {
      const player = playerRef.current;
      if (!readyRef.current || !player?.seekTo) {
        return;
      }

      const playerDuration = readDuration(player);
      const targetTime = Math.max(
        0,
        playerDuration > 0 ? Math.min(playerDuration, seconds) : seconds,
      );
      player.seekTo(targetTime, true);
      lastReportedSecondRef.current = -1;
      onTimeUpdateRef.current(targetTime, playerDuration, forcePersist);
    },
    [readDuration],
  );

  const seekBy = useCallback(
    (seconds: number) => {
      const player = playerRef.current;
      const current = player?.getCurrentTime?.() ?? currentTimeRef.current;
      seekTo(current + seconds, true);
    },
    [seekTo],
  );

  const getCurrentTime = useCallback(
    () => playerRef.current?.getCurrentTime?.() ?? currentTimeRef.current,
    [],
  );

  const togglePlayback = useCallback(() => {
    if (!isPlayerReady) {
      return;
    }

    if (isPlaying) {
      playerRef.current?.pauseVideo?.();
    } else {
      playerRef.current?.playVideo?.();
    }
  }, [isPlayerReady, isPlaying]);

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!isPlayerReady || !player) {
      return;
    }

    if (isMuted) {
      player.unMute?.();
    } else {
      player.mute?.();
    }
    setIsMuted(!isMuted);
  }, [isMuted, isPlayerReady]);

  const toggleFullscreen = useCallback(async () => {
    const playerShell = playerShellRef.current;
    if (!isPlayerReady || !playerShell) {
      return;
    }

    setFullscreenError("");
    try {
      if (document.fullscreenElement === playerShell) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        await playerShell.requestFullscreen();
      }
    } catch (error) {
      setFullscreenError(
        error instanceof Error
          ? error.message
          : "Fullscreen could not be enabled.",
      );
    }
  }, [isPlayerReady]);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === playerShellRef.current);
    };
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isSeekSlider =
        target instanceof HTMLInputElement && target.type === "range";
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest(
              "input:not([type='range']), textarea, select, [contenteditable='true']",
            )))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.key === " " || key === "k") {
        event.preventDefault();
        togglePlayback();
      } else if (key === "f") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (key === "j") {
        event.preventDefault();
        seekBy(-10);
      } else if (key === "l") {
        event.preventDefault();
        seekBy(10);
      } else if (!isSeekSlider && event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-5);
      } else if (!isSeekSlider && event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(5);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [seekBy, toggleFullscreen, togglePlayback]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    setPlayerError("");
    setIsPlayerReady(false);
    setHasPlaybackSettled(false);
    let settleTimeout: number | null = null;
    const isSettledState = (state: number | undefined) => {
      const states = window.YT?.PlayerState;
      return (
        state === states?.PLAYING ||
        state === states?.PAUSED ||
        state === states?.ENDED ||
        state === states?.CUED
      );
    };
    setIsPlaying(false);
    setDuration(0);
    durationRef.current = 0;
    lastReportedSecondRef.current = -1;

    // Create the embed during commit, before paint, with autoplay and the
    // saved start second in its URL. YouTube then loads and starts playback
    // on its own instead of waiting for the IFrame API, onReady, and a seekTo
    // round trip; YT.Player attaches to this iframe once the API is ready.
    const iframe = document.createElement("iframe");
    const startSecond = Math.floor(Math.max(0, currentTimeRef.current));
    const embedParams = new URLSearchParams({
      autoplay: "1",
      start: String(startSecond),
      controls: "0",
      disablekb: "1",
      rel: "0",
      playsinline: "1",
      enablejsapi: "1",
      origin: window.location.origin,
    });
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${embedParams}`;
    iframe.title = "YouTube video player";
    iframe.width = "100%";
    iframe.height = "100%";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    iframe.style.display = "block";
    iframe.style.border = "0";
    // Overscan by 1px on each side (the frame clips it) so a sub-pixel gap or
    // a dark edge row from the embed never shows as a line around the video.
    iframe.style.position = "absolute";
    iframe.style.inset = "-1px";
    iframe.style.width = "calc(100% + 2px)";
    iframe.style.height = "calc(100% + 2px)";
    container.appendChild(iframe);

    const createPlayer = () => {
      if (!window.YT?.Player) {
        return;
      }

      playerRef.current = new window.YT.Player(iframe, {
        events: {
          onReady: (event) => {
            if (!cancelled) {
              readyRef.current = true;
              setIsPlayerReady(true);
              readDuration(event.target);
              const states = window.YT?.PlayerState;
              const state = event.target.getPlayerState?.();
              setIsPlaying(state === states?.PLAYING);
              setIsMuted(event.target.isMuted?.() ?? false);
              event.target.unloadModule?.("captions");
              if (isSettledState(state)) {
                setHasPlaybackSettled(true);
              } else {
                // Never leave the overlay up if playback stays unstarted.
                settleTimeout = window.setTimeout(
                  () => setHasPlaybackSettled(true),
                  3000,
                );
              }
              // Fall back to the original seek (which also starts playback)
              // if autoplay did not start or the saved position changed while
              // the embed was loading, e.g. newer progress from Supabase.
              // The player clock can still read 0 while buffering the start
              // position, so compare against the start second in the URL.
              const savedTime = Math.max(0, currentTimeRef.current);
              if (
                (state !== states?.PLAYING && state !== states?.BUFFERING) ||
                Math.abs(savedTime - startSecond) > 2
              ) {
                event.target.seekTo?.(savedTime, true);
              }
            }
          },
          onStateChange: (event) => {
            const states = window.YT?.PlayerState;
            setIsPlaying(event.data === states?.PLAYING);
            // Captions stay off: YouTube turns on uploader or account default
            // captions again whenever playback starts.
            if (event.data === states?.PLAYING) {
              event.target.unloadModule?.("captions");
            }
            if (isSettledState(event.data)) {
              setHasPlaybackSettled(true);
            }
            readDuration(event.target);
            if (
              event.data === states?.PAUSED ||
              event.data === states?.ENDED
            ) {
              flushProgress(true);
            }
          },
          onApiChange: (event) => {
            if (!cancelled) {
              event.target.unloadModule?.("captions");
            }
          },
          onError: (event) => {
            if (!cancelled) {
              setPlayerError(
                `YouTube could not play this video (error ${event.data}).`,
              );
            }
          },
        },
      });
    };

    void loadYouTubeIframeApi()
      .then(() => {
        if (!cancelled) {
          createPlayer();
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPlayerError(
            error instanceof Error
              ? error.message
              : "The YouTube player could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
      flushProgress();
      readyRef.current = false;
      if (settleTimeout !== null) {
        window.clearTimeout(settleTimeout);
      }
      if (saveIntervalRef.current) {
        window.clearInterval(saveIntervalRef.current);
        saveIntervalRef.current = null;
      }
      if (
        playerRef.current &&
        typeof playerRef.current.destroy === "function"
      ) {
        playerRef.current.destroy();
      }
      playerRef.current = null;
      iframe.remove();
    };
  }, [videoId, flushProgress, readDuration]);

  useEffect(() => {
    saveIntervalRef.current = window.setInterval(flushProgress, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushProgress(true);
      }
    };

    const handleBeforeUnload = () => {
      flushProgress(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      if (saveIntervalRef.current) {
        window.clearInterval(saveIntervalRef.current);
        saveIntervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      flushProgress();
    };
  }, [videoId, flushProgress]);

  return (
    <div
      ref={playerShellRef}
      className={`youtube-player-shell overflow-hidden bg-zinc-100 ${
        expanded
          ? "flex h-full flex-col rounded-none border-0 shadow-none"
          : "rounded-2xl border border-zinc-200 shadow-sm"
      }`}
    >
      <div
        className={`youtube-video-frame relative w-full overflow-hidden bg-black ${
          expanded ? "min-h-0 flex-1" : "aspect-video"
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />
        {(!isPlayerReady || !hasPlaybackSettled) && !playerError ? (
          <div
            role="status"
            aria-label="Loading video"
            className="absolute inset-0 z-10 grid place-items-center bg-black text-sm text-white/70"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/25 border-t-white/90" />
          </div>
        ) : null}
      </div>
      <div
        role="group"
        aria-label="Video controls. Space or K plays and pauses, F toggles fullscreen, J rewinds 10 seconds, L skips forward 10 seconds, and the left and right arrow keys seek by 5 seconds."
        className="flex items-center gap-1 bg-white px-2 py-1 text-zinc-900"
      >
        <div className="flex shrink-0 items-center gap-0">
          <button
            type="button"
            aria-label={isPlaying ? "Pause video" : "Play video"}
            title={isPlaying ? "Pause video" : "Play video"}
            disabled={!isPlayerReady}
            onClick={togglePlayback}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] text-zinc-800 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon
              icon={isPlaying ? faPause : faPlay}
            />
          </button>
          <button
            type="button"
            aria-label={isMuted ? "Unmute video" : "Mute video"}
            title={isMuted ? "Unmute" : "Mute"}
            disabled={!isPlayerReady}
            onClick={toggleMute}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon
              icon={isMuted ? faVolumeXmark : faVolumeHigh}
            />
          </button>
        </div>
        <VideoTimeline
          key={videoId}
          currentTime={currentTime}
          duration={duration > 0 ? duration : (savedDuration ?? 0)}
          isPlayerReady={isPlayerReady}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
          seekTo={seekTo}
        />
        {onToggleExpanded ? (
          <button
            type="button"
            aria-label={expanded ? "Exit wide player" : "Expand player"}
            title={expanded ? "Exit wide player (T)" : "Expand player (T)"}
            onClick={onToggleExpanded}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950"
          >
            <Icon
              icon={
                expanded
                  ? faDownLeftAndUpRightToCenter
                  : faUpRightAndDownLeftFromCenter
              }
            />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          disabled={!isPlayerReady}
          onClick={() => void toggleFullscreen()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon
            icon={isFullscreen ? faCompress : faExpand}
          />
        </button>
      </div>
      {playerError ? (
        <p role="alert" className="p-3 text-sm text-red-700">
          {playerError}
        </p>
      ) : null}
      {fullscreenError ? (
        <p role="alert" className="p-3 text-sm text-red-700">
          {fullscreenError}
        </p>
      ) : null}
    </div>
  );
}
