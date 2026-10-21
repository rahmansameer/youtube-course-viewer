"use client";

import { type PlaylistInfo, type PlaylistVideo } from "@/lib/youtube";
import { fetchPlaylistVideoIds } from "@/lib/youtube-iframe-api";

export type VideoInfo = {
  title: string;
  channel: string;
  // e.g. https://www.youtube.com/@CodeWithHarry
  channelUrl: string;
};

type OEmbedResponse = {
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  thumbnail_url?: unknown;
};

// YouTube's oEmbed endpoint allows cross-origin reads and needs no API key.
async function fetchOEmbed(url: string): Promise<OEmbedResponse | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as OEmbedResponse;
  } catch {
    return null;
  }
}

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  const data = await fetchOEmbed(`https://www.youtube.com/watch?v=${videoId}`);
  if (!data || typeof data.title !== "string") {
    return null;
  }
  return {
    title: data.title,
    channel: typeof data.author_name === "string" ? data.author_name : "",
    channelUrl: typeof data.author_url === "string" ? data.author_url : "",
  };
}

export type ChannelInfo = { name: string; avatar: string | null };

// Channel names and pictures are remembered on this device, keyed by video
// and by channel name, so the watch page can show them on its first paint.
const CHANNEL_CACHE_KEY = "youtube-course-viewer-channels-v1";

type ChannelCache = {
  // videoId -> channel name and channel link
  videos: Record<string, { name: string; url: string }>;
  // channel name -> picture (a small data URL, so it paints with no request)
  avatars: Record<string, string>;
};

let channelCache: ChannelCache | null = null;

function readChannelCache(): ChannelCache {
  if (channelCache) {
    return channelCache;
  }
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CHANNEL_CACHE_KEY) ?? "null");
    if (value && typeof value === "object" && "videos" in value && "avatars" in value) {
      channelCache = value as ChannelCache;
      return channelCache;
    }
  } catch {
    // Start over below.
  }
  channelCache = { videos: {}, avatars: {} };
  return channelCache;
}

function writeChannelCache(update: (cache: ChannelCache) => void) {
  const cache = readChannelCache();
  update(cache);
  try {
    window.localStorage.setItem(CHANNEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Kept in memory for this visit.
  }
}

export function getCachedChannelAvatar(name: string): string | null {
  return name ? (readChannelCache().avatars[name] ?? null) : null;
}

export function getCachedVideoChannel(videoId: string): ChannelInfo | null {
  const video = readChannelCache().videos[videoId];
  return video ? { name: video.name, avatar: getCachedChannelAvatar(video.name) } : null;
}

async function fetchChannelAvatar(name: string, channelUrl: string): Promise<string | null> {
  const cached = getCachedChannelAvatar(name);
  if (cached || !channelUrl) {
    return cached;
  }
  try {
    const response = await fetch(`/api/channel-avatar?url=${encodeURIComponent(channelUrl)}`);
    const data: unknown = await response.json().catch(() => null);
    const avatar =
      response.ok && data && typeof data === "object" && "avatar" in data
        ? String(data.avatar)
        : null;
    if (avatar) {
      writeChannelCache((cache) => {
        cache.avatars[name] = avatar;
      });
    }
    return avatar;
  } catch {
    return null;
  }
}

// Channel name and picture for the channel that uploaded a video; instant
// once it has been looked up on this device.
export async function fetchVideoChannel(videoId: string): Promise<ChannelInfo | null> {
  const cached = getCachedVideoChannel(videoId);
  if (cached?.avatar) {
    return cached;
  }
  const info = await fetchVideoInfo(videoId);
  if (!info?.channel) {
    return cached;
  }
  writeChannelCache((cache) => {
    cache.videos[videoId] = { name: info.channel, url: info.channelUrl };
  });
  const avatar = await fetchChannelAvatar(info.channel, info.channelUrl);
  return { name: info.channel, avatar };
}

// Looks channels up in the background (from the home page) so watch pages
// open with them already known.
let prefetching = false;
export async function prefetchVideoChannels(videoIds: string[]) {
  if (prefetching) {
    return;
  }
  prefetching = true;
  try {
    const missing = videoIds.filter((id) => !getCachedVideoChannel(id)?.avatar);
    for (const id of missing.slice(0, 40)) {
      await fetchVideoChannel(id);
    }
  } finally {
    prefetching = false;
  }
}

// What youtube.com shows in a video's description box.
export type VideoAbout = {
  description: string;
  viewCount: number | null;
  publishDate: string | null;
};

// Remembered on this device so a lesson shows its description on first
// paint the next time it's opened.
const ABOUT_CACHE_KEY = "youtube-course-viewer-about-v1";
const ABOUT_CACHE_LIMIT = 300;

let aboutCache: Record<string, VideoAbout> | null = null;

function readAboutCache(): Record<string, VideoAbout> {
  if (aboutCache) {
    return aboutCache;
  }
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(ABOUT_CACHE_KEY) ?? "{}");
    aboutCache =
      value && typeof value === "object" ? (value as Record<string, VideoAbout>) : {};
  } catch {
    aboutCache = {};
  }
  return aboutCache;
}

export function getCachedVideoAbout(videoId: string): VideoAbout | null {
  return readAboutCache()[videoId] ?? null;
}

const pendingAbout = new Map<string, Promise<VideoAbout | null>>();

export function fetchVideoAbout(videoId: string): Promise<VideoAbout | null> {
  const cached = getCachedVideoAbout(videoId);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = pendingAbout.get(videoId);
  if (pending) {
    return pending;
  }
  const request = fetch(`/api/video-description?v=${encodeURIComponent(videoId)}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => {
      if (!data || typeof data !== "object" || !("description" in data)) {
        return null;
      }
      const record = data as Record<string, unknown>;
      const about: VideoAbout = {
        description: String(record.description),
        viewCount: typeof record.viewCount === "number" ? record.viewCount : null,
        publishDate: typeof record.publishDate === "string" ? record.publishDate : null,
      };
      const cache = readAboutCache();
      // Insertion order is age; drop the oldest once the cache is full.
      delete cache[videoId];
      cache[videoId] = about;
      const keys = Object.keys(cache);
      for (const key of keys.slice(0, Math.max(0, keys.length - ABOUT_CACHE_LIMIT))) {
        delete cache[key];
      }
      try {
        window.localStorage.setItem(ABOUT_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // Kept in memory for this visit.
      }
      return about;
    })
    .catch(() => null)
    .finally(() => pendingAbout.delete(videoId));
  pendingAbout.set(videoId, request);
  return request;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Used only when /api/playlist fails: the embedded player lists the video
// IDs and oEmbed fills in titles. Durations are looked up later in the
// background, so lessons show "--:--" until then.
async function fetchPlaylistInBrowser(
  playlistId: string,
): Promise<PlaylistInfo | null> {
  const [ids, playlistData] = await Promise.all([
    fetchPlaylistVideoIds(playlistId),
    fetchOEmbed(`https://www.youtube.com/playlist?list=${playlistId}`),
  ]);
  if (!ids || ids.length === 0) {
    return null;
  }

  const videos = await mapWithConcurrency(
    [...new Set(ids)],
    6,
    async (id): Promise<PlaylistVideo> => {
      const info = await fetchVideoInfo(id);
      return { id, title: info?.title ?? "Untitled lesson", duration: null };
    },
  );

  return {
    id: playlistId,
    title:
      typeof playlistData?.title === "string"
        ? playlistData.title
        : "Untitled playlist",
    description: "",
    channel:
      typeof playlistData?.author_name === "string"
        ? playlistData.author_name
        : "",
    thumbnail:
      typeof playlistData?.thumbnail_url === "string"
        ? playlistData.thumbnail_url
        : `https://i.ytimg.com/vi/${videos[0].id}/hqdefault.jpg`,
    videos,
  };
}

export async function fetchPlaylist(playlistId: string): Promise<PlaylistInfo> {
  let serverError = "The playlist could not be loaded from YouTube.";
  try {
    const response = await fetch(
      `/api/playlist?list=${encodeURIComponent(playlistId)}`,
    );
    const data: unknown = await response.json().catch(() => null);
    if (response.ok && data && typeof data === "object" && "videos" in data) {
      return data as PlaylistInfo;
    }
    if (data && typeof data === "object" && "error" in data) {
      serverError = String(data.error);
    }
    if (response.status === 400) {
      throw new Error(serverError);
    }
  } catch (error) {
    if (error instanceof Error && error.message === serverError) {
      throw error;
    }
  }

  const fallback = await fetchPlaylistInBrowser(playlistId);
  if (fallback) {
    return fallback;
  }
  throw new Error(serverError);
}
