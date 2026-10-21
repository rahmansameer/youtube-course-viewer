import type { NextRequest } from "next/server";

import {
  fetchPlaylistFromYouTube,
  PlaylistFetchError,
} from "@/lib/youtube-playlist-server";
import { isSupportedPlaylistId } from "@/lib/youtube";

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
    const playlist = await fetchPlaylistFromYouTube(playlistId);
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
