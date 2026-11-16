// @vitest-environment node
/**
 * Chat with PDF's page retrieval (audit #30, slice 3), read where a reader
 * and a browser receive it: the prerendered HTML and the client chunks of
 * the build (house rule 5, the point of consumption).
 *
 * Three properties, each with its positive control:
 *
 * 1. The served chat page and its guide make no overclaim
 *    (`CHAT_RETRIEVAL_OVERCLAIMS`), and DO carry the static page-selection
 *    claim and the notice wording, so a scan of a stale or empty page
 *    cannot pass. INVERTED 2026-11-16 (slice 4): slice 3 banned every
 *    page-choice shape here, until production's worker was observed
 *    choosing pages by the question; the selection claim is now REQUIRED.
 * 2. The panel's gated line is not server-rendered: SSR has no observed
 *    status, so the line appearing in the HTML would mean it renders without
 *    one. The same text IS in a client chunk, so the search can see it.
 * 3. `page-retrieval.ts` stays out of `.next/static`. Its marker is the Latin
 *    word of `SEGMENTER_HEALTH_SAMPLE`, read from the source (a string
 *    literal survives minification; the Bengali half may be escaped). The
 *    same search must FIND it under `.next/server`, where the worker-side
 *    engine graph builds it, or the zero means nothing.
 *
 * Runs under `pnpm test:bundle` (it needs `.next`), never `pnpm test`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "@/lib/guides";
import { CHAT_TOOL_SLUG } from "@/lib/jobs/chat-with-pdf";
import {
  CHAT_RETRIEVAL_ANCHOR_SHARE,
  chatRetrievalPanelLine,
} from "@/lib/pdf/chat-retrieval-anchor";
import {
  CHAT_SELECTION_REQUIRED,
  chatRetrievalOverclaimsIn,
} from "@/lib/tools/chat-retrieval-claims";

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const APP = path.join(NEXT_DIR, "server", "app");

function files(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? files(full, ext)
      : full.endsWith(ext)
        ? [full]
        : [];
  });
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** The visible text of a prerendered page, entities decoded. */
function pageText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;|\s+/g, " ");
}

/** The pages a reader of chat's static copy lands on, derived. */
const SERVED = [
  path.join(APP, "tools", `${CHAT_TOOL_SLUG}.html`),
  ...guides
    .filter((g) => g.tools[0] === CHAT_TOOL_SLUG)
    .map((g) => path.join(APP, "guides", `${g.slug}.html`)),
];

/** The segmenter sample's Latin word, read from the source that defines it. */
function retrievalMarker(): string {
  const source = readFileSync(
    path.join(ROOT, "src", "lib", "pdf", "page-retrieval.ts"),
    "utf8",
  );
  const match = /const SEGMENTER_HEALTH_SAMPLE = "([a-z]+) /.exec(source);
  if (!match) throw new Error("SEGMENTER_HEALTH_SAMPLE not found in source");
  return match[1]!;
}

describe("chat page retrieval, as the build serves it", () => {
  const built = existsSync(path.join(NEXT_DIR, "static", "chunks"));

  it("has a build to measure", () => {
    // Skipping when `.next` is absent would read green in exactly the case
    // where nothing was checked.
    expect(built, "no .next — run `pnpm build` first (CI does)").toBe(true);
  });

  it("the served chat page and guide overclaim nothing, and say how a longer file's pages are chosen", () => {
    if (!built) return;
    expect(SERVED.length, "the chat guide was not derived").toBeGreaterThan(1);
    for (const file of SERVED) {
      expect(existsSync(file), `${rel(file)} was not prerendered`).toBe(true);
      const text = pageText(readFileSync(file, "utf8"));
      expect(text.length, `${rel(file)} is implausibly small`).toBeGreaterThan(
        5_000,
      );
      const sentences = text.split(/(?<=[.!?])\s+/);
      const caught = sentences.flatMap((s) =>
        chatRetrievalOverclaimsIn(s).map((n) => `[${n}] ${s}`),
      );
      expect(caught, rel(file)).toEqual([]);
      // Positive controls: the current static copy is what the page serves,
      // so the scan above read it, not a stale or empty page. Slice 4's
      // REQUIRED row, read where the reader receives it.
      expect(text, rel(file)).toContain("naming the pages when it can");
      expect(
        sentences.some((s) => CHAT_SELECTION_REQUIRED.pattern.test(s)),
        `${rel(file)} does not say how a longer file's pages are chosen`,
      ).toBe(true);
    }
  });

  it("the gated panel line is never server-rendered, and is in a client chunk", () => {
    if (!built) return;
    const line = chatRetrievalPanelLine(CHAT_RETRIEVAL_ANCHOR_SHARE);
    const ssr = [...files(APP, ".html"), ...files(APP, ".rsc")].filter((f) =>
      readFileSync(f, "utf8").includes(line),
    );
    expect(ssr.map(rel)).toEqual([]);
    const client = files(path.join(NEXT_DIR, "static"), ".js").filter((f) =>
      readFileSync(f, "utf8").includes(line),
    );
    expect(client.length, "the line is in no client chunk").toBeGreaterThan(0);
  });

  it("page-retrieval is absent from .next/static and present in .next/server", () => {
    if (!built) return;
    const marker = retrievalMarker();
    const hits = (dir: string) =>
      files(dir, ".js")
        .filter((f) => readFileSync(f, "utf8").includes(marker))
        .map(rel);
    expect(hits(path.join(NEXT_DIR, "static"))).toEqual([]);
    expect(
      hits(path.join(NEXT_DIR, "server")).length,
      `the marker "${marker}" is in no server file: the search sees nothing`,
    ).toBeGreaterThan(0);
  });
});
