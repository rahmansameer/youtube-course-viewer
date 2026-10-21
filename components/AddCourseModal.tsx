"use client";

import { useEffect, useRef, useState } from "react";

import Icon, { type IconName } from "@/components/Icon";
import { Button, Dialog, DurationBadge, inputClasses } from "@/components/ui";
import { type LibraryItem } from "@/lib/library";
import { COURSES_SETUP_MESSAGE } from "@/lib/storage";
import {
  extractPlaylistId,
  extractVideoId,
  formatDurationLong,
  getVideoThumbnail,
  isSupportedPlaylistId,
  type PlaylistInfo,
} from "@/lib/youtube";
import {
  fetchPlaylist,
  fetchVideoInfo,
  type VideoInfo,
} from "@/lib/youtube-metadata";

export type AddCourseValues =
  | {
      kind: "video";
      youtubeUrl: string;
      videoId: string;
      title: string;
      description: string;
    }
  | {
      kind: "playlist";
      youtubeUrl: string;
      playlist: PlaylistInfo;
      title: string;
      description: string;
    };

type AddCourseModalProps = {
  open: boolean;
  // Editing changes only the title and description.
  editing: LibraryItem | null;
  coursesAvailable: boolean;
  onClose: () => void;
  onAdd: (values: AddCourseValues) => Promise<void>;
  onEdit: (
    item: LibraryItem,
    values: { title: string; description: string },
  ) => Promise<void>;
};

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "video"; videoId: string; info: VideoInfo | null }
  | { status: "playlist"; playlist: PlaylistInfo };

function PreviewCard({
  thumbnail,
  icon,
  badge,
  title,
  meta,
}: {
  thumbnail: string;
  icon: IconName;
  badge?: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-chip p-3">
      <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-chip-hover">
        {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover" /> : null}
        <DurationBadge>
          <Icon name={icon} size={14} />
          {badge}
        </DurationBadge>
      </div>
      <div className="min-w-0 py-0.5">
        <p className="line-clamp-2 text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-xs text-fg-muted">{meta}</p>
      </div>
    </div>
  );
}

export default function AddCourseModal({
  open,
  editing,
  coursesAvailable,
  onClose,
  onAdd,
  onEdit,
}: AddCourseModalProps) {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [choice, setChoice] = useState<"playlist" | "video">("playlist");
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setYoutubeUrl(editing?.youtubeUrl ?? "");
    setTitle(editing?.title ?? "");
    setDescription(editing?.description ?? "");
    setChoice("playlist");
    setPreview({ status: "idle" });
    setError("");
  }, [open, editing]);

  const videoId = extractVideoId(youtubeUrl);
  const rawPlaylistId = extractPlaylistId(youtubeUrl);
  const playlistId =
    rawPlaylistId && isSupportedPlaylistId(rawPlaylistId) ? rawPlaylistId : null;
  const isMix = Boolean(rawPlaylistId && !playlistId);
  // A watch link opened from inside a playlist carries both IDs.
  const hasBoth = Boolean(videoId && playlistId);
  const mode: "playlist" | "video" | null = playlistId
    ? hasBoth
      ? choice
      : "playlist"
    : videoId
      ? "video"
      : null;

  // Look the link up shortly after typing stops, to preview it and prefill
  // the title.
  useEffect(() => {
    if (!open || editing || !mode) {
      setPreview({ status: "idle" });
      return;
    }
    const request = ++requestRef.current;
    setPreview({ status: "loading" });
    const timeout = window.setTimeout(() => {
      const lookup =
        mode === "playlist" && playlistId
          ? fetchPlaylist(playlistId).then(
              (playlist): Preview => ({ status: "playlist", playlist }),
            )
          : fetchVideoInfo(videoId ?? "").then(
              (info): Preview => ({
                status: "video",
                videoId: videoId ?? "",
                info,
              }),
            );
      void lookup
        .catch(
          (lookupError: unknown): Preview => ({
            status: "error",
            message:
              lookupError instanceof Error
                ? lookupError.message
                : "This link could not be loaded.",
          }),
        )
        .then((result) => {
          if (requestRef.current === request) {
            setPreview(result);
          }
        });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [editing, mode, open, playlistId, videoId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (editing) {
      setSaving(true);
      try {
        await onEdit(editing, {
          title: title.trim() || editing.title,
          description: description.trim(),
        });
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : "The changes could not be saved.",
        );
      } finally {
        setSaving(false);
      }
      return;
    }

    const trimmedUrl = youtubeUrl.trim();
    if (!mode) {
      setError(
        isMix
          ? "YouTube Mixes can't be added as a course. Paste a regular playlist or a single video link."
          : "Paste a YouTube video or playlist link.",
      );
      return;
    }
    if (mode === "playlist" && !coursesAvailable) {
      setError(COURSES_SETUP_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      if (mode === "playlist" && playlistId) {
        const playlist =
          preview.status === "playlist" && preview.playlist.id === playlistId
            ? preview.playlist
            : await fetchPlaylist(playlistId);
        await onAdd({
          kind: "playlist",
          youtubeUrl: trimmedUrl,
          playlist,
          title: title.trim() || playlist.title,
          description: description.trim() || playlist.description,
        });
      } else if (videoId) {
        const info =
          preview.status === "video" && preview.videoId === videoId
            ? preview.info
            : await fetchVideoInfo(videoId);
        await onAdd({
          kind: "video",
          youtubeUrl: trimmedUrl,
          videoId,
          title: title.trim() || info?.title || "Untitled course",
          description: description.trim(),
        });
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The course could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const suggestedTitle =
    preview.status === "playlist"
      ? preview.playlist.title
      : preview.status === "video"
        ? preview.info?.title
        : undefined;
  const playlistDuration =
    preview.status === "playlist" &&
    preview.playlist.videos.every((video) => video.duration)
      ? preview.playlist.videos.reduce((sum, video) => sum + (video.duration ?? 0), 0)
      : null;

  const submitLabel = saving ? "Saving..." : editing ? "Save" : "Add course";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        editing
          ? editing.kind === "playlist"
            ? "Edit course"
            : "Edit video"
          : "Add video or playlist"
      }
      width="max-w-xl"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-course-form" variant="primary" disabled={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="add-course-form" className="space-y-5" onSubmit={handleSubmit}>
        {editing ? null : (
          <div>
            <label htmlFor="youtube-url" className="mb-1.5 block text-sm font-medium">
              YouTube link
            </label>
            <input
              id="youtube-url"
              autoFocus
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="Paste a YouTube video or playlist link"
              className={inputClasses}
            />
          </div>
        )}

        {hasBoth && !editing ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              This video is part of a playlist. Add:
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["playlist", "The whole playlist"],
                  ["video", "Only this video"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                    choice === value
                      ? "bg-inverse text-on-inverse"
                      : "bg-chip text-fg hover:bg-chip-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="add-choice"
                    value={value}
                    checked={choice === value}
                    onChange={() => setChoice(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {preview.status === "loading" ? (
          <div className="flex items-center gap-3 rounded-xl bg-chip p-3 text-sm text-fg-muted">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-chip-hover border-t-fg-muted" />
            {mode === "playlist" ? "Loading the playlist's lessons..." : "Looking up the video..."}
          </div>
        ) : preview.status === "playlist" ? (
          <PreviewCard
            thumbnail={preview.playlist.thumbnail}
            icon="playlist"
            badge={`${preview.playlist.videos.length}`}
            title={preview.playlist.title}
            meta={[
              preview.playlist.channel,
              `${preview.playlist.videos.length} lessons`,
              playlistDuration ? formatDurationLong(playlistDuration) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ) : preview.status === "video" ? (
          <PreviewCard
            thumbnail={getVideoThumbnail(preview.videoId)}
            icon="play"
            title={preview.info?.title ?? "YouTube video"}
            meta={preview.info?.channel || "Single video"}
          />
        ) : preview.status === "error" ? (
          <p className="text-sm text-danger">{preview.message}</p>
        ) : isMix && !editing ? (
          <p className="text-sm text-fg-muted">
            YouTube Mixes can&apos;t be added as a course. Use a regular playlist or
            a single video link.
          </p>
        ) : null}

        {mode === "playlist" && !coursesAvailable && !editing ? (
          <p className="text-sm text-danger">{COURSES_SETUP_MESSAGE}</p>
        ) : null}

        <div>
          <label htmlFor="video-title" className="mb-1.5 block text-sm font-medium">
            Title{" "}
            {editing ? null : <span className="font-normal text-fg-muted">(optional)</span>}
          </label>
          <input
            id="video-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={suggestedTitle || "Course title"}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="video-description" className="mb-1.5 block text-sm font-medium">
            Description <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <textarea
            id="video-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Your goal for this course, links, reminders..."
            className={`${inputClasses} resize-none`}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
