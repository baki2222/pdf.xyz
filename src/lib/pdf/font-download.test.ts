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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addHeaderFooter } from "./header-footer";
import { PdfEngineError } from "./engine";
import { FONT_PACKS } from "./font-packs";
import {
  defaultFontByteSource,
  fontDownloadFailedMessage,
  resetFontCache,
  setFontByteSource,
  type FontByteSource,
} from "./unicode-font";
import { errorMessage } from "@/components/tools/runner/runner-kit";

const BENGALI = FONT_PACKS.find((p) => p.scripts.includes("Bengali"))!;

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 320]);
  return doc.save();
}

/** Run the header tool as its runner does, and return what the reader is shown. */
async function shownToReader(header: string): Promise<string | null> {
  try {
    await addHeaderFooter(await blankPdf(), { header: { center: header } });
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(PdfEngineError);
    return errorMessage(error);
  }
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
    network(() => Promise.reject(new TypeError("Failed to fetch")));
    const shown = await shownToReader("গোপনীয় নথি");
    expect(calls.length, "the network was never asked").toBeGreaterThan(0);
    expect(shown).toBe(fontDownloadFailedMessage(`The ${BENGALI.label} font`));
    expect(shown).not.toMatch(/Failed to fetch/);
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
