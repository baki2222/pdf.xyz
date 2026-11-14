"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Download, Eraser } from "lucide-react";
import {
  ANNOTATION_GROUPS,
  DEFAULT_GROUPS,
  NO_ANNOTATIONS_MESSAGE,
  annotationCount,
  annotationGroup,
  removeRunLabel,
  removedOutputName,
  type AnnotationGroupId,
} from "@/lib/pdf/annotation-groups";
import type {
  AnnotationInventory,
  PlannedPage,
  RemoveAnnotationsResult,
  planRemoval as PlanRemoval,
} from "@/lib/pdf/remove-annotations";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { RunReason } from "./run-reason";
import { FileHeader } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Remove Annotations' panel, mounted by `remove-annotations-host.tsx` (the
 * `metadata` runner's arm for its slug) and fetched when a file opens, with
 * the engine. Every group name, default and consequence line
 * is read from `ANNOTATION_GROUPS`. The button and the per-page list count
 * the run's own closure (`planRemoval`, which the engine also runs: a
 * reply goes with what it answers, whatever its kind); every number on the
 * result is the engine's count of the SAVED copy (`removeAnnotations`).
 */

const engine = () => import("@/lib/pdf/remove-annotations");

/*
 * The labels below are quoted BY HAND in the page's steps
 * (`content/remove-annotations.ts`), not imported. What holds the two
 * together is `tool-page-substance.test.ts`, which fails when a quoted
 * label is not a string the panel draws (checked 2026-11-10 by renaming
 * two of these: both went red).
 */

/** The result panel's title. */
export const REMOVE_ANNOTATIONS_RESULT_TITLE = "Annotations removed";

/** The heading over the kind checkboxes. */
export const REMOVE_ANNOTATIONS_CHOOSE_TITLE = "Annotations to remove";

/** The heading over the per-page list. */
export const REMOVE_ANNOTATIONS_PAGES_TITLE = "By page";

/** Above this many pages to list, the list starts folded. */
export const PAGE_LIST_FOLD = 12;

/** The download button's label. */
export const REMOVE_ANNOTATIONS_DOWNLOAD_LABEL = "Download PDF";

/** Why the run button is greyed out with nothing ticked. */
export const REMOVE_ANNOTATIONS_NONE_TICKED =
  "Tick at least one kind to remove.";

export function RemoveAnnotationsEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [read, setRead] = useState<{
    inventory: AnnotationInventory;
    plan: typeof PlanRemoval;
  } | null>(null);
  const inventory = read?.inventory ?? null;
  const ids = useId();
  const [readError, setReadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<AnnotationGroupId>>(
    () => new Set(DEFAULT_GROUPS),
  );
  const { busy, error, result, run, reset } =
    useAsyncRun<RemoveAnnotationsResult>();

  useEffect(() => {
    let alive = true;
    engine()
      .then(async ({ inventoryAnnotations, planRemoval }) => ({
        inventory: await inventoryAnnotations(pdf.bytes),
        plan: planRemoval,
      }))
      .then((found) => {
        if (alive) setRead(found);
      })
      .catch((err) => {
        if (alive) setReadError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const present = inventory
    ? ANNOTATION_GROUPS.filter((g) => inventory.groups[g.id] > 0)
    : [];
  const blockedFields = Boolean(
    inventory && (inventory.dynamicXfa || inventory.fieldTreeTooDeep),
  );
  const ticked = present.filter(
    (g) => chosen.has(g.id) && !(g.id === "form-fields" && blockedFields),
  );
  // The run's own closure: the button and the per-page list count what the
  // engine will remove, replies to a ticked kind included.
  const plan = useMemo(
    () =>
      read
        ? read.plan(
            read.inventory,
            new Set(
              ANNOTATION_GROUPS.filter(
                (g) =>
                  chosen.has(g.id) &&
                  !(g.id === "form-fields" && blockedFields),
              ).map((g) => g.id),
            ),
          )
        : null,
    [read, chosen, blockedFields],
  );
  const toRemove = plan?.total ?? 0;
  const tickedCount = ticked.reduce(
    (sum, g) => sum + (inventory?.groups[g.id] ?? 0),
    0,
  );
  const repliesAlong = toRemove - tickedCount;

  const toggle = (id: AnnotationGroupId, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onRun = () => {
    if (toRemove === 0) return;
    const groups = new Set(ticked.map((g) => g.id));
    void run(async () => (await engine()).removeAnnotations(pdf.bytes, groups));
  };

  if (result) {
    const name = removedOutputName(pdf.file.name);
    const rows = ANNOTATION_GROUPS.filter(
      (g) => result.removed[g.id] > 0 || result.kept[g.id] > 0,
    );
    return (
      <ResultPanel
        title={REMOVE_ANNOTATIONS_RESULT_TITLE}
        summary={`${annotationCount(result.removedTotal)} removed · ${result.keptTotal.toLocaleString("en-US")} kept · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <div className="flex flex-col gap-3">
          <table
            data-annotations-result=""
            className="border-line bg-wash rounded-panel max-w-2xl border text-sm"
          >
            <thead>
              <tr className="text-muted text-left text-xs">
                <th scope="col" className="px-4 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Removed
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Kept
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr
                  key={g.id}
                  data-group={g.id}
                  className="border-line border-t"
                >
                  <th
                    scope="row"
                    className="text-fg px-4 py-2 text-left font-normal"
                  >
                    {g.label}
                  </th>
                  <td className="tnum px-4 py-2 text-right">
                    {result.removed[g.id]}
                  </td>
                  <td className="tnum px-4 py-2 text-right">
                    {result.kept[g.id]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.signatureFieldsKept > 0 && (
            <p className="text-muted max-w-2xl text-sm">
              {result.signatureFieldsKept === 1
                ? "1 signature field was kept: no option removes signature fields."
                : `${result.signatureFieldsKept} signature fields were kept: no option removes signature fields.`}
            </p>
          )}
          {result.repliesKept > 0 && (
            <p role="status" className="text-muted max-w-2xl text-sm">
              {result.repliesKept === 1
                ? "1 reply was kept: the annotation it answers is further up a reply chain than this tool follows."
                : `${result.repliesKept} replies were kept: the annotation each answers is further up a reply chain than this tool follows.`}
            </p>
          )}
          {result.stillInFile > 0 && (
            <p role="status" className="text-muted max-w-2xl text-sm">
              {result.stillInFile === 1
                ? "1 annotation was taken off its page but is still in the file, because a kept part of the PDF refers to it. It is counted in neither column."
                : `${result.stillInFile} annotations were taken off their pages but are still in the file, because kept parts of the PDF refer to them. They are counted in neither column.`}
            </p>
          )}
          {result.attachmentsStillEmbedded > 0 && (
            <p role="status" className="text-muted max-w-2xl text-sm">
              {result.attachmentsStillEmbedded === 1
                ? "A file attached through a removed pin is still in the copy: another part of the PDF also holds it, such as its own attachment list, and this tool deletes only what the removed pins alone held."
                : `${result.attachmentsStillEmbedded} files attached through removed pins are still in the copy: other parts of the PDF also hold them, such as its own attachment list, and this tool deletes only what the removed pins alone held.`}
            </p>
          )}
          {result.droppedXfa && (
            <p className="text-muted max-w-2xl text-sm">
              The form&apos;s XFA layer was removed with its fields.
            </p>
          )}
          {result.signed && (
            <p className="text-muted max-w-2xl text-sm">
              The original was digitally signed. The copy is a rewritten file,
              so that signature no longer verifies in it.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, name)}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            {REMOVE_ANNOTATIONS_DOWNLOAD_LABEL}
          </button>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      {readError ? (
        <ErrorNote message={readError} />
      ) : !inventory ? (
        <p className="text-muted inline-flex items-center gap-2 text-sm">
          <Spinner /> Reading annotations…
        </p>
      ) : inventory.total === 0 ? (
        <p role="status" className="text-muted max-w-2xl text-sm">
          {NO_ANNOTATIONS_MESSAGE}
          {inventory.signatureFields > 0 &&
            " Its signature fields are never removed."}
        </p>
      ) : (
        <>
          <RunnerSection title={REMOVE_ANNOTATIONS_CHOOSE_TITLE}>
            <fieldset className="flex max-w-2xl flex-col gap-1">
              <legend className="sr-only">Kinds of annotation to remove</legend>
              {ANNOTATION_GROUPS.map((g) => {
                if (!inventory.groups[g.id]) return null;
                const disabled = g.id === "form-fields" && blockedFields;
                // The checkbox is NAMED by its label and count and DESCRIBED
                // by the consequence: a screen reader moving through the
                // group hears "Links (1)", not the paragraph. The whole row
                // stays the click target.
                const nameId = `${ids}-${g.id}-name`;
                const whyId = `${ids}-${g.id}-why`;
                return (
                  <label
                    key={g.id}
                    data-group={g.id}
                    className="hover:bg-wash rounded-ctl flex min-h-11 cursor-pointer items-start gap-3 px-2 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(g.id) && !disabled}
                      aria-disabled={disabled || undefined}
                      aria-labelledby={nameId}
                      aria-describedby={whyId}
                      onChange={(event) => {
                        if (!disabled) toggle(g.id, event.target.checked);
                      }}
                      className="accent-accent mt-0.5 size-5 shrink-0"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span id={nameId} className="text-fg text-sm">
                        {g.label}{" "}
                        <span className="text-muted tnum">
                          ({inventory.groups[g.id]})
                        </span>
                      </span>
                      <span id={whyId} className="text-muted text-xs">
                        {disabled
                          ? inventory.dynamicXfa
                            ? "This is a dynamic XFA form: its fields exist only in a format browsers can't edit, so they can't be removed here."
                            : "This form's fields are nested too deeply to remove safely."
                          : g.consequence}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {inventory.unplaced > 0 && (
              <p className="text-muted max-w-2xl text-xs">
                {inventory.unplaced === 1
                  ? "1 form field is in the form but on no page; it counts as a form field."
                  : `${inventory.unplaced} form fields are in the form but on no page; they count as form fields.`}
              </p>
            )}
            {inventory.hidden > 0 && (
              <p className="text-muted max-w-2xl text-xs">
                {inventory.hidden === 1
                  ? "1 of these is hidden: readers don't show it, but it is in the file."
                  : `${inventory.hidden} of these are hidden: readers don't show them, but they are in the file.`}
              </p>
            )}
            {inventory.signatureFields > 0 && (
              <p className="text-muted max-w-2xl text-xs">
                {inventory.signatureFields === 1
                  ? "1 signature field is kept whatever you tick."
                  : `${inventory.signatureFields} signature fields are kept whatever you tick.`}
              </p>
            )}
            {repliesAlong > 0 && (
              <p data-replies-along="" className="text-muted max-w-2xl text-xs">
                {repliesAlong === 1
                  ? "1 reply goes too: it answers an annotation you ticked, and a reply goes with what it answers, whatever its kind. The button counts it."
                  : `${repliesAlong} replies go too: each answers an annotation you ticked, and a reply goes with what it answers, whatever its kind. The button counts them.`}
              </p>
            )}
          </RunnerSection>

          <RunnerSection title={REMOVE_ANNOTATIONS_PAGES_TITLE}>
            <PageList
              pages={plan?.pages ?? []}
              annotatedPages={inventory.pages.length}
            />
          </RunnerSection>
        </>
      )}

      <PrivacyLine>
        The PDF is read and saved on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              inventory && inventory.total > 0 && toRemove === 0
                ? REMOVE_ANNOTATIONS_NONE_TICKED
                : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                disabled={!inventory || toRemove === 0}
                busyLabel="Removing…"
                describedBy={describedBy}
              >
                <Eraser className="size-4" aria-hidden />
                {removeRunLabel(toRemove)}
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}

/**
 * The pages something goes from, each with its count by kind — only those:
 * a book with a link on every page and links unticked lists one row, not
 * three hundred "nothing to remove" rows. A long list starts folded.
 */
function PageList({
  pages,
  annotatedPages,
}: {
  pages: readonly PlannedPage[];
  annotatedPages: number;
}) {
  const others = annotatedPages - pages.length;
  const list = (
    <ul
      data-annotations-pages=""
      className="text-muted flex max-w-2xl flex-col gap-1 text-sm"
    >
      {pages.map((p) => (
        <li key={p.page}>
          <span className="text-fg">Page {p.page}:</span>{" "}
          {`${p.total} to remove (${ANNOTATION_GROUPS.filter(
            (g) => (p.groups[g.id] ?? 0) > 0,
          )
            .map((g) => `${annotationGroup(g.id).label} ${p.groups[g.id]}`)
            .join(", ")})`}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-2">
      {pages.length === 0 ? (
        <p className="text-muted max-w-2xl text-sm">
          Nothing to remove on any page with what is ticked.
        </p>
      ) : pages.length > PAGE_LIST_FOLD ? (
        <details>
          <summary className="text-fg flex min-h-11 cursor-pointer items-center text-sm">
            {`${pages.length.toLocaleString("en-US")} pages have annotations to remove`}
          </summary>
          {list}
        </details>
      ) : (
        list
      )}
      {others > 0 && pages.length > 0 && (
        <p data-pages-untouched="" className="text-muted max-w-2xl text-xs">
          {others === 1
            ? "1 other page has annotations, none of a ticked kind."
            : `${others.toLocaleString("en-US")} other pages have annotations, none of a ticked kind.`}
        </p>
      )}
    </div>
  );
}
