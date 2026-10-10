import type { TaskGlyphName } from "@/lib/tools/intents";
import { cn } from "@/lib/utils";

/**
 * Six line drawings, one per hero task, in the trim room's hand: a 1.5px
 * hairline, square ends, a sheet that is always a plain rectangle. They say
 * what the task DOES to a page — pressed smaller, two made one, a mark on a
 * line, a photo laid on a sheet, lines becoming a document, a scan read —
 * with no letters in them (`aria-hidden`; the link's words say it).
 *
 * Static here; the parts are grouped (`data-part`) so a later motion pass can
 * move them without redrawing (redesign M22).
 */
const PARTS: Record<TaskGlyphName, React.ReactNode> = {
  // A sheet pressed from both ends toward its middle.
  compress: (
    <>
      <rect x="5" y="2.75" width="14" height="18.5" />
      <g data-part="press-top">
        <path d="M9 6.25 12 9l3-2.75" />
      </g>
      <g data-part="press-bottom">
        <path d="M9 17.75 12 15l3 2.75" />
      </g>
      <path d="M8.5 12h7" />
    </>
  ),
  // Two sheets, and the one they become.
  merge: (
    <>
      <g data-part="left">
        <rect x="2.75" y="2.75" width="7.5" height="9" />
      </g>
      <g data-part="right">
        <rect x="13.75" y="2.75" width="7.5" height="9" />
      </g>
      <path d="M6.5 11.75v2h11v-2M12 13.75v1.5" />
      <rect x="7.75" y="15.25" width="8.5" height="6" />
    </>
  ),
  // A signature crossing its line, and the nib that made it.
  sign: (
    <>
      <path d="M2.75 20.25h18.5" />
      <g data-part="stroke">
        <path d="M3.75 16.5c1.5-3.25 3-4.75 3.75-3.5.9 1.5-.6 3.6.6 3.6 1.1 0 1.9-2.9 3.1-2.9 1 0 .6 1.9 1.6 1.9.6 0 1.2-.7 1.7-1.4" />
      </g>
      <g data-part="nib">
        <path d="m14.75 11.25 5-5.5 1.75 1.75-5.5 5-2.25.75z" />
      </g>
    </>
  ),
  // A photo laid on the sheet it becomes part of.
  photos: (
    <>
      <rect x="8.25" y="2.75" width="13" height="18.5" />
      <g data-part="photo">
        <rect
          x="2.75"
          y="8.25"
          width="11.5"
          height="9.5"
          fill="var(--sf-panel)"
        />
        <path d="m2.75 16 3.5-3.5 2.75 2.75 1.75-1.75 3.5 3.5" />
        <circle cx="10.25" cy="11" r="1" />
      </g>
    </>
  ),
  // Lines of text, carried across into a document of paragraphs.
  "to-word": (
    <>
      <rect x="2.75" y="2.75" width="9" height="12" />
      <path d="M5.25 6.25h4M5.25 8.75h4M5.25 11.25h2.5" />
      <g data-part="arrow">
        <path d="M13 9h3.25m-1.5-1.75L16.5 9l-1.75 1.75" />
      </g>
      <rect x="12.25" y="11.75" width="9" height="9.5" />
      <path d="M14.5 15.25h4.5M14.5 17.75h3" />
    </>
  ),
  // A scan in the reader's frame, its lines picked out.
  ocr: (
    <>
      <path d="M2.75 7.5V2.75H7.5M16.5 2.75h4.75V7.5M21.25 16.5v4.75H16.5M7.5 21.25H2.75V16.5" />
      <g data-part="lines">
        <path d="M7 8.5h10M7 12h10M7 15.5h6" />
      </g>
    </>
  ),
};

export function TaskGlyph({
  name,
  className,
}: {
  name: TaskGlyphName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
      className={cn("size-6 shrink-0", className)}
    >
      {PARTS[name]}
    </svg>
  );
}
