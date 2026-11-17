"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  MAX_FIELD_LABEL_CHARS,
  MAX_REQUEST_FIELDS,
  type RequestSignatureFieldType,
} from "@/lib/jobs/request-signatures";
import type { VisiblePageFrame } from "@/lib/pdf/page-frame";
import {
  PRESET_ORDER,
  STEP_BIG_PT,
  STEP_PT,
  addField,
  clampField,
  moveField,
  nudgeField,
  readingOrder,
  resizeField,
  resizeFieldPt,
  signerColour,
  startingLayout,
  type LayoutField,
  type PresetKey,
} from "@/lib/signatures/request-layout";
import { announceOutcome } from "@/components/a11y/live-region";
import { usePageImageState } from "./runner/use-page-image";
import { ChipButton } from "./runner/runner-kit";

export {
  addStarterField,
  orphanBoxes,
  startingLayout,
  toRequestFields,
} from "@/lib/signatures/request-layout";
export type { LayoutField } from "@/lib/signatures/request-layout";

/**
 * Request Signatures' placement editor (audit #21, 2026-11-17): the page as
 * displayed with every box on it, drag to move, corner to resize, the arrow
 * keys, Add a box per signer and type, and a list of every box (its signer,
 * page and label, Show, Remove) that is also the whole non-pointer route.
 *
 * Loaded on demand: the panel starts this chunk WITH the PDF read, so no page
 * pays for it until a file is added (`src/deploy/lazy-chunks.test.ts` holds
 * {@link REQUEST_FIELD_EDITOR_CHUNK} off every first load). It edits only the
 * contract's unit (fractions of the displayed page, from the bottom-left, as
 * `@/lib/signatures/request-layout` defines it), so a box drawn here with
 * `left: x%`, `bottom: y%` is the field the worker places — the panel test
 * reads the drawn boxes against the job options on the wire.
 *
 * The panel owns the state (the custom layout, the signer rows, the undo
 * slot), so it can still send the starting layout if this chunk never loads.
 */
export const REQUEST_FIELD_EDITOR_CHUNK = "pdfxyz:lazy:request-field-editor";

/** Every signer row, blank ones included: boxes are owned by a row's id. */
export interface EditorSigner {
  id: number;
  /** Its 1-based position in the Signers list. */
  number: number;
  name: string;
  email: string;
}

const TYPE_WORD: Record<RequestSignatureFieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
};

const PRESET_WORD: Record<PresetKey, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  name: "Name",
  text: "Text",
};

/** A pointer must travel this far (CSS px) before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The least on-screen extent (CSS px) a new box keeps clear about each box:
 * a box's button is grown to 24 px (WCAG 2.5.8), and on a touch screen the
 * selected box's resize handle is 44 px (`tap`) centred on its corner, so
 * there it is that handle plus a margin.
 */
const POINTER_CLEAR_PX = 24;
const TOUCH_CLEAR_PX = 48;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function boxesPhrase(numbers: number[]): string {
  if (numbers.length === 1) return `Box ${numbers[0]}`;
  const head = numbers.slice(0, -1).join(", ");
  return `Boxes ${head} and ${numbers[numbers.length - 1]}`;
}

/**
 * Why the custom layout cannot be sent, in words, or null. A box whose owner
 * row is blank blocks Prepare — never dropped in silence (audit #18) — and so
 * does a signer left with no box, the worker's own rule
 * (`parseSignatureRequestOptions`: "every signer has at least one field").
 */
export function layoutProblem(
  layout: readonly LayoutField[],
  signers: readonly EditorSigner[],
  ownerIndex: ReadonlyMap<number, number>,
): string | null {
  const ordered = readingOrder(layout);
  const orphans = new Map<number, number[]>();
  ordered.forEach((f, i) => {
    if (ownerIndex.has(f.owner)) return;
    orphans.set(f.owner, [...(orphans.get(f.owner) ?? []), i + 1]);
  });
  for (const [owner, numbers] of orphans) {
    const one = numbers.length === 1;
    const row = signers.find((s) => s.id === owner);
    return row
      ? `${boxesPhrase(numbers)} ${one ? "belongs" : "belong"} to signer ${row.number}, who has no name or email yet. Fill in that row or remove ${one ? "that box" : "those boxes"}.`
      : `${boxesPhrase(numbers)} ${one ? "belongs" : "belong"} to a signer who was removed. Remove ${one ? "it" : "them"} or give ${one ? "it" : "them"} to another signer.`;
  }
  const owned = new Set(layout.map((f) => f.owner));
  for (const [id] of ownerIndex) {
    if (owned.has(id)) continue;
    const row = signers.find((s) => s.id === id);
    return `Signer ${row?.number ?? "?"} has no box to fill in. Add one for them.`;
  }
  return null;
}

export interface RequestFieldEditorProps {
  bytes: Uint8Array;
  frames: readonly VisiblePageFrame[];
  signers: readonly EditorSigner[];
  /** The ids of the signer rows that are sent, in order: the starting layout's owners. */
  ownerIds: readonly number[];
  /** Signature page and the date option: where the starting layout sits. */
  page: number;
  includeDate: boolean;
  /** The reader's layout, or null while it is still the starting one. */
  custom: LayoutField[] | null;
  /** Every change; `undoable` for the two destructive ones (Remove, Start over). */
  onCustom: (
    next: LayoutField[] | null,
    change: { say: string; undoable?: boolean },
  ) => void;
  shownPage: number;
  onShownPage: (page: number) => void;
  /** What the last undoable change did, shown with Undo until the next change. */
  note: string | null;
  onUndo: (() => void) | null;
}

export function RequestFieldEditor({
  bytes,
  frames,
  signers,
  ownerIds,
  page,
  includeDate,
  custom,
  onCustom,
  shownPage,
  onShownPage,
  note,
  onUndo,
}: RequestFieldEditorProps) {
  const layout = useMemo(
    () => custom ?? startingLayout(ownerIds, page, includeDate),
    [custom, ownerIds, page, includeDate],
  );
  const pageCount = frames.length;
  const shown = Math.min(Math.max(1, shownPage), pageCount);
  const frame = frames[shown - 1]!;
  const image = usePageImageState(bytes, shown - 1, 420).image;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const addRowRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [forId, setForId] = useState<number | null>(null);
  const focusNext = useRef<number | null>(null);
  const undoRowRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  // Where focus goes once the next render lands, for a control that removes
  // itself when pressed (Undo, Start over, a list row's bin).
  const pendingFocus = useRef<
    | { kind: "restored"; before: Set<number> }
    | { kind: "undo" }
    | { kind: "row"; id: number | null }
    | null
  >(null);
  // Tab follows the page top to bottom; during a drag the order is frozen,
  // since moving a node in the DOM would drop its pointer capture.
  const [frozen, setFrozen] = useState<number[] | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    [],
  );

  const signerOf = (owner: number) => signers.find((s) => s.id === owner);
  const numberOf = (owner: number) => signerOf(owner)?.number ?? 0;
  const nameOf = (s: EditorSigner) =>
    s.name.trim() || s.email.trim() || `Signer ${s.number}`;
  const boxName = (f: LayoutField) =>
    `Signer ${numberOf(f.owner)} ${TYPE_WORD[f.type]} box`;
  const where = (f: LayoutField) =>
    `${boxName(f)}: ${pct(f.x)} from the left, ${pct(f.y)} from the bottom`;
  const frameOf = (p: number) => frames[p - 1] ?? frame;

  const owner =
    forId !== null && signers.some((s) => s.id === forId)
      ? forId
      : (signers[0]?.id ?? null);
  const full = layout.length >= MAX_REQUEST_FIELDS;
  const listed = readingOrder(layout);
  const onPage = layout.filter((f) => f.page === shown);
  const order = frozen ?? readingOrder(onPage).map((f) => f.id);
  const drawn = [...onPage].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.id - b.id;
  });

  // A box to focus once it is drawn (after Show turned the page, or after a
  // Remove moved focus to the next box).
  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    const box = sheetRef.current?.querySelector<HTMLElement>(
      `[data-box-id="${id}"]`,
    );
    if (!box) return;
    focusNext.current = null;
    box.focus();
  });

  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const firstAdd = () =>
      addRowRef.current?.querySelector<HTMLButtonElement>("button");
    let target: HTMLElement | null | undefined = null;
    if (want.kind === "undo") {
      target = undoRowRef.current?.querySelector<HTMLButtonElement>("button");
    } else if (want.kind === "restored") {
      const back = drawn.find((f) => !want.before.has(f.id)) ?? drawn[0];
      target = back
        ? sheetRef.current?.querySelector<HTMLElement>(
            `[data-box-id="${back.id}"]`,
          )
        : firstAdd();
    } else {
      target =
        want.id === null
          ? firstAdd()
          : listRef.current?.querySelector<HTMLElement>(
              `[data-box-row="${want.id}"] [data-box-bin]`,
            );
    }
    (target ?? firstAdd())?.focus();
  });

  const replace = (next: LayoutField, say = "") =>
    onCustom(
      layout.map((f) => (f.id === next.id ? next : f)),
      { say },
    );

  const sayLater = (text: string) => {
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => announceOutcome(text), 400);
  };

  const add = (preset: PresetKey) => {
    if (full || owner === null) return;
    // The clearance a new box keeps, in points of THIS sheet as drawn: each
    // box's button is at least 24 CSS px, and the selected box's resize
    // handle is 44 px on a touch screen, so on a phone a fixed 40 pt let two
    // buttons overlap (review 2026-11-17, axe target-size at 375 px).
    const width = sheetRef.current?.getBoundingClientRect().width ?? 0;
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const clearPx = coarse ? TOUCH_CLEAR_PX : POINTER_CLEAR_PX;
    const next = addField(
      layout,
      preset,
      owner,
      shown,
      frame,
      width > 0 ? clearPx / (width / frame.width) : undefined,
    );
    const made = next[next.length - 1]!;
    setSelected(made.id);
    onCustom(next, {
      say: `Added ${boxName(made)} on page ${shown}`,
    });
  };

  const remove = (f: LayoutField, from: "sheet" | "list" = "sheet") => {
    const here = readingOrder(layout.filter((o) => o.page === f.page));
    const after = here[here.findIndex((o) => o.id === f.id) + 1];
    setSelected(after?.id ?? null);
    onCustom(
      layout.filter((o) => o.id !== f.id),
      { say: `Removed ${boxName(f)}`, undoable: true },
    );
    if (from === "list") {
      // Pressed in the list: focus stays in the list, on the next row's bin
      // (the one before when it was the last), or Add a box when none is left.
      const at = listed.findIndex((o) => o.id === f.id);
      const stay = listed[at + 1] ?? listed[at - 1];
      pendingFocus.current = { kind: "row", id: stay?.id ?? null };
    } else if (after && f.page === shown) focusNext.current = after.id;
    else addRowRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  const show = (f: LayoutField) => {
    onShownPage(f.page);
    setSelected(f.id);
    focusNext.current = f.id;
  };

  const turn = (to: number) => {
    setSelected(null);
    onShownPage(Math.min(pageCount, Math.max(1, to)));
  };

  return (
    <div
      className="flex flex-col gap-3"
      data-chunk={REQUEST_FIELD_EDITOR_CHUNK}
    >
      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted flex-1 text-xs leading-relaxed">
            You&apos;ve moved or added boxes, so Signature page and the date
            option no longer apply.
          </p>
          <ChipButton
            onClick={() => {
              // Start over removes its own button: focus goes to the Undo
              // chip that now shows.
              pendingFocus.current = { kind: "undo" };
              onCustom(null, {
                say: "Started over: the boxes are back where they began.",
                undoable: true,
              });
            }}
          >
            Start over
          </ChipButton>
        </div>
      )}

      <figure className="flex flex-col items-center gap-2">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <ChipButton onClick={() => turn(shown - 1)} disabled={shown <= 1}>
                <ChevronLeft className="size-3.5" aria-hidden />
                Previous page
              </ChipButton>
              <ChipButton
                onClick={() => turn(shown + 1)}
                disabled={shown >= pageCount}
              >
                Next page
                <ChevronRight className="size-3.5" aria-hidden />
              </ChipButton>
            </div>
          ) : (
            <span />
          )}
          <span className="text-muted tnum text-xs">
            {onPage.length} {onPage.length === 1 ? "box" : "boxes"} on this page
          </span>
        </div>
        <div
          ref={sheetRef}
          data-testid="signature-page-preview"
          className="rounded-sheet relative w-full overflow-hidden bg-white shadow-md ring-1 ring-black/10"
          style={{
            aspectRatio: `${frame.width} / ${frame.height}`,
            maxWidth: 420,
          }}
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget ||
              event.target instanceof HTMLImageElement
            )
              setSelected(null);
          }}
        >
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of a local render
            <img
              src={image.url}
              alt={image.note ?? ""}
              draggable={false}
              className="absolute inset-0 size-full"
            />
          )}
          {drawn.map((f) => (
            <FieldBox
              key={f.id}
              field={f}
              frame={frame}
              colour={signerColour(Math.max(0, numberOf(f.owner) - 1))}
              selected={selected === f.id}
              label={`Signer ${numberOf(f.owner)}, ${signerOf(f.owner) ? nameOf(signerOf(f.owner)!) : "no signer"}, ${TYPE_WORD[f.type]} box${f.label?.trim() ? `, labelled ${f.label.trim()}` : ""}, page ${f.page}`}
              text={`${numberOf(f.owner)} · ${f.label?.trim() || TYPE_WORD[f.type]}`}
              resizeLabel={`Resize ${boxName(f)}`}
              sheetRef={sheetRef}
              onSelect={() => setSelected(f.id)}
              onDeselect={() => setSelected(null)}
              onDrag={(next) => {
                if (!frozen) setFrozen(order);
                replace(next);
              }}
              onDrop={(next, moved) => {
                setFrozen(null);
                if (moved) announceOutcome(where(next));
              }}
              onKeyMove={(next) => {
                replace(next);
                sayLater(where(next));
              }}
              onKeyResize={(next) => {
                replace(next);
                sayLater(
                  `${boxName(next)}: ${pct(next.width)} wide, ${pct(next.height)} high`,
                );
              }}
              onRemove={() => remove(f)}
            />
          ))}
        </div>
        <figcaption className="text-muted text-center text-xs">
          Page {shown} of {pageCount}. Drag a box to move it, or select it and
          use the arrow keys.
        </figcaption>
      </figure>

      {note && (
        <div className="flex flex-wrap items-center gap-2" ref={undoRowRef}>
          <p className="text-muted flex-1 text-xs">{note}</p>
          {onUndo && (
            <ChipButton
              onClick={() => {
                // Undo removes its own chip: focus goes to a box it put
                // back, else the first box on the sheet, else Add a box.
                pendingFocus.current = {
                  kind: "restored",
                  before: new Set(layout.map((f) => f.id)),
                };
                onUndo();
              }}
            >
              Undo
            </ChipButton>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-faint kicker">Add a box</span>
        <label className="text-muted flex flex-col gap-1 text-xs">
          For
          <select
            value={owner ?? ""}
            onChange={(e) => setForId(Number(e.target.value))}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            {signers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} · {nameOf(s)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2" ref={addRowRef}>
          {PRESET_ORDER.map((key) => (
            <ChipButton key={key} onClick={() => add(key)} disabled={full}>
              {PRESET_WORD[key]}
            </ChipButton>
          ))}
        </div>
        {full && (
          <p className="text-warn text-xs">
            A request can hold up to {MAX_REQUEST_FIELDS} boxes. Remove one to
            add another.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-faint kicker">
          Boxes ({layout.length} of {MAX_REQUEST_FIELDS})
        </span>
        <ol className="flex flex-col gap-2" ref={listRef}>
          {listed.map((f, i) => {
            const n = i + 1;
            const num = numberOf(f.owner);
            const colour = signerColour(Math.max(0, num - 1));
            return (
              <li
                key={f.id}
                data-box-row={f.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                {/* The number in the panel's own text colour (the signer
                    colours reach 4.5:1 on the white sheet only, not on a
                    dark panel); the coloured border is the second cue. */}
                <span
                  className="text-fg rounded-tag grid size-6 shrink-0 place-items-center border text-xs font-semibold"
                  style={{ borderColor: colour }}
                  aria-hidden
                >
                  {num || "?"}
                </span>
                <span className="text-fg font-medium">
                  Box {n} · {TYPE_WORD[f.type]}
                </span>
                <select
                  aria-label={`Box ${n} signer`}
                  value={f.owner}
                  onChange={(e) =>
                    replace(
                      { ...f, owner: Number(e.target.value) },
                      `Box ${n} now belongs to signer ${numberOf(Number(e.target.value))}`,
                    )
                  }
                  className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
                >
                  {!signerOf(f.owner) && <option value={f.owner}>?</option>}
                  {signers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.number} · {nameOf(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Box ${n} page`}
                  value={f.page}
                  onChange={(e) => {
                    const to = Number(e.target.value);
                    replace(
                      clampField({ ...f, page: to }, frameOf(to)),
                      `Moved ${boxName(f)} to page ${to}`,
                    );
                  }}
                  className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
                >
                  {frames.map((_, p) => (
                    <option key={p} value={p + 1}>
                      Page {p + 1}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`Box ${n} label`}
                  value={f.label ?? ""}
                  maxLength={MAX_FIELD_LABEL_CHARS}
                  placeholder="Optional"
                  onChange={(e) => replace({ ...f, label: e.target.value })}
                  className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent rounded-ctl min-w-[8rem] flex-1 border px-3 py-1.5 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => show(f)}
                  aria-label={`Show box ${n}`}
                  className="text-accent hover:text-accent tap tap-y text-xs font-medium transition"
                >
                  Show
                </button>
                <button
                  type="button"
                  onClick={() => remove(f, "list")}
                  aria-label={`Remove box ${n}, ${boxName(f)}`}
                  data-box-bin=""
                  className="text-muted hover:text-err rounded-ctl tap shrink-0 p-1.5 transition"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * One box on the sheet: a button (Tab reaches it; its name says whose box it
 * is, so colour is never the only cue), dragged with pointer capture as Crop's
 * edge handles are (`crop-runner.tsx`), read against the sheet's on-screen
 * size so a pixel is the same share of the page the sheet draws. The selected
 * box gets one resize handle at its displayed bottom-right corner.
 */
function FieldBox({
  field,
  frame,
  colour,
  selected,
  label,
  text,
  resizeLabel,
  sheetRef,
  onSelect,
  onDeselect,
  onDrag,
  onDrop,
  onKeyMove,
  onKeyResize,
  onRemove,
}: {
  field: LayoutField;
  frame: VisiblePageFrame;
  colour: string;
  selected: boolean;
  label: string;
  text: string;
  resizeLabel: string;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onDeselect: () => void;
  onDrag: (next: LayoutField) => void;
  onDrop: (next: LayoutField, moved: boolean) => void;
  onKeyMove: (next: LayoutField) => void;
  onKeyResize: (next: LayoutField) => void;
  onRemove: () => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    start: LayoutField;
    last: LayoutField;
    moved: boolean;
    resize: boolean;
  } | null>(null);

  const begin = (
    event: React.PointerEvent<HTMLButtonElement>,
    resize: boolean,
  ) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      start: field,
      last: field,
      moved: false,
      resize,
    };
    onSelect();
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width <= 0 || rect.height <= 0) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    d.last = d.resize
      ? resizeField(d.start, dx / rect.width, dy / rect.height, frame)
      : moveField(d.start, dx / rect.width, -dy / rect.height, frame);
    onDrag(d.last);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d) onDrop(d.last, d.moved);
  };
  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onDrag(d.start);
    if (d) onDrop(d.start, false);
  };

  return (
    <>
      {/* The box as the field will be: exactly its rectangle, drawn under
          its button. Tests and the e2e spec read THIS against the request. */}
      <span
        aria-hidden
        data-field-box=""
        data-of={field.id}
        data-kind={field.type}
        className="rounded-tag absolute overflow-hidden px-0.5 text-left leading-tight font-semibold"
        style={{
          left: `${field.x * 100}%`,
          bottom: `${field.y * 100}%`,
          width: `${field.width * 100}%`,
          height: `${field.height * 100}%`,
          borderColor: colour,
          borderStyle: selected ? "solid" : "dashed",
          borderWidth: selected ? 2 : 1,
          color: colour,
          background: `${colour}1f`,
          fontSize: 10,
          pointerEvents: "none",
        }}
      >
        {text}
      </span>
      {/* Its button: the same rectangle grown to at least 24 x 24 px about
          its centre, so a box smaller than a fingertip on screen is still a
          24 px target (WCAG 2.5.8), and Tab reaches every box. */}
      <button
        type="button"
        data-box-id={field.id}
        aria-label={label}
        aria-pressed={selected}
        className="rounded-tag focus-visible:ring-accent/50 absolute outline-none focus-visible:ring-2"
        style={{
          left: `calc(${field.x * 100}% + (${field.width * 100}% - max(${field.width * 100}%, 24px)) / 2)`,
          bottom: `calc(${field.y * 100}% + (${field.height * 100}% - max(${field.height * 100}%, 24px)) / 2)`,
          width: `max(${field.width * 100}%, 24px)`,
          height: `max(${field.height * 100}%, 24px)`,
          background: "transparent",
          border: 0,
          touchAction: "none",
          cursor: "move",
          padding: 0,
        }}
        onPointerDown={(event) => begin(event, false)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        // Enter and Space press the toggle (a click with no pointer, detail
        // 0): select, or deselect when selected, so the resize handle is
        // reachable from the keyboard alone. A pointer press already
        // selected the box on pointerdown, so its click only keeps it so.
        onClick={(event) => {
          if (event.detail === 0 && selected) onDeselect();
          else onSelect();
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? STEP_BIG_PT : STEP_PT;
          const by: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          if (event.key in by) {
            event.preventDefault();
            const [dx, dy] = by[event.key]!;
            onKeyMove(nudgeField(field, dx, dy, frame));
          } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            onRemove();
          } else if (event.key === "Escape") {
            onDeselect();
          }
        }}
      />
      {selected && (
        <button
          type="button"
          data-resize-handle=""
          aria-label={resizeLabel}
          className="tap focus-visible:ring-accent/50 rounded-tag absolute z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center outline-none focus-visible:ring-2"
          style={{
            left: `${(field.x + field.width) * 100}%`,
            top: `${(1 - field.y) * 100}%`,
            cursor: "nwse-resize",
          }}
          onPointerDown={(event) => begin(event, true)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={cancel}
          onKeyDown={(event) => {
            const step = event.shiftKey ? STEP_BIG_PT : STEP_PT;
            const by: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            if (!(event.key in by)) return;
            event.preventDefault();
            const [dw, dh] = by[event.key]!;
            onKeyResize(resizeFieldPt(field, dw, dh, frame));
          }}
        >
          <span
            aria-hidden
            className="bg-accent rounded-tag ring-canvas shadow-sm ring-2"
            style={{ width: 10, height: 10, background: colour }}
          />
        </button>
      )}
    </>
  );
}
