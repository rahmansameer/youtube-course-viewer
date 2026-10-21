"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const THEATER_STORAGE_KEY = "youtube-course-viewer-theater";

export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']") !==
        null)
  );
}

// Theater mode: the player spans the full width. T toggles it, and the
// choice is remembered like on YouTube.
export function useWidePlayer() {
  const [isWidePlayer, setIsWidePlayer] = useState(false);

  // Read before paint; the page is server-rendered without it.
  useLayoutEffect(() => {
    try {
      setIsWidePlayer(window.localStorage.getItem(THEATER_STORAGE_KEY) === "true");
    } catch {
      // Default view.
    }
  }, []);

  const toggleWidePlayer = useCallback(() => {
    setIsWidePlayer((isWide) => {
      try {
        window.localStorage.setItem(THEATER_STORAGE_KEY, String(!isWide));
      } catch {
        // Applies to this visit only.
      }
      return !isWide;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "t" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      toggleWidePlayer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleWidePlayer]);

  return { isWidePlayer, toggleWidePlayer };
}
