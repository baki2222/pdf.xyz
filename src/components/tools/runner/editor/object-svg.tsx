"use client";

import { arrowHeadSegments } from "@/lib/pdf/annotate";
import {
  NOTE_PADDING,
  arrowHeadSize,
  type EditorObject,
  type NoteObject,
  type TextBoxObject,
} from "@/lib/pdf/editor/model";
import { lineBaseline, lineLeft } from "@/lib/pdf/editor/text";
import type { TextKit } from "./measure";

/**
 * One object, drawn in page points inside the page's `<svg viewBox>` — the
 * same geometry, the same line breaks and the same baselines the export
 * writes (`editor-export.ts`), so zoom is the SVG's own scale and nothing on
 * screen is laid out by a browser line box.
 */

const urls = new WeakMap<Uint8Array, string>();

/** A blob URL for image bytes, made once per byte array. */
export function imageUrl(bytes: Uint8Array, format: "png" | "jpg"): string {
  let url = urls.get(bytes);
  if (!url) {
    const copy = new Uint8Array(bytes);
    url = URL.createObjectURL(
      new Blob([copy.buffer], {
        type: format === "png" ? "image/png" : "image/jpeg",
      }),
    );
    urls.set(bytes, url);
  }
  return url;
}

function Words({
  obj,
  kit,
  inset,
}: {
  obj: TextBoxObject | NoteObject;
  kit: TextKit;
  inset: number;
}) {
  const layout = kit.layout(obj);
  const width = obj.width - inset * 2;
  const styled = kit.styled(obj);
  return (
    <>
      {layout.lines.map((line, i) =>
        line.text.length === 0 ? null : (
          <text
            key={i}
            x={obj.x + inset + lineLeft(line.width, width, obj.align)}
            y={obj.y + inset + lineBaseline(i, obj)}
            fontFamily={kit.family(obj)}
            fontSize={obj.size}
            fontWeight={styled && obj.bold ? 700 : 400}
            fontStyle={styled && obj.italic ? "italic" : "normal"}
            fill={obj.color}
            style={{ whiteSpace: "pre", fontKerning: "none" }}
          >
            {line.text}
          </text>
        ),
      )}
    </>
  );
}

export function ObjectShape({
  obj,
  kit,
  hideWords = false,
}: {
  obj: EditorObject;
  kit: TextKit;
  hideWords?: boolean;
}) {
  switch (obj.kind) {
    case "text":
      return hideWords ? null : <Words obj={obj} kit={kit} inset={0} />;
    case "note": {
      const height = kit.height(obj) + NOTE_PADDING * 2;
      return (
        <>
          <rect
            x={obj.x}
            y={obj.y}
            width={obj.width}
            height={height}
            fill={obj.fill}
            stroke="#9e851a"
            strokeWidth={0.75}
          />
          {!hideWords && <Words obj={obj} kit={kit} inset={NOTE_PADDING} />}
        </>
      );
    }
    case "image":
    case "signature":
      return (
        <image
          href={imageUrl(obj.bytes, obj.format)}
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          preserveAspectRatio="none"
          opacity={obj.kind === "image" ? obj.opacity : 1}
        />
      );
    case "shape": {
      const paint = {
        fill: obj.fill ?? "none",
        fillOpacity: obj.opacity,
        stroke: obj.stroke ?? "none",
        strokeOpacity: obj.opacity,
        strokeWidth: obj.stroke ? obj.strokeWidth : 0,
      };
      return obj.shape === "rect" ? (
        <rect
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          {...paint}
        />
      ) : (
        <ellipse
          cx={obj.x + obj.width / 2}
          cy={obj.y + obj.height / 2}
          rx={obj.width / 2}
          ry={obj.height / 2}
          {...paint}
        />
      );
    }
    case "line": {
      const heads = obj.arrow
        ? arrowHeadSegments(
            obj.x1,
            obj.y1,
            obj.x2,
            obj.y2,
            arrowHeadSize(obj.strokeWidth),
          )
        : [];
      return (
        <g
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          strokeOpacity={obj.opacity}
          strokeLinecap="round"
        >
          <line x1={obj.x1} y1={obj.y1} x2={obj.x2} y2={obj.y2} />
          {heads.map((seg, i) => (
            <line
              key={i}
              x1={seg.start.x}
              y1={seg.start.y}
              x2={seg.end.x}
              y2={seg.end.y}
            />
          ))}
        </g>
      );
    }
    case "whiteout":
      return (
        <rect
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          fill="#ffffff"
        />
      );
    case "highlight":
      return (
        <rect
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          fill={obj.color}
          fillOpacity={obj.opacity}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    case "ink": {
      const pts =
        obj.points.length === 1 ? [obj.points[0]!, obj.points[0]!] : obj.points;
      return (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          strokeOpacity={obj.opacity}
          strokeLinecap="round"
        />
      );
    }
  }
}

/** A generous invisible target for thin objects, so they can be grabbed. */
export function HitArea({ obj, scale }: { obj: EditorObject; scale: number }) {
  const width = 12 / scale;
  if (obj.kind === "line") {
    return (
      <line
        x1={obj.x1}
        y1={obj.y1}
        x2={obj.x2}
        y2={obj.y2}
        stroke="transparent"
        strokeWidth={Math.max(width, obj.strokeWidth)}
        pointerEvents="stroke"
      />
    );
  }
  if (obj.kind === "ink") {
    return (
      <polyline
        points={obj.points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(width, obj.strokeWidth)}
        pointerEvents="stroke"
      />
    );
  }
  return null;
}
