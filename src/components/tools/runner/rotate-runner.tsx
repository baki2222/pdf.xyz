"use client";

import dynamic from "next/dynamic";
import { RunReason } from "@/components/tools/runner/run-reason";
import { useMemo, useRef, useState } from "react";
import {
  Download,
  FlipHorizontal2,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { normalizeAngle, setPageRotations } from "@/lib/pdf/engine";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import type { Rotation } from "@/lib/pdf/types";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  PreviewStatus,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  allIndices,
  evenPages,
  invertSelection,
  oddPages,
  selectRange,
  toggleIndex,
} from "./selection";
import { PageTile, TileAction } from "./page-tile";
import {
  FileHeader,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import type { LoadedPdf } from "./use-single-pdf";
import {
  RestrictedGrantNote,
  RestrictedGrantRefusal,
  grantAllows,
} from "./restricted-grant";

/**
 * A PDF its author restricted opens here when the author grants page
 * assembly (/P bit 11, which names rotation): the rotation is saved under
 * the author's own encryption. Withheld, the tool says which permission and
 * that the owner password lifts it (`./restricted-grant`). Refused at
 * upload, with the editing-restrictions message, until 2026-11-08.
 */
/**
 * Two or more PDFs: the batch (batch plan P1), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const RotateBatch = dynamic(
  () => import("./batch/rotate-batch").then((m) => m.RotateBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <RotateBatch {...props} />;

export function RotateRunner() {
  return (
    <SinglePdfRunner
      hint="One or more PDFs · rotate any or all pages"
      batch={batch}
      handoffSlug="rotate-pdf"
      toolName="Rotate PDF"
      openProtected
    >
      {(pdf, reset) =>
        pdf.protection && !grantAllows(pdf.protection, "assemble") ? (
          <RestrictedGrantRefusal pdf={pdf} grant="assemble" onReset={reset} />
        ) : (
          <RotateEditor pdf={pdf} onReset={reset} />
        )
      }
    </SinglePdfRunner>
  );
}

function RotateEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [rotations, setRotations] = useState<Rotation[]>(pdf.rotations);
  const [selected, setSelected] = useState<Set<number>>(() =>
    allIndices(pdf.pageCount),
  );
  const anchorRef = useRef<number | null>(null);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
  const { thumbs, rendered, status, capped, eagerCount, requestPage } =
    usePdfThumbnails(pdf.bytes, pdf.pageCount);

  const changedCount = useMemo(
    () =>
      rotations.reduce<number>(
        (n, rot, i) => (rot !== pdf.rotations[i] ? n + 1 : n),
        0,
      ),
    [rotations, pdf],
  );

  const onSelectPage = (index: number, shiftKey: boolean) => {
    setSelected((prev) =>
      shiftKey && anchorRef.current !== null
        ? selectRange(prev, anchorRef.current, index, pdf.pageCount)
        : toggleIndex(prev, index),
    );
    anchorRef.current = index;
  };

  const rotateBy = (delta: number, only?: number | "all") => {
    const targets =
      only === "all"
        ? allIndices(pdf.pageCount)
        : only !== undefined
          ? new Set([only])
          : selected.size > 0
            ? selected
            : allIndices(pdf.pageCount);
    setRotations((prev) =>
      prev.map((rot, i) =>
        targets.has(i) ? normalizeAngle(rot + delta) : rot,
      ),
    );
  };

  // In place, never a rebuild: see `setPageRotations` for what a rebuild
  // deleted from every file this tool touched. A restricted file's bytes are
  // its decrypted copy; the rotation goes back onto the ORIGINAL as an
  // incremental update under the author's encryption, which refuses any
  // change to a page beyond its /Rotate.
  const protection = pdf.protection;
  const onRun = () =>
    run(async () => {
      const rotated = await setPageRotations(pdf.bytes, rotations);
      return protection
        ? (await protection.saveChanges(rotated)).bytes
        : rotated;
    });

  if (result) {
    return (
      <ResultPanel
        title="PDF rotated"
        summary={`${changedCount} page${changedCount === 1 ? "" : "s"} rotated${protection ? " · author's protection kept" : ""} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, outputName(pdf.file.name, "rotated"))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, outputName(pdf.file.name, "rotated"))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download rotated PDF
        </button>
      </ResultPanel>
    );
  }

  const scope = selected.size > 0 ? `${selected.size} selected` : "all pages";

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />
      {protection && <RestrictedGrantNote grant="assemble" />}

      <RunnerSection
        title="Rotate"
        aside={<span className="text-muted text-xs">Applies to {scope}</span>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton onClick={() => rotateBy(-90)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Left
          </ChipButton>
          <ChipButton onClick={() => rotateBy(90)}>
            <RotateCw className="size-3.5" aria-hidden />
            Right
          </ChipButton>
          <ChipButton onClick={() => rotateBy(180)}>
            <FlipHorizontal2 className="size-3.5" aria-hidden />
            180°
          </ChipButton>
          <ChipButton
            onClick={() => rotateBy(180, "all")}
            title="Turn every page upside down, whatever is selected"
          >
            <FlipHorizontal2 className="size-3.5" aria-hidden />
            Rotate all 180°
          </ChipButton>
          <span className="bg-wash mx-1 h-4 w-px" aria-hidden />
          <ChipButton onClick={() => setSelected(allIndices(pdf.pageCount))}>
            Select all
          </ChipButton>
          <ChipButton onClick={() => setSelected(oddPages(pdf.pageCount))}>
            Odd pages
          </ChipButton>
          <ChipButton
            onClick={() => setSelected(evenPages(pdf.pageCount))}
            disabled={pdf.pageCount < 2}
          >
            Even pages
          </ChipButton>
          <ChipButton
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            Clear
          </ChipButton>
          <ChipButton
            onClick={() =>
              setSelected((prev) => invertSelection(prev, pdf.pageCount))
            }
          >
            Invert
          </ChipButton>
          <ChipButton
            onClick={() => setRotations(pdf.rotations)}
            disabled={changedCount === 0}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Reset
          </ChipButton>
        </div>
      </RunnerSection>

      <PreviewStatus
        rendered={rendered}
        total={pdf.pageCount}
        status={status}
        capped={capped}
        eager={eagerCount}
      />

      <div
        role="group"
        aria-label="Pages — select the ones to rotate. Shift-click to select a range."
        className="border-line bg-wash rounded-panel grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto border p-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
      >
        {rotations.map((rotation, i) => (
          <PageTile
            key={i}
            label={`Page ${i + 1}`}
            ariaLabel={`Page ${i + 1}`}
            rotation={rotation}
            thumbnail={thumbs[i]}
            loading={status === "rendering"}
            onEnterView={capped ? () => requestPage(i) : undefined}
            selectable
            selected={selected.has(i)}
            onSelect={(shiftKey) => onSelectPage(i, shiftKey)}
            actions={
              <>
                <TileAction
                  title={`Rotate page ${i + 1} left`}
                  onClick={() => rotateBy(-90, i)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Rotate page ${i + 1} right`}
                  onClick={() => rotateBy(90, i)}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                </TileAction>
              </>
            }
          />
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunReason
            reason={
              changedCount === 0 ? "Rotate at least one page first." : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onRun}
                busy={busy}
                describedBy={describedBy}
                disabled={changedCount === 0}
                busyLabel="Rotating…"
              >
                <RotateCw className="size-4" aria-hidden />
                Apply rotation
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}
