import type { NextRequest } from "next/server";

import { isValidVideoId } from "@/lib/youtube";
import { getVideoAboutFromApi } from "@/lib/youtube-data-api";

type About = {
  description: string;
  viewCount: number | null;
  publishDate: string | null;
};

type Json = Record<string, unknown>;

const YOUTUBE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const WEB_CLIENT = { clientName: "WEB", clientVersion: "2.20261020.01.00", hl: "en" };

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function findKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found !== undefined) return found;
    }
  } else if (isRecord(value)) {
    if (key in value) return value[key];
    for (const child of Object.values(value)) {
      const found = findKey(child, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function simpleText(value: unknown) {
  return isRecord(value) && typeof value.simpleText === "string" ? value.simpleText : "";
}

function toNumber(text: string) {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

// 1. The official YouTube Data API, when YOUTUBE_API_KEY is set. It is the
// one source that works reliably from any server.
const fromDataApi = getVideoAboutFromApi;

// 2. The "player" endpoint youtube.com's web client uses. YouTube often
// answers servers in data centers (like Vercel) with a bot check here.
async function fromPlayer(videoId: string): Promise<About | null> {
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: YOUTUBE_HEADERS,
    body: JSON.stringify({ context: { client: WEB_CLIENT }, videoId }),
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  const details = isRecord(data) ? data.videoDetails : null;
  if (!isRecord(details) || typeof details.shortDescription !== "string") return null;
  const microformat = findKey(data, "playerMicroformatRenderer");
  const views = Number(details.viewCount);
  return {
    description: details.shortDescription,
    viewCount: Number.isFinite(views) ? views : null,
    publishDate:
      isRecord(microformat) && typeof microformat.publishDate === "string"
        ? microformat.publishDate
        : null,
  };
}

// The description as the watch page shows it shortens long links ("…");
// each link's full address is in its command, so put those back.
function expandDescription(description: Json) {
  const content = typeof description.content === "string" ? description.content : "";
  const runs = Array.isArray(description.commandRuns) ? description.commandRuns : [];
  let text = "";
  let cursor = 0;
  for (const run of runs) {
    if (!isRecord(run) || typeof run.startIndex !== "number" || typeof run.length !== "number") {
      continue;
    }
    const url = findKey(run, "url");
    let full = "";
    if (typeof url === "string") {
      try {
        const parsed = new URL(url, "https://www.youtube.com");
        parsed.searchParams.delete("index");
        parsed.searchParams.delete("pp");
        full =
          parsed.pathname === "/redirect"
            ? (parsed.searchParams.get("q") ?? "")
            : /^\/(watch|playlist|@|channel|shorts|c\/|user\/)/.test(parsed.pathname)
              ? parsed.href
              : "";
      } catch {
        full = "";
      }
    }
    const shown = content.slice(run.startIndex, run.startIndex + run.length).trim();
    // Only replace links (shortened "https://…", or chips like "• Playlist"
    // and "/ @channel"); keep hashtags and timestamps as written.
    if (full && /^(https?:|•|\/|www\.)/.test(shown)) {
      // Chips are padded with spaces; keep a single space before the link.
      const raw = content.slice(run.startIndex, run.startIndex + run.length);
      text +=
        content.slice(cursor, run.startIndex).replace(/[ \u00a0]+$/, " ") +
        full +
        (raw.match(/\n+$/)?.[0] ?? "");
      cursor = run.startIndex + run.length;
      while (content[cursor] === " " || content[cursor] === "\u00a0") {
        cursor += 1;
      }
    }
  }
  return (text + content.slice(cursor)).replace(/ /g, " ");
}

// 3. The "next" endpoint behind the watch page, which servers can usually
// still read when "player" is blocked.
async function fromNext(videoId: string): Promise<About | null> {
  const response = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
    method: "POST",
    headers: YOUTUBE_HEADERS,
    body: JSON.stringify({ context: { client: WEB_CLIENT }, videoId }),
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  const secondary = findKey(data, "videoSecondaryInfoRenderer");
  const attributed = isRecord(secondary) ? secondary.attributedDescription : null;
  if (!isRecord(attributed)) return null;
  const header = findKey(data, "videoDescriptionHeaderRenderer");
  const views = toNumber(isRecord(header) ? simpleText(header.views) : "");
  const dateText = isRecord(header) ? simpleText(header.publishDate) : "";
  // "Jul 14, 2022" is a calendar date; read it at midday UTC so it shows as
  // the same day in every time zone.
  const date = dateText ? new Date(`${dateText} 12:00 UTC`) : null;
  return {
    description: expandDescription(attributed),
    viewCount: views,
    publishDate: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
  };
}

// A video's description, views and publish date for the watch page.
// YouTube treats requests from servers differently from browsers, so this
// tries several sources in turn.
export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("v") ?? "";
  if (!isValidVideoId(videoId)) {
    return Response.json({ error: "Not a YouTube video ID." }, { status: 400 });
  }

  for (const source of [fromDataApi, fromPlayer, fromNext]) {
    try {
      const about = await source(videoId);
      if (about) {
        return Response.json(about, {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
      }
    } catch {
      // Try the next source.
    }
  }
  return Response.json({ error: "No description found." }, { status: 404 });
}
