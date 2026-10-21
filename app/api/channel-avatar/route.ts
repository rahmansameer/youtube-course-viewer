import type { NextRequest } from "next/server";

import { getChannelPictureFromApi } from "@/lib/youtube-data-api";

// Channel pages carry the channel's profile picture as og:image. The browser
// can't read youtube.com pages (no CORS), so the watch page asks this route.
const CHANNEL_PATH = /^\/(?:@[^/]+|channel\/[A-Za-z0-9_-]+|c\/[^/]+|user\/[^/]+)\/?$/;

async function readChannelPageImage(pathname: string) {
  const response = await fetch(`https://www.youtube.com${pathname}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      // Skips the EU cookie consent interstitial.
      Cookie: "SOCS=CAI; CONSENT=YES+",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const html = await response.text();
  return html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
}

export async function GET(request: NextRequest) {
  let channelUrl: URL;
  try {
    channelUrl = new URL(request.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return Response.json({ error: "Missing channel link." }, { status: 400 });
  }
  if (
    channelUrl.protocol !== "https:" ||
    !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(channelUrl.hostname) ||
    !CHANNEL_PATH.test(channelUrl.pathname)
  ) {
    return Response.json({ error: "Not a YouTube channel link." }, { status: 400 });
  }

  try {
    // The official API when a key is set, else the channel page's og:image.
    const image =
      (await getChannelPictureFromApi(channelUrl.pathname).catch(() => null)) ??
      (await readChannelPageImage(channelUrl.pathname));
    if (!image?.startsWith("https://yt3.")) {
      return Response.json({ error: "No channel picture found." }, { status: 404 });
    }
    // A small square instead of the 900px original, inlined as a data URL
    // (a few KB) so the app can store it and paint it with no request.
    const avatarUrl = /=s\d+-/.test(image)
      ? image.replace(/=s\d+-/, "=s88-")
      : image.replace(/=s\d+(-|$)/, "=s88$1");
    const picture = await fetch(avatarUrl, { cache: "no-store" });
    const type = picture.headers.get("content-type") ?? "";
    const avatar =
      picture.ok && type.startsWith("image/")
        ? `data:${type};base64,${Buffer.from(await picture.arrayBuffer()).toString("base64")}`
        : avatarUrl;
    return Response.json(
      { avatar },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "The channel could not be loaded." }, { status: 502 });
  }
}
