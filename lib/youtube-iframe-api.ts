"use client";

export type YouTubePlayerInstance = {
  destroy?: () => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getIframe?: () => HTMLIFrameElement;
  getPlaybackRate?: () => number;
  getPlaylist?: () => string[] | null;
  getPlayerState?: () => number;
  isMuted?: () => boolean;
  mute?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
  unMute?: () => void;
  unloadModule?: (module: string) => void;
};

type YouTubePlayerOptions = {
  videoId?: string;
  height?: string | number;
  width?: string | number;
  playerVars?: Record<string, number | boolean | string>;
  events?: {
    onReady?: (event: { target: YouTubePlayerInstance }) => void;
    onStateChange?: (event: {
      data: number;
      target: YouTubePlayerInstance;
    }) => void;
    onError?: (event: { data: number }) => void;
    onApiChange?: (event: { target: YouTubePlayerInstance }) => void;
    onPlaybackRateChange?: (event: {
      data: number;
      target: YouTubePlayerInstance;
    }) => void;
  };
};

let youtubeApiPromise: Promise<void> | null = null;

export function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve();
  }
  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previousCallback?.();
        if (!window.YT?.Player) {
          throw new Error("The YouTube player could not be initialized.");
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    const script = existingScript ?? document.createElement("script");
    script.addEventListener(
      "error",
      () => {
        youtubeApiPromise = null;
        reject(new Error("The YouTube player API could not be loaded."));
      },
      { once: true },
    );
    if (!existingScript) {
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

// Starts downloading the player API ahead of time (e.g. when a course card is
// hovered) so the player can be created as soon as the watch page mounts.
// Failures are ignored here; YouTubePlayer retries and reports them.
export function preloadYouTubeIframeApi() {
  if (typeof window !== "undefined") {
    loadYouTubeIframeApi().catch(() => {});
  }
}

// Creates an off-screen, muted player and polls it until `read` returns a
// value, then destroys it. Resolves null if YouTube never reports one in time.
async function readFromHiddenPlayer<T>(
  options: Pick<YouTubePlayerOptions, "videoId" | "playerVars">,
  read: (player: YouTubePlayerInstance) => T | null,
  timeoutMs: number,
): Promise<T | null> {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    await loadYouTubeIframeApi();
  } catch {
    return null;
  }
  if (!window.YT?.Player) {
    return null;
  }

  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:200px;height:200px;pointer-events:none;opacity:0;";
  const mount = document.createElement("div");
  container.appendChild(mount);
  document.body.appendChild(container);

  return new Promise<T | null>((resolve) => {
    let player: YouTubePlayerInstance | null = null;
    let pollId = 0;
    let settled = false;

    const finish = (value: T | null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      try {
        player?.destroy?.();
      } catch {
        // The player may already be gone; the container is removed anyway.
      }
      container.remove();
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);

    player = new window.YT!.Player(mount, {
      ...options,
      width: 200,
      height: 200,
      playerVars: {
        autoplay: 0,
        controls: 0,
        mute: 1,
        playsinline: 1,
        ...options.playerVars,
      },
      events: {
        onReady: (event) => {
          const poll = () => {
            const value = read(event.target);
            if (value !== null) {
              finish(value);
            }
          };
          poll();
          if (!settled) {
            pollId = window.setInterval(poll, 250);
          }
        },
        onError: () => finish(null),
      },
    });
  });
}

// Reads a video's length without showing it. Resolves null if YouTube does
// not report a duration in time, so callers can save the course anyway and
// let the watch page fill it in later.
export function fetchVideoDuration(
  videoId: string,
  timeoutMs = 8000,
): Promise<number | null> {
  return readFromHiddenPlayer(
    { videoId },
    (player) => {
      const duration = player.getDuration?.() ?? 0;
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    },
    timeoutMs,
  );
}

// Lists a playlist's video IDs through the embedded player. Used when the
// server can't read the playlist page; it has no titles or durations.
export function fetchPlaylistVideoIds(
  playlistId: string,
  timeoutMs = 12000,
): Promise<string[] | null> {
  return readFromHiddenPlayer(
    { playerVars: { listType: "playlist", list: playlistId } },
    (player) => {
      const ids = player.getPlaylist?.();
      return Array.isArray(ids) && ids.length > 0 ? ids : null;
    },
    timeoutMs,
  );
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: YouTubePlayerOptions,
      ) => YouTubePlayerInstance;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
