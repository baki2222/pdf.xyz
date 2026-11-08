"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  Droplets,
  FileImage,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  GRAYSCALE_DPI_PRESETS,
  GRAYSCALE_GREW_NOTE,
  grayscaleOutputName,
  grayscalePdf,
  grayscalePresetById,
  grayscalePresetTradeoff,
  type GrayscaleResult,
} from "@/lib/pdf/grayscale";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  UndecodedImagesNotice,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  FileHeader,
  SignedInputNotice,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import { GRAYSCALE_OPENED_NOTE, GrayscalePassword } from "./grayscale-password";
import { PrivacyLine, SegmentedControl } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Two or more PDFs: the batch (batch plan P2), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const GrayscaleBatch = dynamic(
  () => import("./batch/grayscale-batch").then((m) => m.GrayscaleBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <GrayscaleBatch {...props} />;

/**
 * An encrypted PDF is refused as it opens, and under the refusal the panel
 * takes its password (`./grayscale-password`), checked in the browser: the
 * open password of a file whose author withholds nothing, or the owner
 * password. The decrypted copy then opens here as any other file would.
 * Until 2026-11-08 the refusal was the end of the page (audit
 * grayscale-pdf#6). That is the single-file panel; the batch takes no
 * password and refuses an encrypted file on its row (`./batch/grayscale-batch`).
 */
export function GrayscaleRunner() {
  const [unlocked, setUnlocked] = useState<LoadedPdf | null>(null);
  if (unlocked)
    return (
      <div className="flex flex-col gap-4">
        <p
          role="note"
          data-grayscale-unlocked=""
          className="border-info/40 bg-info/10 text-fg rounded-panel border px-4 py-3 text-sm"
        >
          {GRAYSCALE_OPENED_NOTE}
        </p>
        {unlocked.digitalSignatures > 0 && (
          <SignedInputNotice
            count={unlocked.digitalSignatures}
            toolName="Grayscale PDF"
          />
        )}
        <GrayscaleEditor pdf={unlocked} onReset={() => setUnlocked(null)} />
      </div>
    );
  return (
    <SinglePdfRunner
      hint="One or more PDFs · pages rasterized to grayscale locally in your browser"
      batch={batch}
      handoffSlug="grayscale-pdf"
      toolName="Grayscale PDF"
      errorAside={(error) =>
        error.kind === "encrypted" ? (
          <GrayscalePassword
            key={`${error.file.name}:${error.file.size}:${error.file.lastModified}`}
            file={error.file}
            opensWithoutPassword={error.verdict === "opens-without-password"}
            onOpened={setUnlocked}
          />
        ) : null
      }
    >
      {(pdf, reset) => <GrayscaleEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function GrayscaleEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<GrayscaleResult>();
  const [presetId, setPresetId] = useState("print");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const preset = grayscalePresetById(presetId);
    setProgress({ done: 0, total: pdf.pageCount });
    void run(async () => {
      const converted = await grayscalePdf(pdf.bytes, {
        dpi: preset.dpi,
        sourceName: pdf.file.name,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted)
        throw new Error("Conversion was cancelled.");
      return converted;
    });
  };

  if (result) {
    return (
      <ResultPanel
        title="Grayscale PDF ready"
        summary={`${result.pageCount} page${result.pageCount === 1 ? "" : "s"} rasterized · ${formatBytes(pdf.file.size)} → ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, grayscaleOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        {/* Both sizes, and a reason when the second is bigger: a text PDF
            grows by two orders of magnitude here (grayscale-runner-size.test.tsx). */}
        {result.bytes.byteLength > pdf.file.size && (
          <p className="text-muted text-sm leading-relaxed">
            {GRAYSCALE_GREW_NOTE}
          </p>
        )}
        <UndecodedImagesNotice count={result.undecodedImages} />
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, grayscaleOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download grayscale PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Output quality">
        <SegmentedControl
          label="Rasterization quality"
          value={presetId}
          onChange={setPresetId}
          options={GRAYSCALE_DPI_PRESETS.map((preset) => ({
            value: preset.id,
            label: `${preset.label} (${preset.dpi} DPI)`,
          }))}
        />
        {/* A polite live region that is always drawn, so a screen reader
            hears the cost the moment a sharper preset is picked (a region
            mounted with its text is not announced). */}
        <div aria-live="polite" data-preset-tradeoff="">
          {grayscalePresetTradeoff(presetId) && (
            <p className="text-muted text-xs leading-relaxed">
              {grayscalePresetTradeoff(presetId)}
            </p>
          )}
        </div>
      </RunnerSection>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Droplets}
          title="Grayscale pages"
          body="Each page is rendered and stored as a single-channel grayscale (DeviceGray) image — not colour pixels that merely look grey."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Private"
          body="Rendering happens in your browser using the bundled pdf.js library — no upload."
        />
        <InfoTile
          icon={TriangleAlert}
          title="Raster output"
          body="Text, vectors, forms, and annotations are flattened into page images; selectable text, bookmarks, and links are not kept."
        />
      </div>

      {error && <ErrorNote message={error} />}

      <PrivacyLine>
        Grayscale conversion happens on your device — your PDF never leaves the
        browser.
      </PrivacyLine>

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            busyLabel="Converting pages…"
            progress={progress && { ...progress, unit: "pages" }}
          >
            <FileImage className="size-4" aria-hidden />
            Convert to grayscale
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
