"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { isTypingTarget } from "@/components/useWidePlayer";
import { formatTime } from "@/lib/youtube";
import {
  loadYouTubeIframeApi,
  type YouTubePlayerInstance,
} from "@/lib/youtube-iframe-api";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// How long Space must be held before it means "2x while held".
const HOLD_DELAY_MS = 350;

export type PlayerHandle = {
  seekTo: (seconds: number) => void;
};

type YouTubePlayerProps = {
  videoId: string;
  // Where playback starts (the saved position).
  currentTime: number;
  // Theater mode: the player fills its area instead of keeping 16:9.
  expanded?: boolean;
  // Called when playback reaches the end, e.g. to open the next lesson.
  onEnded?: () => void;
  // Lets the page seek the video, e.g. from a timestamp in the notes.
  handleRef?: RefObject<PlayerHandle | null>;
  onTimeUpdate: (
    currentTime: number,
    duration: number,
    forcePersist?: boolean,
  ) => void;
};

// YouTube's own embedded player, with its built-in controls. The IFrame API
// saves progress, notices the end of a video, seeks, and powers youtube.com's
// keyboard shortcuts on the page (see the keydown handler below).
export default function YouTubePlayer({
  videoId,
  currentTime,
  expanded = false,
  onEnded,
  handleRef,
  onTimeUpdate,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const readyRef = useRef(false);
  const lastReportedSecondRef = useRef(-1);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const currentTimeRef = useRef(currentTime);
  const [playerError, setPlayerError] = useState("");
  // A short note over the video after a shortcut, like "+10s" or "2x".
  const [badge, setBadge] = useState<string | null>(null);
  const badgeTimeoutRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  currentTimeRef.current = currentTime;

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const flushProgress = useCallback((forcePersist = false) => {
    const player = playerRef.current;
    if (!readyRef.current || !player?.getCurrentTime) {
      return;
    }

    const current = player.getCurrentTime();
    const duration = player.getDuration?.() ?? 0;
    const currentSecond = Math.floor(current);
    if (!forcePersist && currentSecond === lastReportedSecondRef.current) {
      return;
    }
    lastReportedSecondRef.current = currentSecond;
    onTimeUpdateRef.current(current, Number.isFinite(duration) ? duration : 0, forcePersist);
  }, []);

  useEffect(() => {
    if (!handleRef) {
      return;
    }
    handleRef.current = {
      seekTo: (seconds) => {
        const player = playerRef.current;
        if (!readyRef.current || !player?.seekTo) {
          return;
        }
        player.seekTo(Math.max(0, seconds), true);
        player.playVideo?.();
        lastReportedSecondRef.current = -1;
        flushProgress(true);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [flushProgress, handleRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    setPlayerError("");
    readyRef.current = false;
    lastReportedSecondRef.current = -1;

    // Create the embed during commit, before paint, with autoplay and the
    // saved start second in its URL, so YouTube starts loading right away;
    // YT.Player attaches to this iframe once the API is ready.
    const iframe = document.createElement("iframe");
    const startSecond = Math.floor(Math.max(0, currentTimeRef.current));
    const embedParams = new URLSearchParams({
      autoplay: "1",
      start: String(startSecond),
      rel: "0",
      playsinline: "1",
      enablejsapi: "1",
      origin: window.location.origin,
    });
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${embedParams}`;
    iframe.title = "YouTube video player";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    iframe.className = "block h-full w-full border-0";
    container.appendChild(iframe);
    iframeRef.current = iframe;

    void loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !window.YT?.Player) {
          return;
        }
        playerRef.current = new window.YT.Player(iframe, {
          events: {
            onReady: (event) => {
              if (cancelled) {
                return;
              }
              readyRef.current = true;
              // The saved position may have changed while the embed loaded
              // (e.g. newer progress from Supabase).
              const savedTime = Math.max(0, currentTimeRef.current);
              if (Math.abs(savedTime - startSecond) > 2) {
                event.target.seekTo?.(savedTime, true);
              }
            },
            onStateChange: (event) => {
              const states = window.YT?.PlayerState;
              if (event.data === states?.PAUSED || event.data === states?.ENDED) {
                flushProgress(true);
              }
              if (event.data === states?.ENDED && !cancelled) {
                onEndedRef.current?.();
              }
            },
            onError: (event) => {
              if (!cancelled) {
                setPlayerError(`YouTube could not play this video (error ${event.data}).`);
              }
            },
          },
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPlayerError(
            error instanceof Error ? error.message : "The YouTube player could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
      flushProgress();
      readyRef.current = false;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      iframeRef.current = null;
      iframe.remove();
    };
  }, [videoId, flushProgress]);

  const showBadge = useCallback((text: string, sticky = false) => {
    setBadge(text);
    if (badgeTimeoutRef.current !== null) {
      window.clearTimeout(badgeTimeoutRef.current);
      badgeTimeoutRef.current = null;
    }
    if (!sticky) {
      badgeTimeoutRef.current = window.setTimeout(() => setBadge(null), 800);
    }
  }, []);

  // youtube.com's keyboard shortcuts. Clicks on the video give focus to the
  // cross-origin iframe, where the page can't hear keys, so focus is handed
  // back to the page right after; YouTube's controls still get the click.
  useEffect(() => {
    let holdTimeout: number | null = null;
    let boosted = false;
    let rateBeforeBoost = 1;
    const player = () => (readyRef.current ? playerRef.current : null);

    const togglePlay = () => {
      const target = player();
      if (!target) return;
      const playing = target.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
      // No badge here: the video stopping or moving is feedback enough, and
      // a note on every play/pause would distract.
      if (playing) {
        target.pauseVideo?.();
      } else {
        target.playVideo?.();
      }
    };

    const seekBy = (seconds: number) => {
      const target = player();
      if (!target?.getCurrentTime || !target.seekTo) return;
      const duration = target.getDuration?.() ?? 0;
      const next = Math.max(0, target.getCurrentTime() + seconds);
      target.seekTo(duration > 0 ? Math.min(duration, next) : next, true);
      lastReportedSecondRef.current = -1;
      showBadge(`${seconds > 0 ? "+" : "−"}${Math.abs(seconds)}s`);
    };

    const seekToFraction = (fraction: number) => {
      const target = player();
      const duration = target?.getDuration?.() ?? 0;
      if (!target?.seekTo || duration <= 0) return;
      target.seekTo(duration * fraction, true);
      lastReportedSecondRef.current = -1;
      showBadge(formatTime(duration * fraction));
    };

    const changeVolume = (delta: number) => {
      const target = player();
      if (!target?.setVolume) return;
      if (target.isMuted?.()) target.unMute?.();
      const volume = Math.min(100, Math.max(0, (target.getVolume?.() ?? 100) + delta));
      target.setVolume(volume);
      showBadge(`Volume ${volume}%`);
    };

    const stepRate = (direction: 1 | -1) => {
      const target = player();
      if (!target?.setPlaybackRate) return;
      const current = target.getPlaybackRate?.() ?? 1;
      const index = PLAYBACK_RATES.findIndex((rate) => rate >= current);
      const next =
        PLAYBACK_RATES[
          Math.min(PLAYBACK_RATES.length - 1, Math.max(0, (index === -1 ? 3 : index) + direction))
        ];
      target.setPlaybackRate(next);
      showBadge(`${next}x`);
    };

    const toggleFullscreen = () => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void iframe.requestFullscreen().catch(() => {});
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) {
        return;
      }
      const key = event.key;
      const lower = key.toLowerCase();

      if (key === " ") {
        event.preventDefault();
        // Tap: play/pause on release. Hold: 2x until released.
        if (!event.repeat && holdTimeout === null && !boosted) {
          holdTimeout = window.setTimeout(() => {
            holdTimeout = null;
            const target = player();
            if (!target?.setPlaybackRate) return;
            rateBeforeBoost = target.getPlaybackRate?.() ?? 1;
            target.setPlaybackRate(2);
            target.playVideo?.();
            boosted = true;
            showBadge("2x ▶▶", true);
          }, HOLD_DELAY_MS);
        }
        return;
      }
      if (event.repeat && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
        return;
      }

      let handled = true;
      if (lower === "k") togglePlay();
      else if (lower === "j") seekBy(-10);
      else if (lower === "l") seekBy(10);
      else if (key === "ArrowLeft") seekBy(-5);
      else if (key === "ArrowRight") seekBy(5);
      else if (key === "ArrowUp") changeVolume(5);
      else if (key === "ArrowDown") changeVolume(-5);
      else if (lower === "m") {
        const target = player();
        if (target?.isMuted?.()) {
          target.unMute?.();
          showBadge("Unmuted");
        } else {
          target?.mute?.();
          showBadge("Muted");
        }
      } else if (lower === "f") toggleFullscreen();
      else if (key === ">") stepRate(1);
      else if (key === "<") stepRate(-1);
      else if (key === "Home") seekToFraction(0);
      else if (key === "End") seekToFraction(0.999);
      else if (/^[0-9]$/.test(key) && !event.shiftKey) seekToFraction(Number(key) / 10);
      else handled = false;

      if (handled) {
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (holdTimeout !== null) {
        window.clearTimeout(holdTimeout);
        holdTimeout = null;
        togglePlay();
      } else if (boosted) {
        boosted = false;
        player()?.setPlaybackRate?.(rateBeforeBoost);
        setBadge(null);
      }
    };

    // After a click on the video, take focus back so the keys above keep
    // working (YouTube's own controls have already handled the click).
    const reclaimFocus = () => {
      window.setTimeout(() => {
        if (document.activeElement === iframeRef.current) {
          shellRef.current?.focus({ preventScroll: true });
        }
      }, 0);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", reclaimFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", reclaimFocus);
      if (holdTimeout !== null) {
        window.clearTimeout(holdTimeout);
      }
      if (badgeTimeoutRef.current !== null) {
        window.clearTimeout(badgeTimeoutRef.current);
      }
    };
  }, [showBadge]);

  // Save progress every second, and when the tab is hidden or closed.
  useEffect(() => {
    const interval = window.setInterval(flushProgress, 1000);
    const flushNow = () => flushProgress(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", flushNow);
    window.addEventListener("pagehide", flushNow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", flushNow);
      window.removeEventListener("pagehide", flushNow);
      flushProgress();
    };
  }, [videoId, flushProgress]);

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={`relative overflow-hidden bg-black outline-none ${
        expanded ? "h-full" : "aspect-video rounded-xl"
      }`}
    >
      <div ref={containerRef} className="h-full w-full" />
      {badge ? (
        <span
          aria-live="polite"
          className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm font-medium text-white"
        >
          {badge}
        </span>
      ) : null}
      {playerError ? (
        <p
          role="alert"
          className="absolute inset-0 grid place-items-center bg-black p-6 text-center text-sm text-white"
        >
          {playerError}
        </p>
      ) : null}
    </div>
  );
}
