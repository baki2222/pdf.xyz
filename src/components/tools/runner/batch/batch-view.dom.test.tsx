// @vitest-environment jsdom
/**
 * The generic batch view (batch plan P0b), rendered over the real driver with
 * a fake `process`, so each row's outcome is the test's choice: Remove before
 * Run, Retry failed, a skipped row, a noted row, the files a batch did not
 * take, the live region, and the row buttons' phone size.
 *
 * Compress's own batch through this view is proved in
 * `../compress-batch.dom.test.tsx` (unchanged by the lift: the positive
 * control) and below for its file cap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { BatchSkip, withNote } from "@/lib/batch";
import {
  BATCH_LIMITS,
  overCountReason,
  type BatchRejection,
} from "@/lib/batch/limits";
import { CompressBatchRunner } from "../compress-batch";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { BATCH_VIEW_LOADED, BatchView } from "./batch-view";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

type Row = { blob: Blob; name: string };

const file = (name: string) =>
  new File([name], name, { type: "application/pdf" });

function Harness({
  units,
  process,
  rejected = [],
}: {
  units: BatchUnit[];
  process: (f: File) => Promise<Row | ReturnType<typeof withNote<Row>>>;
  rejected?: BatchRejection<File>[];
}) {
  const runner = useBatchRunner<Row>(units, process);
  return (
    <BatchView<Row>
      runner={runner}
      arrivedCount={units.length}
      rejected={rejected}
      banner={<p>banner</p>}
      countLabel={(n) => `${n} PDFs`}
      runLabel={(n) => `Stamp ${n} PDFs`}
      runningLabel="Stamping…"
      errorFallback="Couldn’t stamp"
      progressLabel="Batch progress"
      footnote="Files are processed one at a time, on your device."
      outputs={(r) => [{ name: r.name, blob: r.blob }]}
      describe={() => "stamped"}
      downloadLabel={(item) => `Download stamped ${item.name}`}
      doneSentence={(p) => `Batch complete. ${p.done} stamped.`}
      inputBytes={() => 1}
      zipName="pdfxyz-stamped.zip"
      zipFallback="Download the files one at a time above."
      onReset={() => {}}
    />
  );
}

const renderWith = (ui: React.ReactElement) =>
  render(
    <AppRouterContext.Provider value={router as never}>
      {ui}
    </AppRouterContext.Provider>,
  );

const unitsOf = (...names: string[]): BatchUnit[] =>
  names.map((name) => ({ id: name, name, file: file(name) }));

afterEach(() => vi.restoreAllMocks());

describe("BatchView — the lifted view, generic over the result", () => {
  it("marks its chunk, so the lazy-chunk guard can find it", () => {
    const { container } = renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={async (f) => ({ name: f.name, blob: new Blob([f.name]) })}
      />,
    );
    expect(
      container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
    ).not.toBeNull();
  });

  it("Remove before Run takes a file out, and the Run label counts what is left", async () => {
    const calls: string[] = [];
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf", "c.pdf")}
        process={async (f) => {
          calls.push(f.name);
          return { name: f.name, blob: new Blob([f.name]) };
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove b.pdf" }));
    expect(screen.queryByText("b.pdf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stamp 2 PDFs" }));
    await screen.findByRole("button", { name: "Download all (2)" });
    expect(calls).toEqual(["a.pdf", "c.pdf"]);
    // Once run, nothing can be removed: the rows are the record.
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("the last file cannot be removed: a batch of one is still listed", () => {
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={async (f) => ({ name: f.name, blob: new Blob([f.name]) })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove a.pdf" }));
    expect(screen.queryByRole("button", { name: "Remove b.pdf" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stamp 1 PDFs" })).toBeTruthy();
  });

  it("Retry failed (k) runs only the failed rows, and a skipped and a noted row read as such", async () => {
    const calls: string[] = [];
    let failB = true;
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf", "c.pdf", "d.pdf")}
        process={async (f) => {
          calls.push(f.name);
          if (f.name === "b.pdf" && failB) throw new Error("b broke");
          if (f.name === "c.pdf") throw new BatchSkip("not locked");
          const row = { name: f.name, blob: new Blob([f.name]) };
          return f.name === "d.pdf" ? withNote(row, "repaired by guess") : row;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stamp 4 PDFs" }));
    const retry = await screen.findByRole("button", {
      name: "Retry failed (1)",
    });
    expect(screen.getByText("b broke")).toBeTruthy();
    expect(screen.getByText(/Skipped · not locked/)).toBeTruthy();
    expect(screen.getByText("repaired by guess")).toBeTruthy();
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    expect(screen.getByText(/1 skipped/)).toBeTruthy();

    failB = false;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Retry failed/ })).toBeNull(),
    );
    await screen.findByRole("button", { name: "Download stamped b.pdf" });
    expect(calls).toEqual(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "b.pdf"]);
  });

  it("lists every file the batch did not take, with its reason", () => {
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={async (f) => ({ name: f.name, blob: new Blob([f.name]) })}
        rejected={[{ file: file("z.pdf"), reason: overCountReason(2) }]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("1 file not added to this batch");
    expect(alert.textContent).toContain("z.pdf");
    expect(alert.textContent).toContain(overCountReason(2));
  });

  it("a row button is 44px on a phone and 32px from sm up, and keeps its place while there is none", async () => {
    // b.pdf fails, so its finished row has no button: its place must hold.
    const { container } = renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={async (f) => {
          if (f.name === "b.pdf") throw new Error("b broke");
          return { name: f.name, blob: new Blob([f.name]) };
        }}
      />,
    );
    const remove = screen.getByRole("button", { name: "Remove a.pdf" });
    expect(remove.className).toMatch(/(^| )size-11( |$)/);
    expect(remove.className).toMatch(/(^| )sm:size-8( |$)/);
    fireEvent.click(screen.getByRole("button", { name: "Stamp 2 PDFs" }));
    const download = await screen.findByRole("button", {
      name: "Download stamped a.pdf",
    });
    expect(download.className).toMatch(/(^| )size-11( |$)/);
    expect(download.className).toMatch(/(^| )sm:size-8( |$)/);
    await screen.findByText("b broke");
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    // Every row ends in a 44px box: a button, or its reserved place.
    for (const li of rows) {
      expect(li.lastElementChild!.className).toMatch(/(^| )size-11( |$)/);
    }
  });

  it("the live region says each file as it settles, then the batch's end", async () => {
    // b.pdf waits on the test, so the sentence for a.pdf is on screen alone.
    let releaseB: () => void = () => {};
    const bHeld = new Promise<void>((resolve) => (releaseB = resolve));
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={async (f) => {
          if (f.name === "b.pdf") {
            await bHeld;
            throw new Error("b broke");
          }
          return { name: f.name, blob: new Blob([f.name]) };
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Stamp 2 PDFs" }));
    await waitFor(() =>
      expect(status.textContent).toBe("a.pdf: done. 1 of 2 files processed."),
    );
    releaseB();
    await waitFor(() =>
      expect(status.textContent).toBe("Batch complete. 1 stamped."),
    );
  });
});

describe("CompressBatchRunner — the client file cap (owner ruling 2026-11-08)", () => {
  it("takes the first clientMaxFiles files and lists every one past it, never dropping one silently", () => {
    const max = BATCH_LIMITS.clientMaxFiles;
    const files = Array.from({ length: max + 2 }, (_, i) =>
      file(`scan-${i + 1}.pdf`),
    );
    renderWith(<CompressBatchRunner files={files} onReset={() => {}} />);
    expect(
      screen.getByRole("button", { name: `Compress ${max} PDFs` }),
    ).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("2 files not added to this batch");
    expect(alert.textContent).toContain(`scan-${max + 1}.pdf`);
    expect(alert.textContent).toContain(`scan-${max + 2}.pdf`);
    expect(alert.textContent).toContain(overCountReason(max));
    // Health: the rows listed are exactly the files taken.
    expect(
      screen.getByRole("list", { name: "Files in this batch" }).children,
    ).toHaveLength(max);
  });

  it("control: a batch under the cap lists nothing as refused", () => {
    renderWith(
      <CompressBatchRunner
        files={[file("a.pdf"), file("b.pdf")]}
        onReset={() => {}}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Compress 2 PDFs" }),
    ).toBeTruthy();
  });
});
