"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import PlayerControls from "@/components/PlayerControls";
import { isTypingTarget } from "@/components/useWidePlayer";
import {
  loadYouTubeIframeApi,
  stopYouTubePlayerWarmup,
  type YouTubePlayerInstance,
} from "@/lib/youtube-iframe-api";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// How long Space must be held before it means "2x while held".
const HOLD_DELAY_MS = 350;
// Extra player height above and below the video, cut off by the frame: it
// hides YouTube's title bar on top and the "More videos" strip on pause.
const CROP_PX = 72;
// How long the controls stay after the pointer stops moving over the video.
const CONTROLS_IDLE_MS = 2500;

export type PlayerHandle = {
  seekTo: (seconds: number) => void;
};

type YouTubePlayerProps = {
  videoId: string;
  // Where playback starts (the saved position).
  currentTime: number;
  // False while the saved position is still loading: the video already
  // plays, but nothing is reported until it has moved to that position.
  positionKnown?: boolean;
  // Theater mode: the player fills its area instead of keeping 16:9.
  expanded?: boolean;
  // Shows a theater mode button in the controls.
  onToggleTheater?: () => void;
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

// YouTube's embedded player with its own UI hidden and a minimal control bar
// of ours on top. The IFrame API saves progress, notices the end of a video,
// seeks, and powers youtube.com's keyboard shortcuts on the page (see the
// keydown handler below).
export default function YouTubePlayer({
  videoId,
  currentTime,
  positionKnown = true,
  expanded = false,
  onToggleTheater,
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
  const [playing, setPlaying] = useState(false);
  // The pointer moved over the video lately, so the controls show.
  const [pointerActive, setPointerActive] = useState(false);
  const idleTimeoutRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  currentTimeRef.current = currentTime;
  // Set in a layout effect (not during render), so a progress tick can't
  // slip in between learning the position and seeking to it.
  const positionKnownRef = useRef(positionKnown);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const flushProgress = useCallback((forcePersist = false) => {
    const player = playerRef.current;
    if (!readyRef.current || !positionKnownRef.current || !player?.getCurrentTime) {
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
    setPlaying(false);
    readyRef.current = false;
    lastReportedSecondRef.current = -1;

    // Create the embed during commit, before paint, with autoplay and the
    // saved start second in its URL, so YouTube starts loading right away;
    // YT.Player attaches to this iframe once the API is ready.
    stopYouTubePlayerWarmup();
    const iframe = document.createElement("iframe");
    const startSecond = Math.floor(Math.max(0, currentTimeRef.current));
    const embedParams = new URLSearchParams({
      autoplay: "1",
      start: String(startSecond),
      // As little of YouTube's own UI as the embed allows: no control bar,
      // fullscreen button, keyboard handling (the page has its own) or
      // annotations.
      controls: "0",
      fs: "0",
      disablekb: "1",
      iv_load_policy: "3",
      rel: "0",
      playsinline: "1",
      enablejsapi: "1",
      origin: window.location.origin,
    });
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${embedParams}`;
    // A title would show as a tooltip beside the cursor over the video, and
    // the YouTube API sets one (the video's name) once it attaches, so the
    // name goes in aria-label and any title is taken off again.
    iframe.setAttribute("aria-label", "YouTube video player");
    const titleObserver = new MutationObserver(() => {
      if (iframe.hasAttribute("title")) iframe.removeAttribute("title");
    });
    titleObserver.observe(iframe, { attributes: true, attributeFilter: ["title"] });
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    // Centered, no wider than the 16:9 video and CROP_PX taller than the
    // frame at both ends. Being taller than 16:9, YouTube fits the video to
    // its width, and its UI at the iframe's top and bottom edges is cut off,
    // even when the frame (theater mode in a tall window) is taller than the
    // video.
    iframe.className = "absolute top-1/2 left-1/2 block -translate-1/2 border-0";
    iframe.style.width = "min(100cqw, 100cqh * 16 / 9)";
    iframe.style.height = `calc(100cqh + ${CROP_PX * 2}px)`;
    container.appendChild(iframe);

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
              // Not known yet: the effect below seeks once it is.
              if (!positionKnownRef.current) return;
              // The saved position may have changed while the embed loaded
              // (e.g. newer progress from Supabase).
              const savedTime = Math.max(0, currentTimeRef.current);
              if (Math.abs(savedTime - startSecond) > 2) {
                event.target.seekTo?.(savedTime, true);
              }
            },
            onStateChange: (event) => {
              const states = window.YT?.PlayerState;
              if (!cancelled && event.data !== states?.BUFFERING) {
                setPlaying(event.data === states?.PLAYING);
              }
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
      titleObserver.disconnect();
      iframe.remove();
    };
  }, [videoId, flushProgress]);

  // The saved position arrived after the video started: jump there (unless
  // the player isn't ready yet; then onReady does it).
  useLayoutEffect(() => {
    const wasKnown = positionKnownRef.current;
    positionKnownRef.current = positionKnown;
    if (!positionKnown || wasKnown || !readyRef.current) return;
    const savedTime = Math.max(0, currentTimeRef.current);
    if (savedTime > 2) {
      playerRef.current?.seekTo?.(savedTime, true);
    }
  }, [positionKnown]);

  const getReadyPlayer = useCallback(
    () => (readyRef.current ? playerRef.current : null),
    [],
  );

  // From the progress bar: follow the drag, then save the new position.
  const seekFromControls = useCallback(
    (seconds: number, done: boolean) => {
      const player = getReadyPlayer();
      if (!player?.seekTo) return;
      player.seekTo(Math.max(0, seconds), done);
      if (done) {
        lastReportedSecondRef.current = -1;
        flushProgress(true);
      }
    },
    [flushProgress, getReadyPlayer],
  );

  const showControlsForAWhile = useCallback(() => {
    setPointerActive(true);
    if (idleTimeoutRef.current !== null) window.clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = window.setTimeout(() => setPointerActive(false), CONTROLS_IDLE_MS);
  }, []);

  const hideControls = useCallback(() => {
    if (idleTimeoutRef.current !== null) window.clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = null;
    setPointerActive(false);
  }, []);

  useEffect(() => hideControls, [hideControls]);

  const togglePlay = useCallback(() => {
    const target = readyRef.current ? playerRef.current : null;
    if (!target) return;
    const playing = target.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
    if (playing) {
      target.pauseVideo?.();
    } else {
      target.playVideo?.();
    }
  }, []);

  // youtube.com's keyboard shortcuts, heard on the page: a layer over the
  // video takes the clicks, so focus never moves into the iframe. Nothing is
  // drawn over the video for them; the video itself is the feedback.
  useEffect(() => {
    let holdTimeout: number | null = null;
    let boosted = false;
    let rateBeforeBoost = 1;
    const player = () => (readyRef.current ? playerRef.current : null);

    const seekBy = (seconds: number) => {
      const target = player();
      if (!target?.getCurrentTime || !target.seekTo) return;
      const duration = target.getDuration?.() ?? 0;
      const next = Math.max(0, target.getCurrentTime() + seconds);
      target.seekTo(duration > 0 ? Math.min(duration, next) : next, true);
      lastReportedSecondRef.current = -1;
    };

    const seekToFraction = (fraction: number) => {
      const target = player();
      const duration = target?.getDuration?.() ?? 0;
      if (!target?.seekTo || duration <= 0) return;
      target.seekTo(duration * fraction, true);
      lastReportedSecondRef.current = -1;
    };

    const changeVolume = (delta: number) => {
      const target = player();
      if (!target?.setVolume) return;
      if (target.isMuted?.()) target.unMute?.();
      const volume = Math.min(100, Math.max(0, (target.getVolume?.() ?? 100) + delta));
      target.setVolume(volume);
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
        } else {
          target?.mute?.();
        }
      } else if (key === ">") stepRate(1);
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdTimeout !== null) {
        window.clearTimeout(holdTimeout);
      }
    };
  }, [togglePlay]);

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
      onPointerMove={showControlsForAWhile}
      onPointerLeave={hideControls}
    >
      <div ref={containerRef} className="absolute inset-0 [container-type:size]" />
      {/* Takes every click and hover, so YouTube never shows its controls;
          a click plays or pauses. There's no fullscreen: theater mode fills
          the browser window instead. */}
      <div
        aria-hidden
        // The pointer hides with the controls while the video plays.
        className={`absolute inset-0 ${playing && !pointerActive ? "cursor-none" : ""}`}
        onClick={togglePlay}
      />
      {playerError ? null : (
        <PlayerControls
          getPlayer={getReadyPlayer}
          playing={playing}
          visible={pointerActive || !playing}
          expanded={expanded}
          onTogglePlay={togglePlay}
          onSeek={seekFromControls}
          onToggleTheater={onToggleTheater}
        />
      )}
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
