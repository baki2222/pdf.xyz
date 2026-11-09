// @vitest-environment jsdom
/**
 * THE WORKSPACE NEVER TELLS A WORKER TOOL'S READER THAT NOTHING IS UPLOADED
 * (batch plan P6).
 *
 * Until P6 no worker tool could launch from the workspace's launch area, so
 * its two client sentences — "right here in your browser" and "nothing is
 * uploaded" — could only ever be drawn for a tool that runs in the browser.
 * P6 lets every worker tool with a batch launch from there, and the
 * cheapest way to do that is to reuse the "ready" status, words and all.
 * This walks EVERY tool the page is given, through the planner the page uses
 * (`batchToolInfoOf`) and the panel the page draws, and reads what the launch
 * area says.
 *
 * Two-way, as CLAUDE.md rule 1 asks, over a corpus the walk DERIVES rather
 * than one typed here:
 *   - the corpus is every sentence the launch area draws for an in-browser
 *     tool that speaks of uploads, the browser, a device or a server;
 *   - every corpus sentence must be caught by a pattern (a new way of saying
 *     "it stays here" fails until a pattern names it), and every pattern
 *     must catch a corpus sentence (a pattern nothing ships is decoration);
 *   - then no pattern may match anything drawn for a worker tool, in any
 *     status, for one file, a few, or more than one batch takes.
 * THE BAN LIST WAS NOT ENOUGH (P6 review, 2026-11-09). It held two
 * patterns, and its corpus was drawn from the client tools only, so a NEW
 * way of saying "it stays here", written into the WORKER copy, met no
 * pattern and joined no corpus: "Your files stay on this device; none of
 * them is uploaded." inserted for Excel to PDF passed every suite. Two
 * changes, each held by a mutation:
 *   - the ban list is widened by shape, and each pattern must catch a
 *     sentence the product ships: the launch area's client copy, or the
 *     shipped source text of `src/` (walked, never named);
 *   - the WORKER copy is held the other way round, by an allowlist: every
 *     sentence drawn for a worker tool that speaks of place must say one of
 *     a few true shapes ("runs on our secure server", "is uploaded only when
 *     you press", "server jobs an hour"), with no negation in it, so any new
 *     phrasing fails until someone reads it and names its shape.
 * The fixture is per tool: each tool gets files of a kind it opens (Word to
 * PDF was walked with PDFs, which it never takes), plus one walk with files
 * of a kind it does not, so the "none of these" copy is read too.
 *
 * The worker set is discovered from the summaries by the panel's own
 * "Secure server" predicate (uploads, and no in-browser runner), held to the
 * catalogue's own count, and split into the tools with a batch and those
 * without, each half health-checked so neither walk is vacuous. A hybrid
 * tool WITH a runner (Compress) is not in it: its launch hands the files to
 * the in-browser runner, which uploads nothing, so its client words are true
 * — and it is the positive control.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import { isToolSupported } from "@/lib/pdf/registry";
import { getAiTools, getToolBySlug, tools } from "@/lib/tools";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import type { WorkspaceFile } from "@/lib/workspace";
import { BatchPanel } from "./batch-panel";
import { buildToolSummaries, type WorkspaceToolSummary } from "./presenter";
import { planWorkspaceBatch } from "./use-workspace";

afterEach(cleanup);

const summaries = buildToolSummaries();
const bySlug = new Map(summaries.map((s) => [s.slug, s]));

/** The shapes of "your files stay here", each one shipped somewhere. */
const STAYS_HERE: readonly RegExp[] = [
  /\bnothing (?:is|was|gets|will be) uploaded\b/i,
  /\bin your browser\b/i,
  /\bstays? (?:on|in) (?:this|your) (?:device|browser|computer)\b/i,
  /\bnever leaves? (?:your|the|this) (?:device|browser|computer)\b/i,
  /\bstill in this browser\b/i,
  /\b(?:not|never) (?:be )?uploaded\b/i,
];

/** Which drawn sentences the corpus takes: any that speaks of where files go. */
const SPEAKS_OF_PLACE =
  /upload|browser|device|computer|server|leave|stay|local/i;

/**
 * The only shapes a worker tool's launch area may use to speak of place:
 * each says the file goes to our server, or when, or what it costs.
 */
const WORKER_PLACE_SHAPES: readonly RegExp[] = [
  /\bruns on (?:our|a) secure server\b/i,
  /\bfor our secure server$/i,
  /\bis uploaded only when you press\b/i,
  /\bserver jobs an hour\b/i,
];

/** A negation turns any shape into its opposite, so none is allowed. */
const NEGATION = /\b(?:not|never|no|none|nothing|without)\b|n[’']t\b/i;

/** Is this worker sentence one of the allowed shapes, un-negated? */
function allowedForWorker(sentence: string): boolean {
  if (!SPEAKS_OF_PLACE.test(sentence)) return true;
  return (
    !NEGATION.test(sentence) &&
    WORKER_PLACE_SHAPES.some((p) => p.test(sentence))
  );
}

const KIND = {
  PDF: { ext: "pdf", mime: "application/pdf" },
  DOCX: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  XLSX: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  PPTX: {
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  EPUB: { ext: "epub", mime: "application/epub+zip" },
  JPG: { ext: "jpg", mime: "image/jpeg" },
  PNG: { ext: "png", mime: "image/png" },
  HTML: { ext: "html", mime: "text/html" },
} as const;
type Kind = keyof typeof KIND;

function acceptOf(tool: WorkspaceToolSummary): string[] {
  return (getToolBySlug(tool.slug)?.accept ?? []).map((a) => a.toUpperCase());
}

/** A kind of file `tool` opens, by its catalogue row; PDF when none is known. */
function ownKind(tool: WorkspaceToolSummary): Kind {
  return (acceptOf(tool).find((a) => a in KIND) as Kind | undefined) ?? "PDF";
}

/** A kind it does not open: an EPUB for a tool that takes PDF, else a PDF. */
function foreignKind(tool: WorkspaceToolSummary): Kind {
  return acceptOf(tool).includes("PDF") ? "EPUB" : "PDF";
}

function filesOf(n: number, kind: Kind = "PDF"): WorkspaceFile[] {
  const { ext, mime } = KIND[kind];
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `f${i}`,
        name: `file-${i + 1}.${ext}`,
        size: 1000,
        mime,
        kind,
        family: "other",
      }) as unknown as WorkspaceFile,
  );
}

/** What the launch area says for `tool` with `n` files queued, and its status. */
function launchArea(
  tool: WorkspaceToolSummary,
  n: number,
  kind: Kind = ownKind(tool),
): { status: string; text: string; parts: string[] } {
  const files = filesOf(n, kind);
  const batch = { toolSlug: tool.slug, fileIds: files.map((f) => f.id) };
  const plan = planWorkspaceBatch(batch, (slug) => bySlug.get(slug), files);
  const { container, unmount } = render(
    <BatchPanel
      files={files}
      summaries={summaries}
      batch={batch}
      plan={plan}
      onSetTool={() => {}}
      onAddAll={() => {}}
      onRemove={() => {}}
      onClear={() => {}}
      onLaunch={() => {}}
      launchingSlug={null}
    />,
  );
  const region = container.querySelector('[role="status"]');
  const text = region?.textContent ?? "";
  // The title and the body are separate sentences; their text runs together.
  const parts = [...(region?.children ?? [])].map((el) => el.textContent ?? "");
  unmount();
  return { status: plan.status, text, parts };
}

/** One file, a few, and more than the largest batch takes. */
function counts(tool: WorkspaceToolSummary): number[] {
  return [1, 3, (tool.batchMaxFiles ?? 20) + 2];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every drawn sentence: the title and the body read apart. */
function drawnSentences(parts: readonly string[]): string[] {
  return parts.flatMap(sentences);
}

/**
 * The text `src/` ships: every non-test source file, walked, minus comment
 * lines. The second corpus each "stays here" pattern must find a sentence
 * in, so no pattern is decoration.
 */
function shippedSourceLines(): { files: number; lines: string[] } {
  const lines: string[] = [];
  let files = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "tests") walk(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(?:test|spec)\.tsx?$/.test(entry.name)
      ) {
        files++;
        for (const line of readFileSync(path, "utf8").split("\n")) {
          const t = line.trim();
          if (t && !/^(?:\/\/|\/?\*)/.test(t)) lines.push(t);
        }
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return { files, lines };
}

const workerTools = summaries.filter((s) => !s.live && s.uploadsFiles);
const clientTools = summaries.filter((s) => s.live);
const batchSlugs = new Set(Object.keys(WORKER_BATCH_TOOLS));

describe("the discovered sets", () => {
  it("every uploading tool in the catalogue, split into batch and no batch", () => {
    const catalogue = tools.filter(
      (t) => modeUploadsFiles(t.processing) && !isToolSupported(t.slug),
    );
    // Health: the walk sees the catalogue's own count, not a shrunken set.
    expect(workerTools.map((t) => t.slug).sort()).toEqual(
      catalogue.map((t) => t.slug).sort(),
    );
    expect(workerTools.length).toBeGreaterThanOrEqual(20);
    const withBatch = workerTools.filter((t) => batchSlugs.has(t.slug));
    const without = workerTools.filter((t) => !batchSlugs.has(t.slug));
    expect(withBatch.length).toBe(batchSlugs.size);
    expect(without.length).toBeGreaterThanOrEqual(5);
    // An AI tool among them, by the catalogue's own list of AI tools.
    const ai = new Set(getAiTools().map((t) => t.slug));
    expect(without.some((t) => ai.has(t.slug))).toBe(true);
    expect(clientTools.length).toBeGreaterThanOrEqual(25);
  });
});

describe("the launch area's 'stays here' words", () => {
  const corpus = clientTools.flatMap((tool) =>
    counts(tool).flatMap((n) =>
      drawnSentences(launchArea(tool, n).parts).filter((s) =>
        SPEAKS_OF_PLACE.test(s),
      ),
    ),
  );
  const unique = [...new Set(corpus)];
  const shipped = shippedSourceLines();

  it("positive control: an in-browser tool says its browser words", () => {
    const compress = bySlug.get("compress-pdf")!;
    const { status, text } = launchArea(compress, 3);
    expect(status).toBe("ready");
    expect(
      STAYS_HERE.filter((p) => p.test(text)).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("every corpus sentence is caught by a pattern", () => {
    // Health: the corpus is the client copy, not an empty set.
    expect(unique.length).toBeGreaterThanOrEqual(4);
    const uncaught = unique.filter((s) => !STAYS_HERE.some((p) => p.test(s)));
    expect(uncaught).toEqual([]);
  });

  it("every pattern catches a sentence the product ships", () => {
    // Health: the walk saw the source tree, not a shrunken set of it.
    expect(shipped.files).toBeGreaterThanOrEqual(800);
    expect(shipped.lines.length).toBeGreaterThanOrEqual(50_000);
    const idle = STAYS_HERE.filter(
      (p) =>
        !unique.some((s) => p.test(s)) && !shipped.lines.some((l) => p.test(l)),
    );
    expect(idle.map(String)).toEqual([]);
  });

  it("no pattern matches anything drawn for a worker tool, in any status", () => {
    const seen = new Set<string>();
    const offending: string[] = [];
    for (const tool of workerTools)
      for (const [n, kind] of [
        ...counts(tool).map((c) => [c, ownKind(tool)] as const),
        [3, foreignKind(tool)] as const,
      ]) {
        const { status, text } = launchArea(tool, n, kind);
        seen.add(status);
        // Health: the status said SOMETHING, so a blank region cannot pass.
        expect(text.length, `${tool.slug} × ${n}`).toBeGreaterThan(20);
        for (const p of STAYS_HERE)
          if (p.test(text)) offending.push(`${tool.slug} × ${n}: ${text}`);
      }
    // Health: every worker status was drawn, so every copy was read.
    expect([...seen].sort()).toEqual([
      "worker-batch",
      "worker-disabled",
      "worker-none",
    ]);
    expect(offending).toEqual([]);
  });
});

describe("a worker tool's launch area speaks of place only in allowed shapes", () => {
  const drawn = workerTools.flatMap((tool) =>
    [
      ...counts(tool).map((c) => [c, ownKind(tool)] as const),
      [3, foreignKind(tool)] as const,
    ].flatMap(([n, kind]) =>
      drawnSentences(launchArea(tool, n, kind).parts).map((sentence) => ({
        where: `${tool.slug} × ${n} ${kind}`,
        sentence,
      })),
    ),
  );
  const place = drawn.filter((d) => SPEAKS_OF_PLACE.test(d.sentence));

  it("every place sentence drawn for a worker tool is an allowed shape", () => {
    // Health: the walk read real worker copy, place sentences among it.
    expect(drawn.length).toBeGreaterThanOrEqual(200);
    expect(place.length).toBeGreaterThanOrEqual(50);
    const outside = place
      .filter((d) => !allowedForWorker(d.sentence))
      .map((d) => `${d.where}: ${d.sentence}`);
    expect(outside).toEqual([]);
  });

  it("every allowed shape is one the worker copy uses", () => {
    const idle = WORKER_PLACE_SHAPES.filter(
      (p) => !place.some((d) => p.test(d.sentence)),
    );
    expect(idle.map(String)).toEqual([]);
  });

  it("controls: a 'stays here' sentence, in any wording, is refused", () => {
    // The review's mutation, and the synonym the ban list never knew.
    for (const sentence of [
      "Your files stay on this device; none of them is uploaded.",
      "Excel to PDF runs on our secure server, but nothing is uploaded.",
      "These files are kept on your computer.",
      "Nothing leaves your browser.",
    ])
      expect(allowedForWorker(sentence), sentence).toBe(false);
    // And a true worker sentence passes, so the check is not refusing all.
    expect(
      allowedForWorker(
        "Repair PDF runs on our secure server, so these files are uploaded.",
      ),
    ).toBe(true);
  });
});
