import { Suspense } from "react";

import WatchPage, { WatchFallback } from "@/components/WatchPage";

// One static page for every video (/watch?v=ID, like youtube.com). It is
// built once and served from the CDN, and <Link> prefetches it, so opening a
// video needs no server round trip; the video itself is read in the browser.
export default function Page() {
  return (
    <Suspense fallback={<WatchFallback />}>
      <WatchPage />
    </Suspense>
  );
}
