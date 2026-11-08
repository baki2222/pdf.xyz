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
  ANNOUNCE_EVERY_FILE_UP_TO,
  ANNOUNCE_STRIDE,
} from "@/lib/batch/announce";
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
  onOneLeft,
}: {
  units: BatchUnit[];
  process: (f: File) => Promise<Row | ReturnType<typeof withNote<Row>>>;
  rejected?: BatchRejection<File>[];
  onOneLeft?: (id: string) => void;
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
      {...(onOneLeft ? { onOneLeft } : {})}
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

/**
 * Pressing a row's Remove unmounts the very button that has focus. Left to
 * the browser, focus falls to the document and a keyboard or screen-reader
 * user starts again from the top of the page (review of P0b). jsdom does not
 * turn Enter on a focused button into a click, so the press here is the
 * click a keyboard activation fires, on the focused button; a real Enter is
 * pressed in `e2e/compress-tool.spec.ts`.
 */
describe("BatchView — focus after Remove", () => {
  const press = (name: string) => {
    const button = screen.getByRole("button", { name });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
  };
  const echo = async (f: File) => ({ name: f.name, blob: new Blob([f.name]) });

  it("goes to the next row's Remove, then the previous one at the end, then Run", () => {
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf", "c.pdf", "d.pdf")}
        process={echo}
      />,
    );
    press("Remove b.pdf");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove c.pdf" }),
    );
    press("Remove d.pdf");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove c.pdf" }),
    );
    press("Remove a.pdf");
    // One file left: no Remove button remains, so Run takes focus.
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Stamp 1 PDFs" }),
    );
  });

  it("a tool that hands a last file back is told which one is left", () => {
    const left: string[] = [];
    renderWith(
      <Harness
        units={unitsOf("a.pdf", "b.pdf")}
        process={echo}
        onOneLeft={(id) => left.push(id)}
      />,
    );
    press("Remove a.pdf");
    expect(left).toEqual(["b.pdf"]);
  });
});

describe("BatchView — the live region past ANNOUNCE_EVERY_FILE_UP_TO files", () => {
  it("speaks a failure that falls between strides", async () => {
    const total = ANNOUNCE_EVERY_FILE_UP_TO + 2;
    // The failing settle is NOT a multiple of the stride, so only the
    // failure rule can speak it; the file after it waits on the test.
    const failAt = ANNOUNCE_STRIDE + 2;
    expect(failAt % ANNOUNCE_STRIDE).not.toBe(0);
    expect(failAt).toBeLessThan(total);
    const names = Array.from({ length: total }, (_, i) => `f${i + 1}.pdf`);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    renderWith(
      <Harness
        units={unitsOf(...names)}
        process={async (f) => {
          if (f.name === `f${failAt + 1}.pdf`) await held;
          if (f.name === `f${failAt}.pdf`) throw new Error("broke");
          return { name: f.name, blob: new Blob([f.name]) };
        }}
      />,
    );
    const status = screen.getByRole("status");
    fireEvent.click(
      screen.getByRole("button", { name: `Stamp ${total} PDFs` }),
    );
    await waitFor(() =>
      expect(status.textContent).toBe(
        `f${failAt}.pdf: failed. ${failAt} of ${total} files processed.`,
      ),
    );
    release();
    await waitFor(() => expect(status.textContent).toMatch(/^Batch complete/));
  });

  it("control: a success between strides is not spoken", async () => {
    const total = ANNOUNCE_EVERY_FILE_UP_TO + 2;
    const holdAt = ANNOUNCE_STRIDE + 2;
    const names = Array.from({ length: total }, (_, i) => `f${i + 1}.pdf`);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    renderWith(
      <Harness
        units={unitsOf(...names)}
        process={async (f) => {
          if (f.name === `f${holdAt + 1}.pdf`) await held;
          return { name: f.name, blob: new Blob([f.name]) };
        }}
      />,
    );
    const status = screen.getByRole("status");
    fireEvent.click(
      screen.getByRole("button", { name: `Stamp ${total} PDFs` }),
    );
    await screen.findByText(`${holdAt} of ${total} done`);
    expect(status.textContent).toBe(
      `f${ANNOUNCE_STRIDE}.pdf: done. ${ANNOUNCE_STRIDE} of ${total} files processed.`,
    );
    release();
    await waitFor(() => expect(status.textContent).toMatch(/^Batch complete/));
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
