"use client";

import { useEffect, useState } from "react";

import {
  fetchThumbnailColor,
  getCachedThumbnailColor,
  tintVariables,
  type Rgb,
} from "@/lib/thumbnail-color";

// The hover tint for a card, from its thumbnail's main color: remembered
// colors apply at once, new ones are worked out while the browser is idle.
export function useThumbnailTint(url: string) {
  const [color, setColor] = useState<Rgb | null>(null);

  useEffect(() => {
    if (!url) return;
    const known = getCachedThumbnailColor(url);
    if (known !== undefined) {
      setColor(known);
      return;
    }
    let cancelled = false;
    const run = () => {
      void fetchThumbnailColor(url).then((found) => {
        if (!cancelled) setColor(found);
      });
    };
    const idle = window.requestIdleCallback?.(run, { timeout: 1500 });
    const timeout = idle === undefined ? window.setTimeout(run, 200) : undefined;
    return () => {
      cancelled = true;
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [url]);

  return tintVariables(color);
}
