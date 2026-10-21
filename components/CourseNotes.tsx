"use client";

import {
  type ClipboardEvent,
  type MouseEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type IconName } from "@/components/Icon";
import { IconButton } from "@/components/ui";
import { formatTime } from "@/lib/youtube";

type CourseNotesProps = {
  notes: string;
  videoId: string;
  currentTime: number;
  onChange: (notes: string) => void;
  // Timestamp links in the notes jump the player here.
  onSeek: (seconds: number) => void;
  onClose?: () => void;
  // Beside the player, match the height of the video, title and channel
  // row (--primary-height, set by WatchLayout).
  fillHeight?: boolean;
};

// Timestamps are saved as ordinary YouTube links ("watch?v=ID&t=83s"), so
// they keep working if the notes are copied anywhere else.
function readTimestamp(href: string, videoId: string) {
  try {
    const url = new URL(href);
    const seconds = Number(url.searchParams.get("t")?.replace(/s$/, ""));
    return url.searchParams.get("v") === videoId && Number.isFinite(seconds)
      ? seconds
      : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownToHtml(markdown: string) {
  if (!markdown) {
    return "";
  }

  const lines = markdown.split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const inlineHtml = (text: string) =>
    escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  for (const line of lines) {
    const unordered = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    const nextListType = unordered ? "ul" : ordered ? "ol" : null;

    if (nextListType) {
      if (listType !== nextListType) {
        closeList();
        html.push(`<${nextListType}>`);
        listType = nextListType;
      }
      html.push(`<li>${inlineHtml((unordered ?? ordered)?.[1] ?? "")}</li>`);
      continue;
    }

    closeList();
    html.push(line ? `<div>${inlineHtml(line)}</div>` : "<div><br></div>");
  }

  closeList();
  return html.join("");
}

// Notes are saved as this small subset of HTML, so the editor shows them
// after a reload exactly as they looked while they were written.
const NOTE_TAGS: Record<string, string> = {
  A: "a",
  B: "strong",
  BLOCKQUOTE: "blockquote",
  BR: "br",
  CODE: "code",
  DEL: "s",
  DIV: "div",
  EM: "em",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h3",
  H5: "h3",
  H6: "h3",
  HR: "hr",
  I: "em",
  LI: "li",
  OL: "ol",
  P: "p",
  PRE: "pre",
  S: "s",
  STRIKE: "s",
  STRONG: "strong",
  TR: "div",
  U: "u",
  UL: "ul",
};
const BLOCK_TAGS = new Set([
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "ul",
]);
const DROPPED_TAGS = new Set([
  "AUDIO",
  "BUTTON",
  "CANVAS",
  "EMBED",
  "HEAD",
  "IFRAME",
  "IMG",
  "INPUT",
  "LINK",
  "MATH",
  "META",
  "NOSCRIPT",
  "OBJECT",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "SVG",
  "TEMPLATE",
  "TEXTAREA",
  "TITLE",
  "VIDEO",
]);
const HTML_NOTES_PATTERN = /^<(?:blockquote|div|h[1-3]|hr|li|ol|p|pre|ul)[\s>]/;

function isBlock(node: Node) {
  return node instanceof Element && BLOCK_TAGS.has(node.tagName.toLowerCase());
}

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [doc.createTextNode(node.textContent ?? "")];
  }
  if (!(node instanceof Element) || DROPPED_TAGS.has(node.tagName)) {
    return [];
  }

  let children = Array.from(node.childNodes, (child) =>
    cleanNode(child, doc),
  ).flat();
  // Pasted text often carries its bold or italics as inline styles.
  const style = node instanceof HTMLElement ? node.style : null;
  const weight = style?.fontWeight ?? "";
  const isStyledBold =
    weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  const isStyledNormal = weight !== "" && !isStyledBold;
  let tag: string | undefined = NOTE_TAGS[node.tagName];
  if (tag === "strong" && isStyledNormal) {
    tag = undefined;
  }

  if (!children.some(isBlock)) {
    if (style?.fontStyle === "italic" && tag !== "em") {
      const em = doc.createElement("em");
      em.append(...children);
      children = [em];
    }
    if (isStyledBold && tag !== "strong") {
      const strong = doc.createElement("strong");
      strong.append(...children);
      children = [strong];
    }
  }

  if (!tag) {
    return children;
  }
  const element = doc.createElement(tag);
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    if (!/^(?:https?:|mailto:)/i.test(href)) {
      return children;
    }
    element.setAttribute("href", href);
  }
  element.append(...children);
  return [element];
}

export function sanitizeNotesHtml(html: string, wrapLines: boolean) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const doc = template.content.ownerDocument;
  const nodes = Array.from(template.content.childNodes, (node) =>
    cleanNode(node, doc),
  ).flat();

  const output = doc.createElement("div");
  if (!wrapLines) {
    output.append(...nodes);
    return output.innerHTML;
  }

  // Editors leave the first line as bare text, so each run of inline
  // content becomes its own line and the saved notes start with a tag.
  let line: Node[] = [];
  const flushLine = () => {
    if (
      line.some((node) => node.textContent?.trim() || node.nodeName === "BR")
    ) {
      const div = doc.createElement("div");
      div.append(...line);
      output.append(div);
    }
    line = [];
  };
  for (const node of nodes) {
    if (isBlock(node)) {
      flushLine();
      output.append(node);
    } else {
      line.push(node);
    }
  }
  flushLine();
  trimLeadingBlanks(output);
  return output.innerHTML;
}

// Blank lines and line breaks above the first note would only push it down.
function trimLeadingBlanks(container: Element) {
  let node = container.firstChild;
  while (node) {
    const next = node.nextSibling;
    const isBlank =
      node.nodeName === "BR" ||
      (!node.textContent?.trim() &&
        !(node instanceof Element && node.matches("hr, :has(hr)")));
    if (!isBlank) {
      if (node instanceof Element && node.nodeName !== "PRE") {
        trimLeadingBlanks(node);
      }
      return;
    }
    node.remove();
    node = next;
  }
}

export function notesToHtml(notes: string) {
  if (!notes) {
    return "";
  }
  // Older notes were saved as Markdown.
  return sanitizeNotesHtml(
    HTML_NOTES_PATTERN.test(notes) ? notes : markdownToHtml(notes),
    true,
  );
}

function serializeEditor(editor: HTMLElement) {
  if (
    !editor.textContent?.replaceAll("\u00a0", " ").trim() &&
    !editor.querySelector("hr")
  ) {
    return "";
  }
  return sanitizeNotesHtml(editor.innerHTML, true);
}

export default function CourseNotes({
  notes,
  videoId,
  currentTime,
  onChange,
  onSeek,
  onClose,
  fillHeight = false,
}: CourseNotesProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedNotesRef = useRef<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(!notes.trim());

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || notes === lastEmittedNotesRef.current) {
      return;
    }
    editor.innerHTML = notesToHtml(notes);
    setIsEmpty(notes.trim().length === 0);
    lastEmittedNotesRef.current = notes;
  }, [notes]);

  const saveEditor = (editor: HTMLDivElement) => {
    const nextNotes = serializeEditor(editor);
    const normalizedNotes = nextNotes.trim().length === 0 ? "" : nextNotes;
    setIsEmpty(normalizedNotes.length === 0);
    lastEmittedNotesRef.current = normalizedNotes;
    onChange(normalizedNotes);
  };

  const format = (
    command: "bold" | "insertUnorderedList" | "insertOrderedList",
  ) => {
    editorRef.current?.focus();
    document.execCommand(command);
    if (editorRef.current) {
      saveEditor(editorRef.current);
    }
  };

  const pasteNotes = (event: ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData("text/html");
    if (!html) {
      return;
    }
    // Keep only the formatting the notes can save, so pasted text looks the
    // same now as it will after a reload.
    event.preventDefault();
    document.execCommand("insertHTML", false, sanitizeNotesHtml(html, false));
    saveEditor(event.currentTarget);
  };

  const insertTimestamp = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const seconds = Math.floor(currentTime);
    document.execCommand(
      "insertHTML",
      false,
      `<a href="https://www.youtube.com/watch?v=${videoId}&amp;t=${seconds}s">${formatTime(seconds)}</a>&nbsp;`,
    );
    saveEditor(editor);
  };

  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    const link =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }
    event.preventDefault();
    const seconds = readTimestamp(link.href, videoId);
    if (seconds !== null) {
      onSeek(seconds);
    } else {
      window.open(link.href, "_blank", "noopener,noreferrer");
    }
  };

  const buttons: { label: string; icon: IconName; onClick: () => void }[] = [
    { label: "Bold", icon: "bold", onClick: () => format("bold") },
    { label: "Bulleted list", icon: "bulletList", onClick: () => format("insertUnorderedList") },
    { label: "Numbered list", icon: "numberedList", onClick: () => format("insertOrderedList") },
  ];

  return (
    <section
      aria-label="Notes"
      className={`flex h-[min(520px,calc(100dvh-140px))] min-h-80 flex-col overflow-hidden rounded-xl border border-line ${
        fillHeight ? "min-[1016px]:h-(--primary-height) min-[1016px]:min-h-0" : ""
      }`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line py-2 pr-2 pl-4">
        <h2 className="text-xl font-bold">Notes</h2>
        {onClose ? <IconButton icon="close" label="Close notes" onClick={onClose} /> : null}
      </header>
      <div
        role="toolbar"
        aria-label="Note formatting"
        className="flex items-center gap-1 border-b border-line px-2 py-1"
      >
        {buttons.map(({ label, icon, onClick }) => (
          <IconButton
            key={label}
            icon={icon}
            label={label}
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
          />
        ))}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertTimestamp}
          title="Insert a link to the current moment"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-link transition-colors hover:bg-link/10"
        >
          + {formatTime(currentTime)}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={editorRef}
          role="textbox"
          aria-label="Course notes"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => {
            saveEditor(event.currentTarget);
          }}
          onClick={followLink}
          onPaste={pasteNotes}
          className="course-notes-editor scroll-thin relative z-0 h-full min-h-0 w-full overflow-x-hidden overflow-y-auto bg-transparent px-4 py-3 text-sm leading-6 text-fg [overflow-wrap:anywhere] outline-none"
        />
        {isEmpty ? (
          <span className="pointer-events-none absolute top-3 left-4 z-10 text-sm leading-6 text-fg-muted">
            Write notes for this lesson. Add a timestamp to jump back here later.
          </span>
        ) : null}
      </div>
    </section>
  );
}
