import { type PlaylistInfo, type PlaylistVideo } from "@/lib/youtube";

// The official YouTube Data API v3. It's used first whenever YOUTUBE_API_KEY
// is set (server-side only, never sent to the browser), because unlike
// reading youtube.com's own pages it isn't blocked for servers such as
// Vercel's. Each helper returns null when there's no key or no answer, so
// callers fall back to the keyless sources.

const API = "https://www.googleapis.com/youtube/v3";
const MAX_PLAYLIST_VIDEOS = 1000;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function apiKey() {
  return process.env.YOUTUBE_API_KEY?.trim() || null;
}

async function call(path: string, params: Record<string, string>): Promise<Json | null> {
  const key = apiKey();
  if (!key) return null;
  const query = new URLSearchParams({ ...params, key });
  const response = await fetch(`${API}/${path}?${query}`, { cache: "no-store" });
  const data: unknown = await response.json().catch(() => null);
  return response.ok && isRecord(data) ? data : null;
}

function items(data: Json | null): Json[] {
  return data && Array.isArray(data.items) ? data.items.filter(isRecord) : [];
}

// "PT1H2M3S" -> 3723
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  const total = d * 86400 + h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

function bestThumbnail(thumbnails: unknown): string {
  if (!isRecord(thumbnails)) return "";
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const thumb = thumbnails[size];
    if (isRecord(thumb) && typeof thumb.url === "string") return thumb.url;
  }
  return "";
}

export async function getVideoAboutFromApi(videoId: string) {
  const video = items(await call("videos", { part: "snippet,statistics", id: videoId }))[0];
  if (!video || !isRecord(video.snippet)) return null;
  const views = Number(isRecord(video.statistics) ? video.statistics.viewCount : NaN);
  return {
    description: typeof video.snippet.description === "string" ? video.snippet.description : "",
    viewCount: Number.isFinite(views) ? views : null,
    publishDate:
      typeof video.snippet.publishedAt === "string" ? video.snippet.publishedAt : null,
  };
}

export async function getPlaylistFromApi(playlistId: string): Promise<PlaylistInfo | null> {
  const playlist = items(await call("playlists", { part: "snippet", id: playlistId }))[0];
  if (!playlist || !isRecord(playlist.snippet)) return null;
  const snippet = playlist.snippet;

  // Lessons in playlist order, 50 per page.
  const entries: { id: string; title: string }[] = [];
  let pageToken = "";
  do {
    const page = await call("playlistItems", {
      part: "snippet,status",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    if (!page) break;
    for (const item of items(page)) {
      const itemSnippet = isRecord(item.snippet) ? item.snippet : {};
      const resource = isRecord(itemSnippet.resourceId) ? itemSnippet.resourceId : {};
      const privacy = isRecord(item.status) ? item.status.privacyStatus : "public";
      if (typeof resource.videoId === "string" && privacy !== "private" && privacy !== "privacyStatusUnspecified") {
        entries.push({
          id: resource.videoId,
          title: typeof itemSnippet.title === "string" ? itemSnippet.title : "Untitled lesson",
        });
      }
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
  } while (pageToken && entries.length < MAX_PLAYLIST_VIDEOS);

  // Durations, 50 videos per request; also drops videos that are gone.
  const durations = new Map<string, number | null>();
  const ids = [...new Set(entries.map((entry) => entry.id))];
  for (let index = 0; index < ids.length; index += 50) {
    const batch = await call("videos", {
      part: "contentDetails",
      id: ids.slice(index, index + 50).join(","),
    });
    for (const video of items(batch)) {
      if (typeof video.id === "string") {
        durations.set(
          video.id,
          parseIsoDuration(isRecord(video.contentDetails) ? video.contentDetails.duration : null),
        );
      }
    }
  }

  const seen = new Set<string>();
  const videos: PlaylistVideo[] = entries
    .filter((entry) => durations.has(entry.id) && !seen.has(entry.id) && seen.add(entry.id))
    .map((entry) => ({ ...entry, duration: durations.get(entry.id) ?? null }));
  if (videos.length === 0) return null;

  return {
    id: playlistId,
    title: typeof snippet.title === "string" ? snippet.title : "Untitled playlist",
    description: typeof snippet.description === "string" ? snippet.description : "",
    channel: typeof snippet.channelTitle === "string" ? snippet.channelTitle : "",
    thumbnail:
      bestThumbnail(snippet.thumbnails) || `https://i.ytimg.com/vi/${videos[0].id}/hqdefault.jpg`,
    videos: videos.slice(0, MAX_PLAYLIST_VIDEOS),
  };
}

// The picture URL for a channel link like /@handle or /channel/UC…
export async function getChannelPictureFromApi(channelPath: string): Promise<string | null> {
  const [section, value] = channelPath.split("/").filter(Boolean);
  const params: Record<string, string> = section?.startsWith("@")
    ? { forHandle: section }
    : section === "channel" && value
      ? { id: value }
      : section === "user" && value
        ? { forUsername: value }
        : {};
  if (Object.keys(params).length === 0) return null;
  const channel = items(await call("channels", { part: "snippet", ...params }))[0];
  return channel && isRecord(channel.snippet) ? bestThumbnail(channel.snippet.thumbnails) || null : null;
}
