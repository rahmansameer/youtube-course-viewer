import type { NextRequest } from "next/server";

import {
  fetchPlaylistFromYouTube,
  PlaylistFetchError,
} from "@/lib/youtube-playlist-server";
import { isSupportedPlaylistId } from "@/lib/youtube";
import { getPlaylistFromApi } from "@/lib/youtube-data-api";

// The browser can't read youtube.com pages (no CORS), so the add-course form
// asks this route for a playlist's title and lessons.
export async function GET(request: NextRequest) {
  const playlistId = request.nextUrl.searchParams.get("list")?.trim() ?? "";
  if (!isSupportedPlaylistId(playlistId)) {
    return Response.json(
      { error: "This is not a public YouTube playlist link." },
      { status: 400 },
    );
  }

  try {
    // The official API when a key is set, else youtube.com's playlist page.
    const playlist =
      (await getPlaylistFromApi(playlistId).catch(() => null)) ??
      (await fetchPlaylistFromYouTube(playlistId));
    return Response.json(playlist, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    if (error instanceof PlaylistFetchError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: "The playlist could not be loaded from YouTube." },
      { status: 502 },
    );
  }
}
