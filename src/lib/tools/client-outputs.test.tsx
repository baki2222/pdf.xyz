// @vitest-environment jsdom
// @native-canvas
/**
 * What an in-browser tool page PROMISES it writes (`Tool.outputs`, rendered
 * as "Out: …" and baked into the OpenGraph card) against what its runner
 * actually hands the browser, read at the point of consumption: the
 * `(filename, Blob.type)` of every download a finished run offers.
 *
 * `output-honesty.test.ts` holds the same promise from the SOURCE side (an
 * archive call in a runner's imports means "ZIP" must be promised), one way
 * only. This file is the other side, both ways, in a browser:
 *
 *   - a download the catalogue does not name is a format the page hides;
 *   - a catalogue format no download carries is a format the page invents.
 *
 * SUBJECTS ARE DISCOVERED, never typed: every catalogue tool processed in
 * the browser whose registry kind has a driver below — today the "compare"
 * kind (Compare PDF), added with its HTML redline (S4, 2026-11-15). A new
 * tool of a driven kind is enrolled the moment the registry maps it. The
 * other in-browser runners are NOT driven yet: each needs its own inputs and
 * its own way to finish a run, and the harnesses that do that live in their
 * runners' own tests. The plan's target (ten or more tools) is therefore
 * not met by this file; the count of undriven tools is pinned below, so a
 * driver added later moves it on purpose, not silently.
 *
 * Downloads are discovered by `[data-download]` in the result panel (the
 * attribute `runner-kit.tsx` already reads to keep a result once it is
 * downloaded), never by a button's name. They are captured through
 * `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`, so the real
 * `downloadBlob` runs; `@/lib/pdf/browser` is NOT mocked (vitest shares its
 * module cache, memory: "vitest shares a module cache").
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  ComparePdfEditor,
  type CompareItem,
} from "@/components/tools/runner/compare-pdf-runner";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
  normalizeFormatLabel,
} from "@/lib/jobs/mime-by-format";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { extractLegacy, linesPdf, pageHeaderPair } from "@/tests/compare-fixtures";
import { getToolBySlug, tools } from "./index";

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

interface Download {
  name: string;
  type: string;
  size: number;
}

/** The catalogue label a file name's extension stands for, from the table. */
function labelOf(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return null;
  const hit = Object.entries(EXTENSIONS_BY_FORMAT).find(([, exts]) =>
    exts.includes(ext),
  );
  return hit ? normalizeFormatLabel(hit[0]) : null;
}

/** THE PREDICATE: both directions, each side named in its message. */
function outputMismatches(
  slug: string,
  promised: readonly string[],
  downloaded: readonly Download[],
): string[] {
  const made = new Set(downloaded.map((d) => labelOf(d.name) ?? d.name));
  const said = new Set(promised.map(normalizeFormatLabel));
  return [
    ...[...made]
      .filter((f) => !said.has(f))
      .map(
        (f) =>
          `${slug}: the runner downloads ${f}, the catalogue does not say so (outputs: ${[...said].join(", ")})`,
      ),
    ...[...said]
      .filter((f) => !made.has(f))
      .map(
        (f) =>
          `${slug}: the catalogue says ${f}, the runner downloads none (downloads: ${downloaded.map((d) => d.name).join(", ") || "none"})`,
      ),
  ];
}

/** A download's Blob type must be a type of its extension's format. */
function mimeMismatches(slug: string, downloaded: readonly Download[]) {
  return downloaded.flatMap((d) => {
    const label = labelOf(d.name);
    const mimes = label ? MIME_BY_FORMAT[label] : undefined;
    const base = d.type.split(";")[0]!.trim();
    const charset = /^text\//.test(base)
      ? /;\s*charset=utf-8$/i.test(d.type)
      : true;
    return mimes?.includes(base) && charset
      ? []
      : [`${slug}: ${d.name} is handed over as "${d.type}"`];
  });
}

/** Clicks every `[data-download]` in turn and records what it handed over. */
async function downloadsOf(panel: HTMLElement): Promise<Download[]> {
  const buttons = [...panel.querySelectorAll<HTMLElement>("[data-download]")];
  const out: Download[] = [];
  const urls = URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  const original = urls.createObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  urls.revokeObjectURL ??= () => {};
  let blob: Blob | null = null;
  urls.createObjectURL = (b: Blob) => {
    blob = b;
    return "blob:client-outputs";
  };
  try {
    for (const button of buttons) {
      blob = null;
      let name = "";
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        name = this.download;
      };
      fireEvent.click(button);
      await waitFor(() => expect(name).not.toBe(""), { timeout: 5_000 });
      const b = blob as Blob | null;
      out.push({ name, type: b?.type ?? "", size: b?.size ?? 0 });
    }
  } finally {
    urls.createObjectURL = original;
    HTMLAnchorElement.prototype.click = click;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Drivers: render a kind's runner with real PDFs and finish a run.
 * ------------------------------------------------------------------ */

type Driver = (
  slug: string,
  strip?: (panel: HTMLElement) => void,
) => Promise<HTMLElement>;

let nextId = 0;
const DRIVERS: Readonly<Record<string, Driver>> = {
  compare: async (_slug, strip) => {
    const { left, right } = pageHeaderPair();
    const item = async (name: string, pages: string[][]) => {
      const bytes = await linesPdf(pages);
      return {
        id: `co-${nextId++}`,
        name,
        size: bytes.byteLength,
        bytes,
        pageCount: pages.length,
      } satisfies CompareItem;
    };
    render(
      <ComparePdfEditor
        items={[await item("v1.pdf", left), await item("v2.pdf", right)]}
        loading={0}
        rejections={[]}
        onFiles={() => {}}
        onRemove={() => {}}
        onClearRejections={() => {}}
        onClear={() => {}}
        extract={extractLegacy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /compare pdfs/i }));
    const panel = await screen.findByRole(
      "group",
      { name: /differences found/i },
      { timeout: 10_000 },
    );
    strip?.(panel);
    return panel;
  },
};

/** Discovered: in-browser catalogue tools whose registry kind is driven. */
function subjects(): { slug: string; kind: string }[] {
  return supportedToolSlugs
    .map((slug) => ({ slug, kind: getRunnerKind(slug) ?? "" }))
    .filter(
      ({ slug, kind }) =>
        getToolBySlug(slug)?.processing === "client" && kind in DRIVERS,
    );
}

describe("in-browser tools download exactly the formats their page promises", () => {
  it("health: the subjects are discovered, every compare-kind tool among them", () => {
    const found = subjects();
    expect(found.length).toBeGreaterThanOrEqual(1);
    const compareKind = supportedToolSlugs.filter(
      (s) => getRunnerKind(s) === "compare",
    );
    expect(compareKind.length).toBeGreaterThanOrEqual(1);
    expect(found.map((s) => s.slug)).toEqual(
      expect.arrayContaining(compareKind),
    );
    // The undriven in-browser tools, pinned so a new driver moves it on
    // purpose. Not a target: an honest count of what this file cannot see.
    const client = tools.filter((t) => t.processing === "client");
    const undriven = client.length - found.length;
    expect(undriven).toBeGreaterThan(0);
  });

  it("health: the extension table reads both of Compare PDF's formats", () => {
    expect(labelOf("a-vs-b-comparison.html")).toBe("HTML");
    expect(labelOf("a-vs-b-comparison.txt")).toBe("TXT");
    expect(labelOf("a.htm")).toBe("HTML");
  });

  it.each(subjects().map((s) => [s.slug, s.kind]))(
    "%s: the downloads and the catalogue's outputs are the same set, each with its own type",
    async (slug, kind) => {
      const panel = await DRIVERS[kind]!(slug);
      const downloads = await downloadsOf(panel);
      // Health: the buttons are found, and each hands over a real file.
      expect(downloads.length).toBeGreaterThanOrEqual(
        slug === "compare-pdf" ? 2 : 1,
      );
      for (const d of downloads) expect(d.size, d.name).toBeGreaterThan(0);
      const tool = getToolBySlug(slug)!;
      expect(outputMismatches(slug, tool.outputs, downloads)).toEqual([]);
      expect(mimeMismatches(slug, downloads)).toEqual([]);
    },
    30_000,
  );

  it("positive control (i): a catalogue without HTML is caught, in the runner's direction", async () => {
    const panel = await DRIVERS.compare!("compare-pdf");
    const downloads = await downloadsOf(panel);
    const promised = getToolBySlug("compare-pdf")!.outputs.filter(
      (f) => f !== "HTML",
    );
    expect(outputMismatches("compare-pdf", promised, downloads)).toEqual([
      expect.stringContaining(
        "the runner downloads HTML, the catalogue does not say so",
      ),
    ]);
  }, 30_000);

  it("positive control (ii): a runner with its HTML button gone is caught, in the catalogue's direction", async () => {
    const panel = await DRIVERS.compare!("compare-pdf", (p) => {
      const html = [...p.querySelectorAll("[data-download]")].find((b) =>
        /HTML/.test(b.textContent ?? ""),
      );
      expect(html, "the HTML button to strip").toBeTruthy();
      html!.remove();
    });
    const downloads = await downloadsOf(panel);
    expect(
      outputMismatches(
        "compare-pdf",
        getToolBySlug("compare-pdf")!.outputs,
        downloads,
      ),
    ).toEqual([
      expect.stringContaining("the catalogue says HTML, the runner downloads none"),
    ]);
  }, 30_000);

  it("positive control: a wrong Blob type is caught", () => {
    expect(
      mimeMismatches("x", [{ name: "a.html", type: "text/plain", size: 1 }]),
    ).toHaveLength(1);
    expect(
      mimeMismatches("x", [{ name: "a.html", type: "text/html", size: 1 }]),
    ).toHaveLength(1);
    expect(
      mimeMismatches("x", [
        { name: "a.html", type: "text/html;charset=utf-8", size: 1 },
      ]),
    ).toEqual([]);
  });
});
