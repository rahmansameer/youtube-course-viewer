export function extractVideoId(url: string): string | null {
  const value = url.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return isValidVideoId(id) ? id : null;
    }

    if (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("www.youtube.com")
    ) {
      const id = parsed.searchParams.get("v");
      if (id) {
        return isValidVideoId(id) ? id : null;
      }
      // /shorts/ID, /embed/ID and /live/ID links.
      const [section, pathId] = parsed.pathname.split("/").filter(Boolean);
      return ["shorts", "embed", "live"].includes(section) &&
        pathId &&
        isValidVideoId(pathId)
        ? pathId
        : null;
    }
  } catch {
    // URL constructor can fail for malformed strings.
  }

  const shortMatch = value.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
  if (shortMatch) return shortMatch[1];

  const standardMatch = value.match(/[?&]v=([A-Za-z0-9_-]{11})/i);
  if (standardMatch) return standardMatch[1];

  return null;
}

export type PlaylistVideo = {
  id: string;
  title: string;
  duration: number | null;
};

export type PlaylistInfo = {
  id: string;
  title: string;
  description: string;
  channel: string;
  thumbnail: string;
  videos: PlaylistVideo[];
};

// Mixes ("RD…") are generated per viewer and never end, and "WL"/"LL" are
// private to the signed-in YouTube account, so none of them can be a course.
export function isSupportedPlaylistId(value: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(value) && !value.startsWith("RD");
}

export function extractPlaylistId(url: string): string | null {
  const value = url.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("youtu.be")
    ) {
      const id = parsed.searchParams.get("list");
      return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
    }
  } catch {
    // Not a URL; a bare playlist ID is accepted below.
  }

  const listMatch = value.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listMatch) return listMatch[1];

  return /^(PL|UU|OL|FL)[A-Za-z0-9_-]{10,62}$/.test(value) ? value : null;
}

export function getPlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

export function isValidVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function getVideoThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// YouTube's clock format: "0:07", "13:46", "1:02:03".
export function formatTime(seconds: number | null | undefined): string {
  if (
    !Number.isFinite(seconds) ||
    seconds === null ||
    seconds === undefined ||
    seconds < 0
  ) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");

  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, "0")}:${secs}`
    : `${mins}:${secs}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  return formatTime(seconds);
}

// "3h 20m", "45m", "30s": for totals and time left, where seconds are noise.
export function formatDurationLong(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "0m";
  }
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${total}s`;
}
