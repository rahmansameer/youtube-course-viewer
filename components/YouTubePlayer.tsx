"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import Icon, { type IconName } from "@/components/Icon";
import { formatTime } from "@/lib/youtube";
import {
  loadYouTubeIframeApi,
  type YouTubePlayerInstance,
} from "@/lib/youtube-iframe-api";

export type PlayerHandle = {
  seekTo: (seconds: number) => void;
};

type YouTubePlayerProps = {
  videoId: string;
  // Lets the page seek the video, e.g. from a timestamp in the notes.
  handleRef?: RefObject<PlayerHandle | null>;
  currentTime: number;
  // Shown in the timeline until the player reports the real duration.
  savedDuration?: number | null;
  // Theater mode: the player fills the width under the masthead.
  expanded?: boolean;
  onToggleExpanded?: () => void;
  // Called when playback reaches the end, e.g. to open the next lesson.
  onEnded?: () => void;
  // Course lessons get YouTube's playlist controls.
  onNext?: () => void;
  onPrevious?: () => void;
  autoplay?: { enabled: boolean; onChange: (enabled: boolean) => void };
  onTimeUpdate: (
    currentTime: number,
    duration: number,
    forcePersist?: boolean,
  ) => void;
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const PLAYBACK_RATE_STORAGE_KEY = "youtube-course-viewer-playback-rate";

function getStoredPlaybackRate() {
  try {
    const stored = Number(window.localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY));
    return PLAYBACK_RATES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function storePlaybackRate(rate: number) {
  try {
    window.localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
  } catch {
    // The speed still applies to this video; it just won't be remembered.
  }
}

function PlayerButton({
  icon,
  label,
  onClick,
  disabled,
  size = 28,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center text-white opacity-90 transition-opacity hover:opacity-100 disabled:opacity-40"
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

type VideoTimelineProps = {
  currentTime: number;
  duration: number;
  isPlayerReady: boolean;
  isPlaying: boolean;
  getCurrentTime: () => number;
  seekTo: (seconds: number, forcePersist?: boolean) => void;
  // Controls on either side of the "0:13 / 13:46" clock.
  left: ReactNode;
  right: ReactNode;
};

function VideoTimeline({
  currentTime,
  duration,
  isPlayerReady,
  isPlaying,
  getCurrentTime,
  seekTo,
  left,
  right,
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
      <div className="youtube-timeline group/timeline relative flex h-4 items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden bg-white/20 transition-[height] group-hover/timeline:h-[5px]"
        >
          <div
            className="h-full origin-left bg-brand"
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
          className="youtube-seekbar relative z-10 h-4 w-full cursor-pointer disabled:cursor-default"
        />
      </div>
      <div className="flex h-12 items-center">
        {left}
        <span className="px-2 text-[13px] whitespace-nowrap text-[#eee] tabular-nums">
          {formatTime(displayTime)} / {formatTime(safeDuration)}
        </span>
        <div className="flex-1" />
        {right}
      </div>
    </>
  );
}

export default function YouTubePlayer({
  videoId,
  currentTime,
  savedDuration = null,
  expanded = false,
  onToggleExpanded,
  onEnded,
  onNext,
  onPrevious,
  autoplay,
  handleRef,
  onTimeUpdate,
}: YouTubePlayerProps) {
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const readyRef = useRef(false);
  const saveIntervalRef = useRef<number | null>(null);
  const lastReportedSecondRef = useRef(-1);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  // The speed carries over between videos and visits, like on YouTube.
  const [playbackRate, setPlaybackRateState] = useState(getStoredPlaybackRate);
  const playbackRateRef = useRef(playbackRate);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Controls hide while playing once the pointer has been still for a bit.
  const [pointerActive, setPointerActive] = useState(false);
  const pointerTimeoutRef = useRef<number | null>(null);
  const revealControls = useCallback(() => {
    setPointerActive(true);
    if (pointerTimeoutRef.current !== null) {
      window.clearTimeout(pointerTimeoutRef.current);
    }
    pointerTimeoutRef.current = window.setTimeout(() => setPointerActive(false), 2500);
  }, []);
  useEffect(
    () => () => {
      if (pointerTimeoutRef.current !== null) {
        window.clearTimeout(pointerTimeoutRef.current);
      }
    },
    [],
  );
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

  useEffect(() => {
    if (!handleRef) {
      return;
    }
    handleRef.current = {
      seekTo: (seconds) => {
        seekTo(seconds, true);
        playerRef.current?.playVideo?.();
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, seekTo]);

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
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const changePlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    storePlaybackRate(rate);
    playerRef.current?.setPlaybackRate?.(rate);
  }, []);

  const stepPlaybackRate = useCallback(
    (direction: 1 | -1) => {
      const index = PLAYBACK_RATES.indexOf(playbackRateRef.current);
      const next =
        PLAYBACK_RATES[
          Math.min(PLAYBACK_RATES.length - 1, Math.max(0, index + direction))
        ];
      if (next !== undefined) {
        changePlaybackRate(next);
      }
    },
    [changePlaybackRate],
  );

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
      } else if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (event.key === ">") {
        event.preventDefault();
        stepPlaybackRate(1);
      } else if (event.key === "<") {
        event.preventDefault();
        stepPlaybackRate(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [seekBy, stepPlaybackRate, toggleFullscreen, toggleMute, togglePlayback]);

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
              if (playbackRateRef.current !== 1) {
                event.target.setPlaybackRate?.(playbackRateRef.current);
              }
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
            if (event.data === states?.ENDED && !cancelled) {
              onEndedRef.current?.();
            }
          },
          onPlaybackRateChange: (event) => {
            if (!cancelled && PLAYBACK_RATES.includes(event.data)) {
              playbackRateRef.current = event.data;
              setPlaybackRateState(event.data);
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

  const controlsVisible = !isPlaying || pointerActive || settingsOpen;

  return (
    <div
      ref={playerShellRef}
      onPointerMove={revealControls}
      onPointerLeave={() => setPointerActive(false)}
      className={`youtube-player-shell group/player relative overflow-hidden bg-black ${
        expanded ? "h-full" : "rounded-xl"
      } ${controlsVisible ? "" : "cursor-none"}`}
    >
      <div
        className={`youtube-video-frame relative w-full overflow-hidden ${
          expanded ? "h-full" : "aspect-video"
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />
        {/* The embed ignores the pointer, so clicks on the video land here. */}
        <div
          aria-hidden
          className="absolute inset-0"
          onClick={() => {
            if (settingsOpen) {
              setSettingsOpen(false);
            } else {
              togglePlayback();
            }
          }}
          onDoubleClick={() => void toggleFullscreen()}
        />
        {(!isPlayerReady || !hasPlaybackSettled) && !playerError ? (
          <div
            role="status"
            aria-label="Loading video"
            className="absolute inset-0 z-10 grid place-items-center bg-black"
          >
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white/90" />
          </div>
        ) : null}
        {playerError ? (
          <p role="alert" className="absolute inset-0 z-10 grid place-items-center bg-black p-6 text-center text-sm text-white">
            {playerError}
          </p>
        ) : null}
      </div>

      {settingsOpen ? (
        <div
          role="menu"
          aria-label="Playback speed"
          className="absolute right-3 bottom-[68px] z-30 w-56 overflow-hidden rounded-xl bg-[rgba(28,28,28,0.9)] py-2 text-[#eee] backdrop-blur"
        >
          <p className="px-4 pt-1 pb-2 text-sm font-medium">Playback speed</p>
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              role="menuitemradio"
              aria-checked={playbackRate === rate}
              onClick={() => {
                changePlaybackRate(rate);
                setSettingsOpen(false);
              }}
              className="flex h-9 w-full items-center gap-3 px-4 text-left text-sm hover:bg-white/10"
            >
              <span className="inline-flex w-5 justify-center">
                {playbackRate === rate ? <Icon name="check" size={20} /> : null}
              </span>
              {rate === 1 ? "Normal" : rate}
            </button>
          ))}
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Video controls. Space or K plays and pauses, J and L skip 10 seconds, the arrow keys skip 5 seconds, M mutes, F toggles fullscreen, and Shift with comma or period changes the speed."
        onFocus={revealControls}
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pt-10 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100"
        }`}
      >
        <VideoTimeline
          key={videoId}
          currentTime={currentTime}
          duration={duration > 0 ? duration : (savedDuration ?? 0)}
          isPlayerReady={isPlayerReady}
          isPlaying={isPlaying}
          getCurrentTime={getCurrentTime}
          seekTo={seekTo}
          left={
            <>
              {onPrevious ? (
                <PlayerButton icon="skipPrevious" label="Previous lesson (Shift+P)" onClick={onPrevious} />
              ) : null}
              <PlayerButton
                icon={isPlaying ? "pause" : "play"}
                label={isPlaying ? "Pause (k)" : "Play (k)"}
                disabled={!isPlayerReady}
                onClick={togglePlayback}
                size={32}
              />
              {onNext ? (
                <PlayerButton icon="skipNext" label="Next lesson (Shift+N)" onClick={onNext} />
              ) : null}
              <PlayerButton
                icon={isMuted ? "volumeOff" : "volume"}
                label={isMuted ? "Unmute (m)" : "Mute (m)"}
                disabled={!isPlayerReady}
                onClick={toggleMute}
              />
            </>
          }
          right={
            <>
              {autoplay ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoplay.enabled}
                  aria-label="Autoplay next lesson"
                  title={autoplay.enabled ? "Autoplay is on" : "Autoplay is off"}
                  onClick={() => autoplay.onChange(!autoplay.enabled)}
                  className="inline-flex h-12 w-14 items-center justify-center"
                >
                  <span className="relative h-3.5 w-9 rounded-full bg-white/30">
                    <span
                      className={`absolute top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full shadow transition-all ${
                        autoplay.enabled ? "left-4 bg-[#fff] text-black" : "left-0 bg-[#ccc] text-black/70"
                      }`}
                    >
                      <Icon name={autoplay.enabled ? "play" : "pause"} size={12} />
                    </span>
                  </span>
                </button>
              ) : null}
              <PlayerButton
                icon="settings"
                label="Settings"
                onClick={() => setSettingsOpen((open) => !open)}
                size={24}
              />
              {onToggleExpanded ? (
                <PlayerButton
                  icon="theater"
                  label={expanded ? "Default view (t)" : "Theater mode (t)"}
                  onClick={onToggleExpanded}
                />
              ) : null}
              <PlayerButton
                icon={isFullscreen ? "fullscreenExit" : "fullscreen"}
                label={isFullscreen ? "Exit full screen (f)" : "Full screen (f)"}
                disabled={!isPlayerReady}
                onClick={() => void toggleFullscreen()}
              />
            </>
          }
        />
      </div>
      {fullscreenError ? (
        <p role="alert" className="absolute top-3 left-3 z-30 rounded-lg bg-black/80 px-3 py-2 text-sm text-white">
          {fullscreenError}
        </p>
      ) : null}
    </div>
  );
}
