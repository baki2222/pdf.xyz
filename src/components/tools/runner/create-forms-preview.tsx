"use client";

import { Fragment, useEffect, useRef } from "react";
import { announceOutcome } from "@/components/a11y/live-region";
import type { FieldBox } from "@/lib/pdf/field-boxes";
import {
  boxOnSheet,
  placeAt,
  sheetPoint,
  unionOf,
  type SheetBox,
  type SheetSize,
} from "@/lib/pdf/form-preview";
import { usePageImageState } from "./use-page-image";
import type { Finder, ProposalAct } from "./create-forms-detect";

/**
 * Create Fillable Forms' page preview (backlog #17, 2026-11-17): the page of
 * the selected card as a reader sees it, with every field on that page drawn
 * from the numbers on its card. A click on the page puts the selected field's
 * lower-left corner there, a box can be dragged, and a selected box moves with
 * the arrow keys (1 pt, 10 pt with Shift). Every one of those only writes X
 * and Y on the card (`onMove`); the card is what the engine is handed, so the
 * preview and the saved form cannot disagree. The numbers stay the source:
 * the preview is supplementary, and the cards are the whole non-pointer
 * route.
 *
 * Loaded on demand: the runner starts this chunk WITH the PDF read, so no page
 * pays for it until a file is added (`src/deploy/lazy-chunks.test.ts` holds
 * {@link CREATE_FORMS_PREVIEW_CHUNK} off every first load). The boxes come in
 * as props, read by the runner through the engine's own `fieldBoxes`, so this
 * chunk never imports the engine.
 */
export const CREATE_FORMS_PREVIEW_CHUNK = "pdfxyz:lazy:create-forms-preview";

/** One field on the shown page, as its card says it is. */
export interface PreviewField {
  id: string;
  /** The field's name as typed (blank allowed: the label says so). */
  name: string;
  type: string;
  /** Its type in words, e.g. "Text field". */
  kind: string;
  x: number;
  y: number;
  /** Its widget box(es) at that X/Y: `fieldBoxes` of its spec. */
  boxes: FieldBox[];
}

export interface CreateFormsPreviewProps {
  bytes: Uint8Array;
  /** The page shown, 1-based. */
  page: number;
  pageCount: number;
  /** That page's displayed size, in points (`readFormContext`). */
  size: SheetSize;
  /** Every field placed on that page. */
  fields: PreviewField[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, at: { x: number; y: number }) => void;
  /**
   * Find fields, once its chunk has loaded: the module and the builder as
   * it sees it. Its suggestions on this page are drawn in a third, dotted
   * state; a press selects one (never adds), Enter adds it, Delete
   * dismisses it. Type-only here: this chunk never loads the finder.
   */
  find?: { detect: DetectModule; finder: Finder } | null;
}

type DetectModule = typeof import("./create-forms-detect");

/** One of Find fields' suggestions on the shown page. */
export interface PreviewProposal {
  key: string;
  type: string;
  /** Its type in words, e.g. "Text field". */
  kind: string;
  label: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a suggestion's button is called. */
export function proposalLabel(p: PreviewProposal): string {
  return `Found ${p.kind.toLowerCase()}, ${p.label ? `“${p.label}”` : "no label"}, page ${p.page}, press Enter to add it or Delete to dismiss it`;
}

/** A pointer must travel this far (CSS px) before a press on a box drags it. */
const DRAG_THRESHOLD_PX = 4;
const STEP_PT = 1;
const STEP_BIG_PT = 10;

/*
 * Ink on the white page, each at least 4.5:1 against white
 * (`create-forms-preview.test.tsx` computes all three): the selected field
 * in blue, the rest in slate, Find fields' suggestions in rust. Colour is
 * the second cue — the selected box is also drawn solid and thicker, every
 * box carries its name, and a suggestion is dotted (inline styles: the
 * shipped stylesheet is at its ceiling).
 */
export const PREVIEW_INK = {
  selected: "#1d4ed8",
  other: "#334155",
  /** Find fields' suggestions: dotted, tinted, and named in their label. */
  proposed: "#9a3412",
} as const;

const pct = (share: number) => `${share * 100}%`;

/** A sheet box's place, grown to at least 24 x 24 px about its centre when `min`. */
function grown(s: SheetBox, min: boolean) {
  return min
    ? {
        left: `calc(${pct(s.left)} + (${pct(s.width)} - max(${pct(s.width)}, 24px)) / 2)`,
        bottom: `calc(${pct(s.bottom)} + (${pct(s.height)} - max(${pct(s.height)}, 24px)) / 2)`,
        width: `max(${pct(s.width)}, 24px)`,
        height: `max(${pct(s.height)}, 24px)`,
      }
    : {
        left: pct(s.left),
        bottom: pct(s.bottom),
        width: pct(s.width),
        height: pct(s.height),
      };
}

/** The suggestion whose centre is nearest `at` (points), if any. */
export function nearestProposal(
  list: readonly PreviewProposal[],
  at: { x: number; y: number },
): string | null {
  let best: string | null = null;
  let dist = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x + p.width / 2 - at.x, p.y + p.height / 2 - at.y);
    if (d < dist) {
      dist = d;
      best = p.key;
    }
  }
  return best;
}

/** The name a box is called by: the field's name, or that it has none. */
export function fieldLabel(f: Pick<PreviewField, "name" | "kind">): string {
  return `${f.name.trim() || "Unnamed field"}, ${f.kind}`;
}

export function CreateFormsPreview({
  bytes,
  page,
  pageCount,
  size,
  fields,
  selectedId,
  onSelect,
  onMove,
  find,
}: CreateFormsPreviewProps) {
  const proposals: PreviewProposal[] = find
    ? find.detect.onPage(find.finder.found.list, page)
    : [];
  const selectedProposal = find?.finder.selected ?? null;
  const onProposal = (key: string, act: ProposalAct) =>
    find?.detect.act(find.finder, key, act);
  const image = usePageImageState(bytes, page - 1, 420);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A press on the page itself: the selected field follows the pointer
  // while it is held (a tap places it). `start` is where the field was
  // before the press: a press the browser takes back (a finger that swipes
  // to scroll the page fires pointercancel) puts it back there, unannounced,
  // since nothing was announced.
  const follow = useRef<{
    id: string;
    pointer: number;
    start: { x: number; y: number };
  } | null>(null);
  useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    [],
  );
  const selected = fields.find((f) => f.id === selectedId) ?? null;
  // Find fields' suggestions take ONE place in the tab order: the selected
  // one, else the first. Packed checkboxes sit closer than 24 px apart on
  // the sheet, and a button each would be packed targets (axe
  // target-size); each suggestion is also in the review list, with its own
  // Add and Dismiss.
  const current =
    proposals.find((p) => p.key === selectedProposal) ?? proposals[0] ?? null;
  /** The suggestion nearest a press, by centre: overlapping areas resolve so. */
  const pressed = (event: {
    clientX: number;
    clientY: number;
    detail?: number;
  }) => {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || event.detail === 0)
      return null;
    return nearestProposal(
      proposals,
      sheetPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect,
        size,
      ),
    );
  };

  const sayLater = (text: string) => {
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => announceOutcome(text), 400);
  };
  const where = (f: PreviewField, at: { x: number; y: number }) =>
    `${fieldLabel(f)}: X ${at.x}, Y ${at.y}`;

  /** Put `f`'s lower-left corner at the pointer, as far as the page allows. */
  const placeAtPointer = (
    f: PreviewField,
    clientX: number,
    clientY: number,
  ) => {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const to = sheetPoint(clientX - rect.left, clientY - rect.top, rect, size);
    const at = placeAt(to, f, f.boxes, size);
    onMove(f.id, at);
    return at;
  };

  return (
    <figure
      className="flex flex-col items-center gap-2"
      data-chunk={CREATE_FORMS_PREVIEW_CHUNK}
    >
      <div
        ref={sheetRef}
        data-testid="form-page-preview"
        className="rounded-sheet relative w-full overflow-hidden bg-white shadow-md ring-1 ring-black/10"
        style={{
          aspectRatio: `${size.width} / ${size.height}`,
          maxWidth: 420,
          cursor: selected ? "crosshair" : undefined,
        }}
        onPointerDown={(event) => {
          if (
            !selected ||
            (event.button !== 0 && event.pointerType === "mouse") ||
            !(
              event.target === event.currentTarget ||
              event.target instanceof HTMLImageElement
            )
          )
            return;
          event.preventDefault();
          const start = { x: selected.x, y: selected.y };
          const at = placeAtPointer(selected, event.clientX, event.clientY);
          if (!at) return;
          follow.current = { id: selected.id, pointer: event.pointerId, start };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const f = follow.current;
          if (!f || f.pointer !== event.pointerId) return;
          const field = fields.find((o) => o.id === f.id);
          if (field) placeAtPointer(field, event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          const f = follow.current;
          if (!f || f.pointer !== event.pointerId) return;
          follow.current = null;
          const field = fields.find((o) => o.id === f.id);
          const at = field
            ? placeAtPointer(field, event.clientX, event.clientY)
            : null;
          if (field && at) announceOutcome(where(field, at));
        }}
        onPointerCancel={(event) => {
          const f = follow.current;
          if (!f || f.pointer !== event.pointerId) return;
          follow.current = null;
          onMove(f.id, f.start);
        }}
      >
        {image.image && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a local render
          <img
            src={image.image.url}
            alt={image.image.note ?? ""}
            draggable={false}
            className="absolute inset-0 size-full"
          />
        )}
        {fields.map((f) => (
          <PreviewBox
            key={f.id}
            field={f}
            size={size}
            selected={f.id === selectedId}
            sheetRef={sheetRef}
            onSelect={() => onSelect(f.id)}
            onMove={(at) => onMove(f.id, at)}
            onDrop={(at) => announceOutcome(where(f, at))}
            onNudge={(at) => {
              onMove(f.id, at);
              sayLater(where(f, at));
            }}
          />
        ))}
        {proposals.map((p) => {
          const s = boxOnSheet(p, size);
          const on = p.key === selectedProposal;
          const ink = PREVIEW_INK.proposed;
          return (
            <Fragment key={p.key}>
              <span
                aria-hidden
                data-proposed={p.key}
                className="rounded-tag absolute"
                style={{
                  ...grown(s, false),
                  border: `${on ? 2 : 1.5}px dotted ${ink}`,
                  background: `${ink}${on ? "2e" : "14"}`,
                  pointerEvents: "none",
                }}
              />
              {/* A pointer's way in to every suggestion: not a control (the
                  keyboard's is the one button below, and the review list),
                  so packed suggestions are not packed targets. */}
              <span
                aria-hidden
                data-proposal-hit={p.key}
                className="absolute"
                style={{ ...grown(s, true), cursor: "pointer" }}
                onPointerUp={(event) =>
                  onProposal(pressed(event) ?? p.key, "select")
                }
              />
            </Fragment>
          );
        })}
        {current && (
          <button
            type="button"
            data-proposal={current.key}
            aria-label={proposalLabel(current)}
            aria-pressed={current.key === selectedProposal}
            className="rounded-tag focus-visible:ring-accent/50 absolute outline-none focus-visible:ring-2"
            style={{
              ...grown(boxOnSheet(current, size), true),
              background: "transparent",
              border: 0,
              padding: 0,
            }}
            onClick={(event) =>
              // A press SELECTS, never adds.
              onProposal(pressed(event) ?? current.key, "select")
            }
            onKeyDown={(event) => {
              const act =
                event.key === "Enter"
                  ? "add"
                  : event.key === "Delete" || event.key === "Backspace"
                    ? "dismiss"
                    : null;
              if (!act) return;
              event.preventDefault();
              onProposal(current.key, act);
            }}
          />
        )}
      </div>
      <figcaption className="text-muted text-center text-xs leading-relaxed">
        Page {page} of {pageCount}.{" "}
        {selected
          ? `Click the page to move the bottom-left corner of ${selected.name.trim() || "the unnamed field"} there, or drag its box. A selected box also moves with the arrow keys: 1 pt at a time, 10 pt with Shift.`
          : fields.length > 0
            ? "Select a box to move it."
            : "Add a field to see it here."}{" "}
        Each move changes X and Y on the field&apos;s card, and the form is
        built from those numbers.
        {proposals.length > 0
          ? " Dotted boxes are suggestions from Find fields: press one to show it in the list, where you add or dismiss it."
          : ""}
        {image.state === "failed"
          ? " The page itself could not be drawn, so the boxes are shown on a blank sheet of the same size."
          : ""}
      </figcaption>
    </figure>
  );
}

/**
 * One field on the sheet: its box(es) exactly as the engine will write them
 * (`data-field-box`, read by the tests and the e2e spec against the saved
 * widgets), under one button over the whole field (a radio group's stack is
 * one field), grown to at least 24 x 24 px about its centre (WCAG 2.5.8).
 */
function PreviewBox({
  field,
  size,
  selected,
  sheetRef,
  onSelect,
  onMove,
  onDrop,
  onNudge,
}: {
  field: PreviewField;
  size: SheetSize;
  selected: boolean;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onMove: (at: { x: number; y: number }) => void;
  onDrop: (at: { x: number; y: number }) => void;
  onNudge: (at: { x: number; y: number }) => void;
}) {
  const drag = useRef<{
    cx: number;
    cy: number;
    start: { x: number; y: number };
    boxes: FieldBox[];
    last: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const ink = selected ? PREVIEW_INK.selected : PREVIEW_INK.other;
  const union = unionOf(field.boxes);
  const u = union ? boxOnSheet(union, size) : null;

  return (
    <>
      {field.boxes.map((box, i) => {
        const s = boxOnSheet(box, size);
        return (
          <span
            key={i}
            aria-hidden
            data-field-box=""
            data-of={field.id}
            data-kind={field.type}
            className="rounded-tag absolute overflow-hidden px-0.5 text-left leading-tight font-semibold"
            style={{
              left: pct(s.left),
              bottom: pct(s.bottom),
              width: pct(s.width),
              height: pct(s.height),
              borderColor: ink,
              borderStyle: selected ? "solid" : "dashed",
              borderWidth: selected ? 2 : 1,
              color: ink,
              background: `${ink}1f`,
              fontSize: 10,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {i === 0 ? field.name.trim() : ""}
          </span>
        );
      })}
      {u && (
        <button
          type="button"
          data-preview-field={field.id}
          aria-label={`${fieldLabel(field)}, X ${field.x}, Y ${field.y}`}
          aria-pressed={selected}
          className="rounded-tag focus-visible:ring-accent/50 absolute outline-none focus-visible:ring-2"
          style={{
            left: `calc(${pct(u.left)} + (${pct(u.width)} - max(${pct(u.width)}, 24px)) / 2)`,
            bottom: `calc(${pct(u.bottom)} + (${pct(u.height)} - max(${pct(u.height)}, 24px)) / 2)`,
            width: `max(${pct(u.width)}, 24px)`,
            height: `max(${pct(u.height)}, 24px)`,
            background: "transparent",
            border: 0,
            padding: 0,
            touchAction: "none",
            cursor: "move",
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === "mouse") return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            const start = { x: field.x, y: field.y };
            drag.current = {
              cx: event.clientX,
              cy: event.clientY,
              start,
              boxes: field.boxes,
              last: start,
              moved: false,
            };
            onSelect();
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            const rect = sheetRef.current?.getBoundingClientRect();
            if (!d || !rect || rect.width <= 0 || rect.height <= 0) return;
            const dx = event.clientX - d.cx;
            const dy = event.clientY - d.cy;
            if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            d.moved = true;
            d.last = placeAt(
              {
                x: d.start.x + (dx / rect.width) * size.width,
                y: d.start.y - (dy / rect.height) * size.height,
              },
              d.start,
              d.boxes,
              size,
            );
            onMove(d.last);
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) onDrop(d.last);
          }}
          onPointerCancel={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) onMove(d.start);
          }}
          onClick={onSelect}
          onKeyDown={(event) => {
            const step = event.shiftKey ? STEP_BIG_PT : STEP_PT;
            const by: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const move = by[event.key];
            if (!move) return;
            event.preventDefault();
            if (!selected) onSelect();
            onNudge(
              placeAt(
                { x: field.x + move[0], y: field.y + move[1] },
                field,
                field.boxes,
                size,
              ),
            );
          }}
        />
      )}
    </>
  );
}
