import { type PlaylistInfo, type PlaylistVideo } from "@/lib/youtube";

// Reads a public playlist the way youtube.com renders it: the first page of
// items is embedded in the playlist page as ytInitialData, and later pages
// come from the same internal "browse" endpoint the page itself calls. No API
// key is needed. YouTube changes this markup from time to time, so the parser
// accepts both the current lockup items and the older playlistVideoRenderer.

const MAX_PAGES = 30;
const MAX_VIDEOS = 1000;
const REQUEST_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Skips the EU cookie consent interstitial.
  Cookie: "SOCS=CAI; CONSENT=YES+",
};

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function get(value: Json, ...path: (string | number)[]): Json {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
  }
  return current;
}

function text(value: Json): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.runs)) {
    return value.runs
      .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
      .join("");
  }
  return "";
}

export function parseClockDuration(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const parts = match.slice(1).filter(Boolean).map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0) || null;
}

function findBadgeDuration(value: Json): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBadgeDuration(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const badge = value.thumbnailBadgeViewModel;
  if (isRecord(badge) && typeof badge.text === "string") {
    const seconds = parseClockDuration(badge.text);
    if (seconds) return seconds;
  }
  for (const child of Object.values(value)) {
    const found = findBadgeDuration(child);
    if (found) return found;
  }
  return null;
}

const UNAVAILABLE_TITLES = new Set(["[Private video]", "[Deleted video]"]);

function toVideo(item: Json): PlaylistVideo | null {
  const lockup = get(item, "lockupViewModel");
  if (isRecord(lockup)) {
    if (
      lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" ||
      typeof lockup.contentId !== "string"
    ) {
      return null;
    }
    const title = text(get(lockup, "metadata", "lockupMetadataViewModel", "title"));
    if (UNAVAILABLE_TITLES.has(title)) return null;
    return {
      id: lockup.contentId,
      title: title || "Untitled lesson",
      duration: findBadgeDuration(lockup.contentImage),
    };
  }

  const renderer = get(item, "playlistVideoRenderer");
  if (isRecord(renderer) && typeof renderer.videoId === "string") {
    const title = text(renderer.title);
    if (renderer.isPlayable === false || UNAVAILABLE_TITLES.has(title)) {
      return null;
    }
    const seconds = Number(renderer.lengthSeconds);
    return {
      id: renderer.videoId,
      title: title || "Untitled lesson",
      duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    };
  }

  return null;
}

function continuationToken(item: Json): string | null {
  const token =
    get(item, "continuationItemViewModel", "continuationCommand", "innertubeCommand", "continuationCommand", "token") ??
    get(item, "continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token");
  return typeof token === "string" ? token : null;
}

// Playlist items sit together in one array, with the "load more" token as its
// last entry; other arrays (related playlists, comments) are ignored.
function collectItems(root: Json) {
  const videos: PlaylistVideo[] = [];
  let token: string | null = null;

  const visit = (value: Json) => {
    if (Array.isArray(value)) {
      const pageVideos = value.map(toVideo).filter((video) => video !== null);
      if (pageVideos.length > 0) {
        videos.push(...pageVideos);
        for (const item of value) {
          token = continuationToken(item) ?? token;
        }
        return;
      }
      value.forEach(visit);
    } else if (isRecord(value)) {
      Object.values(value).forEach(visit);
    }
  };

  visit(root);
  return { videos, token };
}

function extractJson(html: string, marker: RegExp): Json {
  const match = html.match(marker);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export class PlaylistFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchPlaylistFromYouTube(
  playlistId: string,
): Promise<PlaylistInfo> {
  const response = await fetch(
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`,
    { headers: REQUEST_HEADERS, cache: "no-store" },
  );
  if (response.status === 404) {
    throw new PlaylistFetchError("This playlist is private or does not exist.", 404);
  }
  if (!response.ok) {
    throw new PlaylistFetchError(
      `YouTube returned ${response.status} for this playlist.`,
      502,
    );
  }
  const html = await response.text();
  const data = extractJson(html, /ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (!data) {
    throw new PlaylistFetchError("YouTube's playlist page could not be read.", 502);
  }

  const alerts = JSON.stringify(get(data, "alerts") ?? "");
  const metadata = get(data, "metadata", "playlistMetadataRenderer");
  const header = get(data, "header", "playlistHeaderRenderer");
  if (!isRecord(metadata)) {
    throw new PlaylistFetchError(
      alerts.includes("does not exist") || alerts.includes("private")
        ? "This playlist is private or does not exist."
        : "This playlist could not be found.",
      404,
    );
  }

  const tabContent = get(data, "contents", "twoColumnBrowseResultsRenderer");
  const first = collectItems(tabContent);
  const videos = [...first.videos];
  let token = first.token;

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion =
    html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ??
    html.match(/"clientVersion":"([^"]+)"/)?.[1] ??
    "2.20250101.00.00";
  const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1];

  for (let page = 1; token && page < MAX_PAGES && videos.length < MAX_VIDEOS; page++) {
    const next = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`,
      {
        method: "POST",
        headers: { ...REQUEST_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: { clientName: "WEB", clientVersion, hl: "en", visitorData },
          },
          continuation: token,
        }),
        cache: "no-store",
      },
    );
    if (!next.ok) break;
    const pageData: Json = await next.json().catch(() => null);
    const pageItems = collectItems(get(pageData, "onResponseReceivedActions"));
    if (pageItems.videos.length === 0) break;
    videos.push(...pageItems.videos);
    token = pageItems.token;
  }

  const seen = new Set<string>();
  const uniqueVideos = videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  if (uniqueVideos.length === 0) {
    throw new PlaylistFetchError("This playlist has no playable videos.", 404);
  }

  const thumbnails = get(data, "microformat", "microformatDataRenderer", "thumbnail", "thumbnails");
  const lastThumbnail = Array.isArray(thumbnails)
    ? get(thumbnails, thumbnails.length - 1, "url")
    : undefined;

  return {
    id: playlistId,
    title: text(metadata.title) || "Untitled playlist",
    description: text(metadata.description),
    channel: text(get(header, "ownerText")),
    thumbnail:
      typeof lastThumbnail === "string" && lastThumbnail
        ? lastThumbnail
        : `https://i.ytimg.com/vi/${uniqueVideos[0].id}/hqdefault.jpg`,
    videos: uniqueVideos.slice(0, MAX_VIDEOS),
  };
}
