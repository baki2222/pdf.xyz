/**
 * A connection lost after the page loaded must be refused in words, not with
 * whatever the network threw.
 *
 * WHAT SHIPPED. Header & Footer, Page Numbers, Watermark, Sign, Annotate, Edit
 * and the two text converters fetch a font from our origin the first time a
 * run draws text outside the Western European alphabet. `fetchFromOrigin`
 * handled only a response that came back `!ok`. With no connection `fetch`
 * REJECTS instead — `TypeError: Failed to fetch` — and the runners print any
 * error's message (`errorMessage`, runner-kit.tsx), so a reader who typed a
 * Bengali header and lost their connection before pressing Run was shown
 * "Failed to fetch", beside a FAQ that says this step needs a connection.
 *
 * WHAT THIS HOLDS, through the composed chain a reader actually runs: the
 * engine (`addHeaderFooter`) over the BROWSER's byte source
 * (`defaultFontByteSource`, not the disk source the suite installs), with the
 * network taken away, read back through the runners' own `errorMessage`.
 *
 * Positive control: a response that arrives `!ok` keeps its own message, with
 * its status — the typed wrapper must not flatten a refusal that already says
 * what happened. Health check: the stubbed network was actually asked, so a
 * pass cannot come from a source that never fetched.
 *
 * AND THE OTHER DIRECTION. The first version of the wrapper rewrote EVERY
 * failure that was not already a `PdfEngineError` as "check your connection",
 * on a docblock's argument that a dynamic import's only realistic failure is
 * the network. It is not: `loadCoverage` refuses a table that "claims only N
 * code points" and `loadFontkit` refuses a fontkit that "exposed no create()"
 * — integrity guards for a BROKEN BUILD — and both were then shown to every
 * non-Latin reader as a connection problem, with the diagnostic dropped. The
 * second describe breaks each through the same seams a browser loads by
 * (`setCoverageModuleSource`, `setFontkitModuleSource` — not `vi.mock`, which
 * under this suite's shared module cache would poison every file that draws
 * text), asserts the integrity check itself fired (health check: the `cause`
 * is its message), and reads what the reader is shown. Its positive controls
 * are real load failures through the same two seams, which must still say
 * "connection".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addHeaderFooter } from "./header-footer";
import { PdfEngineError } from "./engine";
import { FONT_PACKS, type FontPackId } from "./font-packs";
import { encodeCoverage, type PackCoverage } from "./coverage-bitmap";
import {
  defaultCoverageModuleSource,
  setCoverageModuleSource,
} from "./font-coverage";
import {
  defaultFontByteSource,
  defaultFontkitModuleSource,
  fontBrokenMessage,
  fontDownloadFailedMessage,
  resetFontCache,
  setFontByteSource,
  setFontkitModuleSource,
  type FontByteSource,
} from "./unicode-font";
import { errorMessage } from "@/components/tools/runner/runner-kit";

const BENGALI = FONT_PACKS.find((p) => p.scripts.includes("Bengali"))!;

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 320]);
  return doc.save();
}

/** Run the header tool as its runner does, and return what it threw. */
async function refusalFor(header: string): Promise<PdfEngineError | null> {
  try {
    await addHeaderFooter(await blankPdf(), { header: { center: header } });
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(PdfEngineError);
    return error as PdfEngineError;
  }
}

/** Run the header tool as its runner does, and return what the reader is shown. */
async function shownToReader(header: string): Promise<string | null> {
  const refusal = await refusalFor(header);
  return refusal && errorMessage(refusal);
}

let previous: FontByteSource;
let calls: string[];

beforeEach(() => {
  // The browser's source, not the suite's disk source: this is the path a
  // reader's run takes.
  previous = setFontByteSource(defaultFontByteSource());
  resetFontCache();
  calls = [];
});

afterEach(() => {
  setFontByteSource(previous);
  setCoverageModuleSource(defaultCoverageModuleSource());
  setFontkitModuleSource(defaultFontkitModuleSource());
  resetFontCache();
  vi.unstubAllGlobals();
});

function network(respond: (url: string) => Promise<unknown>): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  });
}

describe("a dropped connection is refused in words", () => {
  it("offline before the font arrives: the reader is told which font, and why", async () => {
    const offline = new TypeError("Failed to fetch");
    network(() => Promise.reject(offline));
    const refusal = await refusalFor("গোপনীয় নথি");
    const shown = refusal && errorMessage(refusal);
    expect(calls.length, "the network was never asked").toBeGreaterThan(0);
    expect(shown).toBe(fontDownloadFailedMessage(`The ${BENGALI.label} font`));
    expect(shown).not.toMatch(/Failed to fetch/);
    // Worded for the reader, and the original kept for whoever debugs it.
    expect(refusal?.cause).toBe(offline);
  });

  it("the connection drops mid-body: the same refusal, one step later", async () => {
    network(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(new TypeError("network error")),
      }),
    );
    const shown = await shownToReader("গোপনীয় নথি");
    expect(calls.length).toBeGreaterThan(0);
    expect(shown).toBe(fontDownloadFailedMessage(`The ${BENGALI.label} font`));
  });

  it("positive control: a response that arrives !ok keeps its own message and status", async () => {
    network(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    );
    const shown = await shownToReader("গোপনীয় নথি");
    expect(calls.length).toBeGreaterThan(0);
    expect(shown).toContain("(503)");
    expect(shown).not.toBe(
      fontDownloadFailedMessage(`The ${BENGALI.label} font`),
    );
  });

  it("Western text asks the network for nothing, so it cannot fail this way", async () => {
    network(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await shownToReader("CONFIDENTIAL")).toBeNull();
    expect(calls).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  A broken build is ours, not the reader's connection
 * ------------------------------------------------------------------ */

const CONNECTION = /check your connection/i;
const BENGALI_TEXT = "গোপনীয় নথি";

/** Is `shown` the our-fault refusal, for whichever step it names? */
function isOurFault(shown: string | null): boolean {
  // `fontBrokenMessage` leads with the step's name; everything after that is
  // the part a reader acts on.
  const tail = fontBrokenMessage("·").slice(1);
  return !!shown && shown.endsWith(tail);
}

/** One table per shipped face, each claiming a single code point. */
function tinyCoverage(): Record<FontPackId, PackCoverage> {
  return Object.fromEntries(
    FONT_PACKS.map((p) => [p.id, encodeCoverage([0x0995])]),
  ) as Record<FontPackId, PackCoverage>;
}

type FontkitModule = Awaited<
  ReturnType<ReturnType<typeof defaultFontkitModuleSource>>
>;

describe("a broken build is not blamed on the reader's connection", () => {
  beforeEach(() => {
    // Any fetch here would be the face, which is past every step under test.
    network(() => Promise.reject(new TypeError("Failed to fetch")));
  });

  it("the coverage integrity check: our fault, with its diagnostic kept", async () => {
    setCoverageModuleSource(() =>
      Promise.resolve({ FONT_COVERAGE: tinyCoverage() }),
    );
    const refusal = await refusalFor(BENGALI_TEXT);
    // Health check: THIS guard fired, not some other failure on the way.
    expect(String((refusal?.cause as Error | undefined)?.message)).toMatch(
      /^font coverage for \w+ claims only 1 code points$/,
    );
    const shown = refusal && errorMessage(refusal);
    expect(shown).not.toMatch(CONNECTION);
    expect(isOurFault(shown), String(shown)).toBe(true);
    expect(calls, "no face was fetched").toEqual([]);
  });

  it("a TypeError from our own decoding, after the tables ARRIVED, is ours too", async () => {
    // The shape a failed fetch has. Only its position says it is not one.
    setCoverageModuleSource(() =>
      Promise.resolve({
        FONT_COVERAGE: {} as Record<FontPackId, PackCoverage>,
      }),
    );
    const refusal = await refusalFor(BENGALI_TEXT);
    expect(refusal?.cause).toBeInstanceOf(TypeError);
    const shown = refusal && errorMessage(refusal);
    expect(shown).not.toMatch(CONNECTION);
    expect(isOurFault(shown), String(shown)).toBe(true);
  });

  it("the fontkit shape check: our fault, with its diagnostic kept", async () => {
    setFontkitModuleSource(() => Promise.resolve({} as FontkitModule));
    const refusal = await refusalFor(BENGALI_TEXT);
    expect(String((refusal?.cause as Error | undefined)?.message)).toBe(
      "fontkit exposed no create()",
    );
    const shown = refusal && errorMessage(refusal);
    expect(shown).not.toMatch(CONNECTION);
    expect(isOurFault(shown), String(shown)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("fontkit throwing while it EVALUATES is ours, though it is a TypeError", async () => {
    const interop = new TypeError(
      "Cannot read properties of undefined (reading 'prototype')",
    );
    setFontkitModuleSource(() => Promise.reject(interop));
    const refusal = await refusalFor(BENGALI_TEXT);
    expect(refusal?.cause).toBe(interop);
    const shown = refusal && errorMessage(refusal);
    expect(shown).not.toMatch(CONNECTION);
    expect(isOurFault(shown), String(shown)).toBe(true);
  });

  it("positive control: the coverage chunk failing to LOAD is the connection", async () => {
    const lost = new TypeError(
      "Failed to fetch dynamically imported module: /_next/static/chunks/coverage.js",
    );
    setCoverageModuleSource(() => Promise.reject(lost));
    const refusal = await refusalFor(BENGALI_TEXT);
    expect(refusal?.cause).toBe(lost);
    const shown = refusal && errorMessage(refusal);
    expect(shown).toMatch(CONNECTION);
    expect(isOurFault(shown)).toBe(false);
  });

  it("positive control: webpack's ChunkLoadError for fontkit is the connection", async () => {
    const lost = Object.assign(new Error("Loading chunk 812 failed."), {
      name: "ChunkLoadError",
    });
    setFontkitModuleSource(() => Promise.reject(lost));
    const refusal = await refusalFor(BENGALI_TEXT);
    expect(refusal?.cause).toBe(lost);
    expect(refusal && errorMessage(refusal)).toBe(
      fontDownloadFailedMessage("The font engine"),
    );
  });
});
