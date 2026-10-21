"use client";

import { useEffect, useRef, useState } from "react";

import Icon from "@/components/Icon";
import {
  DurationBadge,
  IconButton,
  Menu,
  ProgressLine,
  ResumeBar,
  type MenuItem,
} from "@/components/ui";
import { watchedSeconds } from "@/lib/library";
import { type VideoRecord } from "@/lib/storage";
import { formatDuration } from "@/lib/youtube";

type LessonListProps = {
  title: string;
  channel: string;
  lessons: VideoRecord[];
  currentLessonId: string | null;
  percent: number;
  completedLessons: number;
  menuItems: MenuItem[];
  onSelect: (lessonId: string) => void;
  onToggleCompleted: (lesson: VideoRecord) => void;
};

function lessonPercent(lesson: VideoRecord) {
  if (lesson.completed) {
    return 100;
  }
  return lesson.duration ? (watchedSeconds(lesson) / lesson.duration) * 100 : 0;
}

// youtube.com's playlist panel, with course progress in its header.
export default function LessonList({
  title,
  channel,
  lessons,
  currentLessonId,
  percent,
  completedLessons,
  menuItems,
  onSelect,
  onToggleCompleted,
}: LessonListProps) {
  const [hideCompleted, setHideCompleted] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const currentIndex = lessons.findIndex((lesson) => lesson.id === currentLessonId);
  const visibleLessons = lessons
    .map((lesson, index) => ({ lesson, index }))
    .filter(({ lesson }) => !hideCompleted || !lesson.completed || lesson.id === currentLessonId);

  // Bring the playing lesson into view inside the list (not the page).
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[aria-current='true']");
    if (!list || !current) {
      return;
    }
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + current.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2 + current.offsetHeight / 2;
    }
  }, [currentLessonId]);

  return (
    <section
      aria-label="Course lessons"
      className="flex max-h-[min(640px,calc(100dvh-104px))] min-h-0 flex-col overflow-hidden rounded-xl border border-line"
    >
      <header className="relative border-b border-line bg-chip py-3 pr-12 pl-4">
        <h2 className="line-clamp-2 text-xl leading-7 font-bold">{title}</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {channel ? `${channel} – ` : ""}
          {currentIndex + 1} / {lessons.length}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            <ProgressLine percent={percent} />
          </div>
          <span className="text-xs text-fg-muted tabular-nums">
            {completedLessons}/{lessons.length} done
          </span>
        </div>
        <Menu
          className="absolute top-2 right-1"
          items={[
            {
              label: "Hide completed lessons",
              checked: hideCompleted,
              onSelect: () => setHideCompleted((value) => !value),
            },
            "divider",
            ...menuItems,
          ]}
          trigger={(props) => <IconButton {...props} icon="more" label="Course actions" />}
        />
      </header>

      <ol ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto py-2">
        {visibleLessons.map(({ lesson, index }) => {
          const isCurrent = lesson.id === currentLessonId;
          return (
            <li
              key={lesson.id}
              aria-current={isCurrent ? "true" : undefined}
              className={`group relative flex items-center ${
                isCurrent ? "bg-chip-hover" : "hover:bg-chip"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(lesson.id)}
                className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-9 pl-1 text-left"
              >
                <span className="inline-flex w-6 shrink-0 justify-center text-xs text-fg-muted">
                  {isCurrent ? <Icon name="play" size={16} className="text-fg" /> : index + 1}
                </span>
                <span className="relative aspect-video w-[100px] shrink-0 overflow-hidden rounded-lg bg-chip">
                  <img
                    src={`https://i.ytimg.com/vi/${lesson.id}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  {lesson.duration ? (
                    <DurationBadge>{formatDuration(lesson.duration)}</DurationBadge>
                  ) : null}
                  <ResumeBar percent={lessonPercent(lesson)} />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm leading-5 font-medium">{lesson.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                    {lesson.completed ? (
                      <>
                        <Icon name="checkCircle" size={14} className="text-done" />
                        Completed
                      </>
                    ) : (
                      channel
                    )}
                  </span>
                </span>
              </button>
              <Menu
                className="absolute top-1/2 right-0 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                items={[
                  {
                    label: lesson.completed ? "Mark as not completed" : "Mark as completed",
                    icon: lesson.completed ? "replay" : "checkCircle",
                    onSelect: () => onToggleCompleted(lesson),
                  },
                  {
                    label: "Open on YouTube",
                    icon: "openInNew",
                    href: `https://www.youtube.com/watch?v=${lesson.id}`,
                    external: true,
                  },
                ]}
                trigger={(props) => (
                  <IconButton {...props} icon="more" size="sm" label={`Actions for lesson ${index + 1}`} />
                )}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
