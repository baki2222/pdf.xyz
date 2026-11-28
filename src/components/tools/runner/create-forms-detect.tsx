"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  NewCheckBoxField,
  NewFormContext,
  NewTextField,
  validateFormFields,
} from "@/lib/pdf/create-forms";
import {
  DETECTION_RULES,
  filterValid,
  nameFor,
  type FieldProposal,
  type Placement,
} from "@/lib/pdf/form-detect";
import {
  detectFormFields,
  type DetectReport,
  type PageOutcome,
} from "@/lib/pdf/form-detect-read";

/**
 * Create Fillable Forms' "Find fields" (backlog #17, slice S2, 2026-11-18):
 * the review list, its summary and the run itself. The builder fetches this
 * chunk when Find fields is pressed, never before (no prefetch: most visits
 * never press it, and pdf.js is already warm from the page preview), and
 * `src/deploy/lazy-chunks.test.ts` holds {@link CREATE_FORMS_DETECT_CHUNK}
 * off every first load.
 *
 * What it finds are SUGGESTIONS held beside the cards, never cards: the
 * runner keeps them in their own `found` state, so the engine, the
 * card validation and "Create form" cannot see one until a person presses
 * Add. Add names it then, against the cards and the other suggestions as
 * they are at that moment, and leaves in the list, with its reason, what
 * the builder's own validation (`validateFormFields`, handed in as a
 * callback: this chunk never imports create-forms.ts at run time) still
 * refuses.
 *
 * Every sentence this file can show is in the copy guard's corpus
 * (`create-forms-detect-copy.test.ts` renders {@link summarize} for every
 * page outcome), and each one that says something was found or suggested
 * also tells the reader to check or add it.
 */
export const CREATE_FORMS_DETECT_CHUNK = "pdfxyz:lazy:create-forms-detect";

/** Sign PDF, linked from the skipped-signature-lines line (held to the catalogue by linked-tool-names.test.ts). */
export const CREATE_FORMS_SIGN_PDF = {
  slug: "sign-pdf",
  name: "Sign PDF",
} as const;

/**
 * Edit PDF, linked from the same line: a form's author wants an empty
 * signature field there, which Edit PDF places (this builder has no
 * signature type); Sign PDF signs the document itself.
 */
export const CREATE_FORMS_DETECT_EDIT_PDF = {
  slug: "edit-pdf",
  name: "Edit PDF",
} as const;

/**
 * A suggestion waiting in the review list; `name` is set once a person edits
 * it, `refused` once Add could not add it (the builder's own reason). A
 * refused suggestion stays in the list so it can be fixed and added.
 */
export type Pending = FieldProposal & { name?: string; refused?: string };

/**
 * What a field's type is called, as the builder's type switch calls it
 * (`FIELD_TYPE_LABELS` in offered-kinds.ts, a first-load module this chunk
 * must not import: a second importer breaks its concatenation). Held equal
 * to it by create-forms-find-fields.test.tsx.
 */
export const KINDS = { text: "Text field", checkbox: "Checkbox" } as const;

const join = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** What Find fields looks for, in the words DETECTION_RULES gives each shape. */
export const LOOKS_FOR = join(DETECTION_RULES.map((r) => r.plain));

/**
 * The sentence that says what it does, derived from DETECTION_RULES, and the
 * one that says what it does not do: it can miss a field (S1's Known misses,
 * and every shape EXCLUSION_RULES passes over), so neither may say "each"
 * or "every" of what it finds.
 */
export const FIND_FIELDS_SENTENCE = `Find fields looks for ${LOOKS_FOR}, and suggests fields from what it sees for you to check and add.`;
export const FIND_FIELDS_MISSES =
  "It can miss a field or suggest a wrong one, so check each page and add anything it missed with Add field.";

/**
 * The reader, behind a seam: the builder's jsdom tests hand in a canned
 * report (pdf.js cannot open a worker there). The composed chain, the real
 * reader under the real page, is e2e/create-forms-detect.spec.ts.
 */
export const detectDeps = { detect: detectFormFields };

/** Run the finder over the PDF. `drafts` are the cards already placed. */
export function findFields(
  bytes: Uint8Array,
  o: {
    signal?: AbortSignal;
    onPage?: (done: number, total: number) => void;
    drafts?: readonly Placement[];
  } = {},
): Promise<DetectReport> {
  return detectDeps.detect(bytes, o);
}

/* ------------------------------------------------------------------ *
 *  The summary, in plain words
 * ------------------------------------------------------------------ */

/** "page 3", "pages 3 and 4", "pages 3 to 7", "pages 2, 5 to 9 and 12". */
export function pagesWord(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 1) return `page ${sorted[0]}`;
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]} to ${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
    i = j + 1;
  }
  return `pages ${join(parts)}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** One line of the summary; `links` names the words to link, in order. */
export interface SummaryLine {
  text: string;
  links?: { words: string; href: string }[];
}

/**
 * The summary of a run, one line per outcome kind and per count, each in
 * plain words. Nothing here says a page has no fields: a page with nothing
 * suggested is one to check by hand.
 */
export function summarize(report: DetectReport): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const of = <K extends PageOutcome["outcome"]>(k: K) =>
    report.pages.filter((p) => p.outcome === k).map((p) => p.page);
  const total = report.pages.length;
  const found = report.pages.filter((p) => p.outcome === "found");
  const n = found.reduce(
    (sum, p) => sum + (p.outcome === "found" ? p.proposals.length : 0),
    0,
  );
  if (n === 0)
    lines.push({
      text: "Found nothing to suggest, so add each field the form needs with Add field.",
    });
  else
    lines.push({
      text: `Found ${plural(n, "possible field", "possible fields")}${
        total > 1 ? ` on ${found.length} of ${total} pages` : ""
      }: check each one, as nothing is added until you add it.`,
    });
  const quiet = of("no-candidates");
  if (quiet.length > 0 && n > 0)
    lines.push({
      text: `Nothing was suggested on ${pagesWord(quiet)}: check ${quiet.length === 1 ? "it" : "them"} and add any field by hand.`,
    });
  const scans = of("no-text-layer");
  if (scans.length > 0)
    lines.push({
      text:
        scans.length === 1
          ? `${cap(pagesWord(scans))} is only a picture, with no text to read, so it was not searched: add its fields by hand.`
          : `${cap(pagesWord(scans))} are only pictures, with no text to read, so they were not searched: add their fields by hand.`,
    });
  const blank = of("nothing-drawn");
  if (blank.length > 0)
    lines.push({
      text: `Nothing could be read on ${pagesWord(blank)}: it may be blank or damaged, so add any field it needs by hand.`,
    });
  const turned = of("turned-content");
  if (turned.length > 0)
    lines.push({
      text: `The writing on ${pagesWord(turned)} shows sideways or upside down, which Find fields cannot read: add those fields by hand.`,
    });
  const unread = of("unread");
  if (unread.length > 0)
    lines.push({
      text: `${cap(pagesWord(unread))} could not be read: add ${unread.length === 1 ? "its" : "their"} fields by hand.`,
    });
  const complex = report.pages
    .filter((p) => p.outcome === "skipped" && p.reason === "too-complex")
    .map((p) => p.page);
  if (complex.length > 0)
    lines.push({
      text: `${cap(pagesWord(complex))} ${complex.length === 1 ? "has too many drawn lines to search: add its" : "have too many drawn lines to search: add their"} fields by hand.`,
    });
  const capped = report.pages
    .filter((p) => p.outcome === "skipped" && p.reason === "page-cap")
    .map((p) => p.page);
  if (capped.length > 0)
    lines.push({
      text: `Only the first ${total - capped.length} pages are searched, so ${pagesWord(capped)} ${capped.length === 1 ? "was" : "were"} not: add their fields by hand.`,
    });
  const c = report.counts;
  if (c.signatureLines > 0)
    lines.push({
      text: `${plural(c.signatureLines, "line labelled as a signature was", "lines labelled as a signature were")} skipped: ${CREATE_FORMS_DETECT_EDIT_PDF.name} adds a signature field, and ${CREATE_FORMS_SIGN_PDF.name} signs the PDF.`,
      links: [CREATE_FORMS_DETECT_EDIT_PDF, CREATE_FORMS_SIGN_PDF].map((t) => ({
        words: t.name,
        href: `/tools/${t.slug}`,
      })),
    });
  if (c.alreadyFields > 0)
    lines.push({
      text: `${plural(c.alreadyFields, "line already has", "lines already have")} a field, so ${c.alreadyFields === 1 ? "it was" : "they were"} left alone.`,
    });
  if (c.rotatedText > 0)
    lines.push({
      text: `${plural(c.rotatedText, "line has", "lines have")} a label that is not upright, so ${c.rotatedText === 1 ? "it was" : "they were"} skipped: add ${c.rotatedText === 1 ? "it" : "those"} by hand.`,
    });
  // A table of over 200 empty cells is not expanded (slice S5): one line,
  // however many cells, so it never floods the review list.
  if (c.largeTables > 0)
    lines.push({
      text: `${plural(c.largeTables, "table has", "tables have")} more than 200 empty cells, too many to suggest one by one: add ${c.largeTables === 1 ? "its" : "their"} fields with Add field.`,
    });
  // The pages the caps took from, named, so a page the run cap emptied is
  // never read as one with nothing on it (review round 7).
  const short = report.pages
    .filter(
      (p) =>
        p.outcome === "capped" ||
        (p.outcome === "found" && (p.leftOut ?? 0) > 0),
    )
    .map((p) => p.page);
  if (c.capped > 0)
    lines.push({
      text: `${plural(c.capped, "more possible field was", "more possible fields were")} left out${
        short.length > 0 ? ` on ${pagesWord(short)}` : ""
      }, as at most 60 are suggested on a page and 300 in all: check ${
        short.length === 1 ? "that page" : "those pages"
      } and add the rest by hand.`,
    });
  return lines;
}

/** Said when Add could not add some suggestions; each stays, with its reason. */
export function invalidLine(n: number): string {
  return n === 1
    ? "1 suggestion could not be added as it is: fix it below and press Add again."
    : `${n} suggestions could not be added as they are: fix them below and press Add again.`;
}

/* ------------------------------------------------------------------ *
 *  Names, and what Add hands the builder
 * ------------------------------------------------------------------ */

/**
 * The name each suggestion would be added under, in list order: the one a
 * person typed, or `nameFor` its label, unique against `taken` (the PDF's
 * fields and the cards) and every name before it in the list.
 */
export function suggestedNames(
  pending: readonly Pending[],
  taken: Iterable<string>,
): Map<string, string> {
  const names = new Set(taken);
  const per = { text: 0, checkbox: 0 };
  const out = new Map<string, string>();
  for (const p of pending) {
    per[p.type]++;
    const name =
      p.name !== undefined
        ? p.name
        : nameFor(p.label, p.type, names, per[p.type]);
    names.add(name);
    out.set(p.key, name);
  }
  return out;
}

/** A suggestion as the builder's spec, under `name`. */
function toSpec(p: Pending, name: string): NewTextField | NewCheckBoxField {
  const at = {
    name,
    page: p.page,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  };
  return p.type === "text"
    ? { type: "text", ...at, ...(p.multiline ? { multiline: true } : {}) }
    : { type: "checkbox", ...at, checked: false };
}

/**
 * The suggestions in `keys`, named against everything as it is NOW and
 * filtered by the builder's own validation (`validate`, the runner's
 * `validateFormFields` bound to the PDF's pages and the names already
 * taken): what passes is added, what does not is dropped and counted.
 */
export function toAdd(
  pending: readonly Pending[],
  keys: ReadonlySet<string>,
  taken: Iterable<string>,
  validate: (
    specs: (NewTextField | NewCheckBoxField)[],
  ) => { index: number; message?: string }[],
): {
  added: { key: string; spec: NewTextField | NewCheckBoxField }[];
  /** Each suggestion refused, with the builder's reason. */
  dropped: { key: string; reason: string }[];
} {
  const names = suggestedNames(pending, taken);
  const chosen = pending
    .filter((p) => keys.has(p.key))
    .map((p) => ({ key: p.key, spec: toSpec(p, names.get(p.key)!) }));
  const { kept } = filterValid(chosen, (all) =>
    validate(all.map((c) => c.spec)),
  );
  const specs = kept.map((c) => c.spec);
  return {
    added: kept,
    dropped: chosen
      .filter((c) => !kept.includes(c))
      .map((c) => {
        // Its reason beside what WAS added (a name another added row took).
        const errs = validate([...specs, c.spec]);
        const own = errs.find((e) => e.index === specs.length) ?? errs[0];
        return {
          key: c.key,
          reason: own?.message ?? "the builder could not add it.",
        };
      }),
  };
}

/* ------------------------------------------------------------------ *
 *  The builder's side: what Find fields reads and changes
 * ------------------------------------------------------------------ */

/** The part of a builder card Find fields reads and writes. */
export interface DraftLike {
  id: string;
  type: string;
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A text card's "Multiple lines" (a multiline suggestion turns it on). */
  multiline?: boolean;
}

/** The suggestions waiting, and a note from the last Add, if any. */
export interface Found {
  list: Pending[];
  note: string | null;
}

/**
 * The builder, as Find fields sees it. The runner builds this each render
 * and hands it over, so the review list, Add, the run bar's note and the
 * preview's third state all live in this chunk, and the page's first load
 * carries only the state and this one object (S2 budget: 0.3 KB gz on the
 * merged build).
 */
export interface Finder<D extends DraftLike = DraftLike> {
  bytes: Uint8Array;
  drafts: D[];
  // Method syntax (bivariant): the preview holds a Finder of any card type.
  setDrafts(drafts: D[]): void;
  /** The cards are still the one untouched starter card. */
  untouched: boolean;
  /** A new card with the builder's defaults (`makeDraft`), under `id`. */
  make(id: string): D;
  context: Pick<NewFormContext, "existingNames" | "pageSizes">;
  /** The builder's own `validateFormFields`: the second bound, passed in. */
  validate: typeof validateFormFields;
  found: Found;
  setFound: Dispatch<SetStateAction<Found>>;
  /** What is selected: a card's id, or a suggestion's key. */
  selected: string | null;
  /** Select a card, or a suggestion by its key. */
  select: (idOrKey: string) => void;
}

/** The names the PDF's fields and `drafts` already hold. */
const takenBy = <D extends DraftLike>(f: Finder<D>, drafts: readonly D[]) => [
  ...f.context.existingNames,
  ...drafts.map((d) => d.name),
];

/**
 * The cards that count: none while the starter card is untouched (the first
 * Add replaces it), else every card. The finder, the names the list shows
 * and Add all read this one set (review round 7: the finder was handed the
 * starter, which hid the line under it without a word, and the list named
 * rows against it while Add did not).
 */
export const cardsThatCount = <D extends DraftLike>(f: Finder<D>): D[] =>
  f.untouched ? [] : f.drafts;

/**
 * The keys added or dismissed while a run is going: the run was started
 * with the cards as they were, so its list would bring them back.
 */
let duringRun: Set<string> | null = null;

/** A card to focus once it is drawn (Add moves focus to its name). */
let focusCard: string | null = null;
/** A refused suggestion's row to focus (its name), once it is redrawn. */
let focusRow: string | null = null;

/**
 * Cards added from a suggestion are "s1", "s2"...: their own series, so
 * they can never take an id the builder's "Add field" gives ("f2", "f3"...),
 * and the builder's counter stays the builder's.
 */
let series = 0;

/**
 * Add the suggestions in `keys`: named NOW, against the cards and the other
 * suggestions, filtered by the builder's own validation, and appended as
 * cards with the builder's defaults. The first Add replaces the starter
 * card only while it is untouched, and only when something is added. What
 * validation refuses stays in the list with its reason, is said, and takes
 * focus.
 */
export function addKeys<D extends DraftLike>(f: Finder<D>, keys: string[]) {
  const keep = cardsThatCount(f);
  const taken = takenBy(f, keep);
  const { added, dropped } = toAdd(
    f.found.list,
    new Set(keys),
    taken,
    (specs) => f.validate(specs, f.context.pageSizes, taken),
  );
  const made = added.map(({ spec }) => {
    const { type, name, page, x, y, width, height } = spec;
    const multiline = spec.type === "text" && spec.multiline === true;
    return {
      ...f.make(`s${++series}`),
      type,
      name,
      page,
      x,
      y,
      width,
      height,
      multiline,
    };
  });
  // The starter card goes only when something takes its place: a refused
  // Add left the builder with no card at all (review round 7).
  if (made.length > 0) f.setDrafts([...keep, ...made]);
  const gone = new Set(added.map((a) => a.key));
  const why = new Map(dropped.map((d) => [d.key, d.reason]));
  for (const k of gone) duringRun?.add(k);
  f.setFound((prev) => ({
    // What was added leaves the list; what was refused STAYS, with its
    // reason, to be fixed and added again (it used to vanish).
    list: prev.list
      .filter((p) => !gone.has(p.key))
      .map((p) =>
        why.has(p.key)
          ? { ...p, refused: why.get(p.key) }
          : keys.includes(p.key)
            ? { ...p, refused: undefined }
            : p,
      ),
    note: dropped.length > 0 ? invalidLine(dropped.length) : null,
  }));
  if (made[0]) {
    f.select(made[0].id);
    focusCard = made[0].id;
  } else if (dropped[0]) {
    f.select(dropped[0].key);
    focusRow = dropped[0].key;
  }
}

/** Drop the suggestions in `keys`. */
export function dismissKeys<D extends DraftLike>(f: Finder<D>, keys: string[]) {
  for (const k of keys) duringRun?.add(k);
  f.setFound((prev) => ({
    ...prev,
    list: prev.list.filter((p) => !keys.includes(p.key)),
  }));
}

/** What a press, Enter or Delete on the preview's suggestion asks for. */
export type ProposalAct = "select" | "add" | "dismiss";

/** The preview's third state: the suggestions on `page`, with their kind. */
export function onPage(list: readonly Pending[], page: number) {
  return list
    .filter((p) => p.page === page)
    .map((p) => ({ ...p, kind: KINDS[p.type] }));
}

/** A suggestion acted on from the preview: a press selects, never adds. */
export function act<D extends DraftLike>(
  f: Finder<D>,
  key: string,
  what: ProposalAct,
) {
  if (what === "add") addKeys(f, [key]);
  else if (what === "dismiss") dismissKeys(f, [key]);
  else f.select(key);
}

/** The run bar's note while suggestions wait: they are not in the form. */
export function RunNote({ f }: { f: Finder }) {
  const n = f.found.list.length;
  return n > 0 ? (
    <span className="text-muted text-xs">
      {n} found field{n === 1 ? " is" : "s are"} not in the form until you add{" "}
      {n === 1 ? "it" : "them"}.
    </span>
  ) : null;
}

/* ------------------------------------------------------------------ *
 *  The panel: progress, summary, review list
 * ------------------------------------------------------------------ */

/** A summary line with its links, each where its words appear. */
function linked(line: SummaryLine) {
  const out: React.ReactNode[] = [];
  let rest = line.text;
  for (const l of line.links ?? []) {
    const i = rest.indexOf(l.words);
    if (i < 0) continue;
    out.push(
      rest.slice(0, i),
      <a
        key={l.href}
        href={l.href}
        className="text-fg font-medium underline underline-offset-2"
      >
        {l.words}
      </a>,
    );
    rest = rest.slice(i + l.words.length);
  }
  out.push(rest);
  return out;
}

type RunState =
  | { status: "running"; done: number; total: number }
  | { status: "done"; report: DetectReport }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

// The builder's own class strings, copied (this chunk imports nothing the
// page loads up front, so no new class reaches the shipped stylesheet).
const SMALL_BUTTON =
  "border-line bg-wash text-fg hover:border-accent/40 hover:bg-accent/10 hover:text-fg rounded-ctl inline-flex items-center justify-center gap-1.5 self-start border px-3.5 py-2 text-xs font-medium transition";
const QUIET_BUTTON =
  "border-line text-muted hover:border-err/40 hover:bg-err/10 hover:text-err rounded-ctl inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition";
const INPUT =
  "border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl w-full border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2";

/**
 * One run of Find fields and its review list. The builder keys it by the
 * press, so each press of Find fields mounts it afresh and runs once.
 */
export function FoundFields<D extends DraftLike>({ f }: { f: Finder<D> }) {
  const [run, setRun] = useState<RunState>({
    status: "running",
    done: 0,
    total: 0,
  });
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const focusNext = useRef<string | null>(null);
  const pending = f.found.list;
  // The builder as it is, for the run's callbacks, without restarting it.
  const latest = useRef(f);
  useEffect(() => {
    latest.current = f;
  });

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    const at = latest.current;
    const touched = new Set<string>();
    duringRun = touched;
    const done = () => {
      if (duringRun === touched) duringRun = null;
    };
    findFields(at.bytes, {
      signal: controller.signal,
      drafts: cardsThatCount(at),
      onPage: (done, total) => {
        if (!controller.signal.aborted)
          setRun({ status: "running", done, total });
      },
    }).then(
      (report) => {
        done();
        if (controller.signal.aborted) return;
        setRun({ status: "done", report });
        // A second run gives the same list; a name typed on a row stays,
        // and what was added or dismissed while it ran stays gone.
        latest.current.setFound((prev) => ({
          note: null,
          list: report.pages.flatMap((p) =>
            p.outcome === "found"
              ? p.proposals
                  .filter((q) => !touched.has(q.key))
                  .map((q) => ({
                    ...q,
                    name: prev.list.find((o) => o.key === q.key)?.name,
                  }))
              : [],
          ),
        }));
      },
      (err: unknown) => {
        done();
        if (controller.signal.aborted) return;
        setRun({
          status: "failed",
          message:
            err instanceof Error && err.message
              ? err.message
              : "The PDF could not be searched.",
        });
      },
    );
    return () => {
      controller.abort();
      done();
    };
  }, []);

  // Add moves focus to the new card's name.
  useEffect(() => {
    const id = focusCard;
    if (!id) return;
    focusCard = null;
    document
      .querySelector<HTMLInputElement>(`[data-field-card="${id}"] input`)
      ?.focus();
  }, [f.drafts]);

  // An Add that added nothing moves focus to the refused row's name.
  useEffect(() => {
    const key = focusRow;
    if (!key) return;
    focusRow = null;
    listRef.current
      ?.querySelector<HTMLInputElement>(`[data-proposal-row="${key}"] input`)
      ?.focus();
  }, [pending]);

  // Focus after a Dismiss: the next suggestion's Add, else the summary.
  useEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    const next = key
      ? listRef.current?.querySelector<HTMLElement>(
          `[data-proposal-row="${key}"] button`,
        )
      : null;
    (next ?? summaryRef.current)?.focus();
  }, [pending]);

  // A suggestion selected on the preview: bring its row into view.
  useEffect(() => {
    const key = f.selected;
    if (!key || !pending.some((p) => p.key === key)) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-proposal-row="${key}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [f.selected, pending]);

  // Named as Add will name them: against the cards that count.
  const names = suggestedNames(pending, takenBy(f, cardsThatCount(f)));
  // The page the preview shows, as the builder picks it: the selected
  // suggestion's, else the selected card's, else the first card's.
  const page =
    pending.find((p) => p.key === f.selected)?.page ??
    (f.drafts.find((d) => d.id === f.selected) ?? f.drafts[0])?.page ??
    1;
  const here = pending.filter((p) => p.page === page);
  const add = (keys: string[]) => addKeys(f, keys);
  const dismiss = (keys: string[]) => {
    const i = pending.findIndex((p) => p.key === keys[0]);
    const rest = pending.filter((p) => !keys.includes(p.key));
    focusNext.current =
      rest[Math.min(Math.max(i, 0), rest.length - 1)]?.key ?? "";
    dismissKeys(f, keys);
  };
  // An emptied name goes back to the suggested one when the field is left.
  const rename = (key: string, name: string | undefined) =>
    f.setFound((prev) => ({
      ...prev,
      list: prev.list.map((p) => (p.key === key ? { ...p, name } : p)),
    }));

  // The builder's RunnerSection markup, copied (see the class strings).
  return (
    <div className="flex flex-col gap-3" data-chunk={CREATE_FORMS_DETECT_CHUNK}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-faint kicker">Review suggestions</h3>
      </div>
      <div
        ref={summaryRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        data-testid="find-fields-summary"
        className="text-muted flex flex-col gap-1 text-xs leading-relaxed outline-none"
      >
        <span>{FIND_FIELDS_SENTENCE}</span>
        <span>{FIND_FIELDS_MISSES}</span>
        {run.status === "running" ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {run.total > 0
              ? `Looking at page ${Math.min(run.done + 1, run.total)} of ${run.total}…`
              : "Looking at the pages…"}
            <button
              type="button"
              className={QUIET_BUTTON}
              onClick={() => {
                abort.current?.abort();
                setRun({ status: "cancelled" });
              }}
            >
              Cancel
            </button>
          </span>
        ) : run.status === "cancelled" ? (
          <span>Stopped. Nothing was added.</span>
        ) : run.status === "failed" ? (
          <span className="text-err">{run.message}</span>
        ) : (
          summarize(run.report).map((line) => (
            <span key={line.text}>{linked(line)}</span>
          ))
        )}
        {f.found.note && <span>{f.found.note}</span>}
      </div>

      {pending.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {here.length > 0 && here.length < pending.length && (
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => add(here.map((p) => p.key))}
              >
                Add all on this page ({here.length})
              </button>
            )}
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() => add(pending.map((p) => p.key))}
            >
              Add all ({pending.length})
            </button>
            <button
              type="button"
              className={QUIET_BUTTON}
              onClick={() => dismiss(pending.map((p) => p.key))}
            >
              Dismiss all
            </button>
          </div>
          <div ref={listRef} role="list" className="flex flex-col gap-3">
            {pending.map((p) => {
              const kind = KINDS[p.type];
              const label = p.label ? `“${p.label}”` : "no label";
              return (
                <div
                  key={p.key}
                  role="listitem"
                  data-proposal-row={p.key}
                  className="border-line bg-wash rounded-panel flex flex-col gap-3 border p-4"
                  style={
                    p.key === f.selected
                      ? { borderColor: "var(--sf-accent)" }
                      : undefined
                  }
                  onFocusCapture={() => f.select(p.key)}
                  onPointerDownCapture={() => f.select(p.key)}
                >
                  <span className="text-fg text-sm">
                    {kind}, {label}, page {p.page}
                  </span>
                  <label className="flex flex-col gap-2">
                    <span className="text-muted text-xs font-medium">
                      Field name
                    </span>
                    <input
                      type="text"
                      className={INPUT}
                      value={names.get(p.key) ?? ""}
                      aria-invalid={p.refused ? true : undefined}
                      aria-describedby={
                        p.refused ? `refused-${p.key}` : undefined
                      }
                      onChange={(e) => rename(p.key, e.target.value)}
                      onBlur={(e) => {
                        if (!e.target.value.trim()) rename(p.key, undefined);
                      }}
                    />
                  </label>
                  {p.refused && (
                    <span id={`refused-${p.key}`} className="text-err text-xs">
                      Not added: {p.refused}
                    </span>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      aria-label={`Add ${kind.toLowerCase()} ${label}, page ${p.page}`}
                      onClick={() => add([p.key])}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className={QUIET_BUTTON}
                      aria-label={`Dismiss ${kind.toLowerCase()} ${label}, page ${p.page}`}
                      onClick={() => dismiss([p.key])}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
