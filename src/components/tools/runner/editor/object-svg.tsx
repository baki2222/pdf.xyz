"use client";

import { arrowHeadSegments } from "@/lib/pdf/annotate";
import {
  NOTE_PADDING,
  arrowHeadSize,
  markStrokeWidth,
  markStrokes,
  radioRows,
  type EditorObject,
  type FieldObject,
  type NoteObject,
  type TextBoxObject,
  type TextEditObject,
} from "@/lib/pdf/editor/model";
import {
  CSS_FONT_STACK,
  lineBaseline,
  lineLeft,
  needsUnicodeFace,
} from "@/lib/pdf/editor/text";
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

/**
 * Edited page text: a white cover over the run as it was (the canvas still
 * shows the original until export removes it), and the new words on the
 * run's own baseline, size, colour and slant.
 */
function EditedText({
  obj,
  kit,
  hideWords,
}: {
  obj: TextEditObject;
  kit: TextKit;
  hideWords: boolean;
}) {
  const unicode = needsUnicodeFace(obj.text);
  const family = unicode
    ? kit.family(
        { ...obj, kind: "text", align: "left", lineHeight: 1 } as never,
        obj.text,
      )
    : CSS_FONT_STACK[obj.font];
  const pad = Math.max(0.5, obj.size * 0.06);
  return (
    <>
      <rect
        data-cover=""
        x={obj.x - pad}
        y={obj.y - pad}
        width={obj.width + pad * 2}
        height={obj.height + pad * 2}
        fill="#ffffff"
      />
      {!hideWords && obj.text.length > 0 && (
        <text
          x={obj.baseX}
          y={obj.baseY}
          transform={
            Math.abs(obj.angle) > 0.01
              ? `rotate(${obj.angle} ${obj.baseX} ${obj.baseY})`
              : undefined
          }
          fontFamily={family}
          fontSize={obj.size}
          fontWeight={!unicode && obj.bold ? 700 : 400}
          fontStyle={!unicode && obj.italic ? "italic" : "normal"}
          fill={obj.color}
          style={{ whiteSpace: "pre", fontKerning: "none" }}
        >
          {obj.text}
        </text>
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
      const height = Math.max(
        kit.height(obj) + NOTE_PADDING * 2,
        obj.height ?? 0,
      );
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
    case "textedit":
      return <EditedText obj={obj} kit={kit} hideWords={hideWords} />;
    case "redact":
      return (
        <rect
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          fill={obj.fill === "white" ? "#ffffff" : "#000000"}
          fillOpacity={0.88}
          stroke="#dc2626"
          strokeWidth={1.25}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
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
    case "link":
      return (
        <rect
          data-link-box={obj.target.type}
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          fill="#2563eb"
          fillOpacity={0.08}
          stroke="#2563eb"
          strokeWidth={1.25}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
      );
    case "mark":
      return (
        <g
          stroke={obj.color}
          strokeWidth={markStrokeWidth(obj)}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {markStrokes(obj).map((stroke, i) => (
            <polyline
              key={i}
              points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
            />
          ))}
        </g>
      );
    case "field":
      return <FieldShape obj={obj} />;
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

const FIELD_FILL = "#dbeafe";
const FIELD_LINE = "#3b82f6";

/**
 * A new form field as a reader's viewer shows an empty form: a tinted box,
 * its starting value or its name, and the control's own mark — so what is
 * on the page reads as "a field goes here", not as page content.
 */
function FieldShape({ obj }: { obj: FieldObject }) {
  const font = CSS_FONT_STACK.helvetica;
  const size = Math.max(4, Math.min(obj.height * 0.6, 12));
  const box = (
    <rect
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      fill={FIELD_FILL}
      fillOpacity={0.55}
      stroke={FIELD_LINE}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      {...(obj.fieldType === "signature" ? { strokeDasharray: "4 3" } : {})}
    />
  );
  const words = (text: string, muted: boolean, inset = 2) => (
    <text
      x={obj.x + inset}
      y={obj.y + obj.height / 2 + size * 0.35}
      fontFamily={font}
      fontSize={size}
      fontStyle={muted ? "italic" : "normal"}
      fill={muted ? "#64748b" : "#111827"}
      style={{ whiteSpace: "pre" }}
    >
      {text}
    </text>
  );
  switch (obj.fieldType) {
    case "text":
      return (
        <g data-field-kind="text">
          {box}
          {obj.value ? words(obj.value, false) : words(obj.name, true)}
        </g>
      );
    case "checkbox":
      return (
        <g data-field-kind="checkbox">
          {box}
          {obj.checked && (
            <polyline
              points={markStrokes({ ...obj, glyph: "check" })[0]!
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              fill="none"
              stroke="#111827"
              strokeWidth={markStrokeWidth(obj)}
              strokeLinecap="round"
            />
          )}
        </g>
      );
    case "dropdown": {
      const t = Math.min(obj.height * 0.25, 5);
      const cx = obj.x + obj.width - t * 2;
      const cy = obj.y + obj.height / 2;
      return (
        <g data-field-kind="dropdown">
          {box}
          {obj.value ? words(obj.value, false) : words(obj.name, true)}
          <path
            d={`M ${cx - t} ${cy - t / 2} L ${cx + t} ${cy - t / 2} L ${cx} ${cy + t / 2} Z`}
            fill="#475569"
          />
        </g>
      );
    }
    case "radio":
      return (
        <g data-field-kind="radio">
          <rect
            x={obj.x}
            y={obj.y}
            width={obj.width}
            height={obj.height}
            fill="none"
            stroke={FIELD_LINE}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          {radioRows(obj).map((row, i) => {
            const r = row.box.width / 2;
            return (
              <g key={i}>
                <circle
                  cx={row.box.x + r}
                  cy={row.box.y + r}
                  r={r}
                  fill={FIELD_FILL}
                  stroke={FIELD_LINE}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {obj.value === obj.options[i] && (
                  <circle
                    cx={row.box.x + r}
                    cy={row.box.y + r}
                    r={r * 0.45}
                    fill="#111827"
                  />
                )}
                <text
                  x={row.labelX}
                  y={row.baseline}
                  fontFamily={font}
                  fontSize={row.size}
                  fill="#111827"
                  style={{ whiteSpace: "pre" }}
                >
                  {obj.options[i]}
                </text>
              </g>
            );
          })}
        </g>
      );
    case "signature":
      return (
        <g data-field-kind="signature">
          {box}
          {words("Sign here", true, 4)}
        </g>
      );
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
