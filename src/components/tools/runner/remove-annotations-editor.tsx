"use client";

import { useEffect, useState } from "react";
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
  RemoveAnnotationsResult,
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
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Remove Annotations' panel, mounted by the `metadata` runner for its slug
 * (`metadata-runner.tsx`). Every group name, default and consequence line
 * is read from `ANNOTATION_GROUPS`; every number on the result is the
 * engine's count of the SAVED copy (`removeAnnotations`), never this
 * panel's plan. The engine is fetched when a file opens, not with the page.
 */

const engine = () => import("@/lib/pdf/remove-annotations");

/** Fetched WITH the file's parse, so the inventory does not wait a round trip. */
const prepareEngine = async () => {
  await engine();
};

/** The result panel's title — exported so the page's steps quote it. */
export const REMOVE_ANNOTATIONS_RESULT_TITLE = "Annotations removed";

/** The heading over the kind checkboxes. */
export const REMOVE_ANNOTATIONS_CHOOSE_TITLE = "Annotations to remove";

/** The heading over the per-page list. */
export const REMOVE_ANNOTATIONS_PAGES_TITLE = "By page";

/** The download button's label. */
export const REMOVE_ANNOTATIONS_DOWNLOAD_LABEL = "Download PDF";

/** Why the run button is greyed out with nothing ticked. */
export const REMOVE_ANNOTATIONS_NONE_TICKED =
  "Tick at least one kind to remove.";

export function RemoveAnnotationsRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · annotations listed and removed locally in your browser"
      handoffSlug="remove-annotations"
      toolName="Remove Annotations"
      prepare={prepareEngine}
    >
      {(pdf, reset) => <RemoveAnnotationsEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function RemoveAnnotationsEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [inventory, setInventory] = useState<AnnotationInventory | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<AnnotationGroupId>>(
    () => new Set(DEFAULT_GROUPS),
  );
  const { busy, error, result, run, reset } =
    useAsyncRun<RemoveAnnotationsResult>();

  useEffect(() => {
    let alive = true;
    engine()
      .then(({ inventoryAnnotations }) => inventoryAnnotations(pdf.bytes))
      .then((found) => {
        if (alive) setInventory(found);
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
  const toRemove = ticked.reduce(
    (sum, g) => sum + (inventory?.groups[g.id] ?? 0),
    0,
  );

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
                  <td className="px-4 py-2 text-right tabular-nums">
                    {result.removed[g.id]}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
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
                ? "1 reply was kept because the comment it answers could not be traced (a loop, or a very long reply chain)."
                : `${result.repliesKept} replies were kept because the comment each answers could not be traced (a loop, or a very long reply chain).`}
            </p>
          )}
          {result.attachmentsStillEmbedded > 0 && (
            <p role="status" className="text-muted max-w-2xl text-sm">
              {result.attachmentsStillEmbedded === 1
                ? "1 attached file is still in the copy: the PDF also lists it as an attachment of its own, which this tool does not remove."
                : `${result.attachmentsStillEmbedded} attached files are still in the copy: the PDF also lists them as attachments of its own, which this tool does not remove.`}
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
                      onChange={(event) => {
                        if (!disabled) toggle(g.id, event.target.checked);
                      }}
                      className="accent-accent mt-0.5 size-5 shrink-0"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-fg text-sm">
                        {g.label}{" "}
                        <span className="text-muted tabular-nums">
                          ({inventory.groups[g.id]})
                        </span>
                      </span>
                      <span className="text-muted text-xs">
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
          </RunnerSection>

          <RunnerSection title={REMOVE_ANNOTATIONS_PAGES_TITLE}>
            <ul
              data-annotations-pages=""
              className="text-muted flex max-w-2xl flex-col gap-1 text-sm"
            >
              {inventory.pages.map((p) => {
                const parts = ticked
                  .filter((g) => (p.groups[g.id] ?? 0) > 0)
                  .map(
                    (g) => `${annotationGroup(g.id).label} ${p.groups[g.id]}`,
                  );
                const n = ticked.reduce(
                  (sum, g) => sum + (p.groups[g.id] ?? 0),
                  0,
                );
                return (
                  <li key={p.page}>
                    <span className="text-fg">Page {p.page}:</span>{" "}
                    {n === 0
                      ? "nothing to remove"
                      : `${n} to remove (${parts.join(", ")})`}
                  </li>
                );
              })}
            </ul>
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
