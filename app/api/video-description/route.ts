import type { NextRequest } from "next/server";

import { isValidVideoId } from "@/lib/youtube";

// The watch page HTML no longer carries the video details, so this asks the
// same internal "player" endpoint youtube.com's web client uses. Its
// videoDetails.shortDescription is the full description, links and all.
export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("v") ?? "";
  if (!isValidVideoId(videoId)) {
    return Response.json({ error: "Not a YouTube video ID." }, { status: 400 });
  }

  try {
    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: "2.20261020.01.00", hl: "en" } },
          videoId,
        }),
        cache: "no-store",
      },
    );
    const data: unknown = await response.json().catch(() => null);
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const details = record.videoDetails as Record<string, unknown> | undefined;
    const microformat = (record.microformat as Record<string, unknown> | undefined)
      ?.playerMicroformatRenderer as Record<string, unknown> | undefined;
    if (!response.ok || !details || typeof details.shortDescription !== "string") {
      return Response.json({ error: "No description found." }, { status: 404 });
    }
    const views = Number(details.viewCount);
    return Response.json(
      {
        description: details.shortDescription,
        viewCount: Number.isFinite(views) ? views : null,
        publishDate:
          typeof microformat?.publishDate === "string" ? microformat.publishDate : null,
      },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "The video could not be loaded." }, { status: 502 });
  }
}
