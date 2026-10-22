"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import Icon from "@/components/Icon";
import { formatTime } from "@/lib/youtube";
import { type YouTubePlayerInstance } from "@/lib/youtube-iframe-api";

type PlayerControlsProps = {
  // The player once it's ready, or null.
  getPlayer: () => YouTubePlayerInstance | null;
  playing: boolean;
  visible: boolean;
  expanded: boolean;
  onTogglePlay: () => void;
  // `done` is false while the progress bar is being dragged.
  onSeek: (seconds: number, done: boolean) => void;
  onToggleTheater?: () => void;
};

type Snapshot = {
  current: number;
  duration: number;
  loaded: number;
  volume: number;
  muted: boolean;
};

const EMPTY: Snapshot = { current: 0, duration: 0, loaded: 0, volume: 100, muted: false };

// Calls `onChange` with the pointer's position across `element` (0 to 1)
// on press and while dragging; `done` is true on release.
function dragAcross(
  event: ReactPointerEvent<HTMLElement>,
  onChange: (fraction: number, done: boolean) => void,
) {
  if (event.button !== 0) return;
  const element = event.currentTarget;
  const fractionAt = (clientX: number) => {
    const box = element.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  };
  element.setPointerCapture(event.pointerId);
  onChange(fractionAt(event.clientX), false);
  const move = (moveEvent: PointerEvent) => onChange(fractionAt(moveEvent.clientX), false);
  const up = (upEvent: PointerEvent) => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
    onChange(fractionAt(upEvent.clientX), true);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
}

const buttonClass =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-white/70";

// youtube.com's control bar, cut down to the essentials: a progress bar,
// play/pause, volume, time and theater mode. It shows while the pointer
// moves over the video or the video is paused, and fades away otherwise.
export default function PlayerControls({
  getPlayer,
  playing,
  visible,
  expanded,
  onTogglePlay,
  onSeek,
  onToggleTheater,
}: PlayerControlsProps) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  // Where the progress bar is being dragged to, as a fraction.
  const [scrub, setScrub] = useState<number | null>(null);
  const getPlayerRef = useRef(getPlayer);
  getPlayerRef.current = getPlayer;

  // The IFrame API only offers getters, so read them a few times a second.
  useEffect(() => {
    const read = () => {
      const player = getPlayerRef.current();
      if (!player) return;
      const next: Snapshot = {
        current: player.getCurrentTime?.() ?? 0,
        duration: player.getDuration?.() ?? 0,
        loaded: player.getVideoLoadedFraction?.() ?? 0,
        volume: player.getVolume?.() ?? 100,
        muted: player.isMuted?.() ?? false,
      };
      setSnapshot((previous) =>
        Math.floor(previous.current * 4) === Math.floor(next.current * 4) &&
        previous.duration === next.duration &&
        previous.loaded === next.loaded &&
        previous.volume === next.volume &&
        previous.muted === next.muted
          ? previous
          : next,
      );
    };
    read();
    const interval = window.setInterval(read, 250);
    return () => window.clearInterval(interval);
  }, []);

  const { duration, loaded, volume, muted } = snapshot;
  const played = scrub ?? (duration > 0 ? snapshot.current / duration : 0);
  const shownVolume = muted ? 0 : volume;

  const setVolume = (fraction: number) => {
    const player = getPlayerRef.current();
    if (!player?.setVolume) return;
    const next = Math.round(fraction * 100);
    player.setVolume(next);
    if (next > 0 && player.isMuted?.()) player.unMute?.();
    setSnapshot((previous) => ({ ...previous, volume: next, muted: next === 0 ? previous.muted : false }));
  };

  const toggleMute = () => {
    const player = getPlayerRef.current();
    if (!player) return;
    if (muted || volume === 0) {
      player.unMute?.();
      if (volume === 0) player.setVolume?.(50);
    } else {
      player.mute?.();
    }
    setSnapshot((previous) => ({
      ...previous,
      muted: !(muted || volume === 0),
      volume: volume === 0 ? 50 : previous.volume,
    }));
  };

  if (duration <= 0) {
    return null;
  }

  const show = visible || scrub !== null;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
        show ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      // Clicks don't move focus here, so a focus ring doesn't linger on a
      // button once the keyboard shortcuts are used.
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* Just enough shade to keep the white controls readable. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent" />
      <div className="relative px-3">
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(played * duration)}
          aria-valuetext={formatTime(played * duration)}
          className="group/bar flex h-4 cursor-pointer touch-none items-center"
          onPointerDown={(event) =>
            dragAcross(event, (fraction, done) => {
              setScrub(done ? null : fraction);
              // Don't jump back to the old time until the next read.
              if (done) setSnapshot((previous) => ({ ...previous, current: fraction * duration }));
              onSeek(fraction * duration, done);
            })
          }
        >
          <div className="relative h-[3px] w-full bg-white/25 transition-[height] duration-100 group-hover/bar:h-[5px]">
            <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${loaded * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${played * 100}%` }} />
            <div
              className={`absolute top-1/2 h-3 w-3 -translate-1/2 rounded-full bg-brand transition-transform duration-100 ${
                scrub !== null ? "scale-100" : "scale-0 group-hover/bar:scale-100"
              }`}
              style={{ left: `${played * 100}%` }}
            />
          </div>
        </div>
        <div className="flex h-10 items-center gap-1 pb-1">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Pause (k)" : "Play (k)"}
            className={buttonClass}
          >
            <Icon name={playing ? "pause" : "play"} size={26} />
          </button>
          <div className="group/volume flex items-center">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={shownVolume === 0 ? "Unmute (m)" : "Mute (m)"}
              className={buttonClass}
            >
              <Icon
                name={shownVolume === 0 ? "volumeOff" : shownVolume < 50 ? "volumeDown" : "volumeUp"}
                size={24}
              />
            </button>
            {/* Opens beside the button on hover, like youtube.com's. */}
            <div
              role="slider"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shownVolume}
              className="flex h-10 w-0 cursor-pointer touch-none items-center overflow-hidden transition-[width] duration-200 group-hover/volume:w-16"
              onPointerDown={(event) => dragAcross(event, (fraction) => setVolume(fraction))}
            >
              <div className="relative mx-1.5 h-[3px] w-full bg-white/30">
                <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${shownVolume}%` }} />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-1/2 rounded-full bg-white"
                  style={{ left: `${shownVolume}%` }}
                />
              </div>
            </div>
          </div>
          <p className="ml-2 text-[13px] text-white tabular-nums">
            {formatTime(played * duration)}
            <span className="text-white/70"> / {formatTime(duration)}</span>
          </p>
          {onToggleTheater ? (
            <button
              type="button"
              onClick={onToggleTheater}
              aria-label={expanded ? "Exit theater mode (t)" : "Theater mode (t)"}
              aria-pressed={expanded}
              className={`${buttonClass} ml-auto`}
            >
              <Icon name={expanded ? "collapse" : "expand"} size={24} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
