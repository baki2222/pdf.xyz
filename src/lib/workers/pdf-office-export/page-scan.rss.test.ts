// @vitest-environment node
/**
 * The page reader's memory, measured where it can be: the peak resident set
 * of a FRESH process scanning one page (`src/tests/page-scan-rss.ts`).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * pdf.js decodes every image a page uses before the page can be drawn, and
 * holds the pixels until the page is cleaned up, in the worker daemon's own
 * process. The review of 2026-10-11 measured one page with six 8000 × 8000
 * RGB photos (a 20 MB upload; this fixture's are a flat colour, so it is
 * 1 MB) at 4,244 MB of peak RSS, and nothing in the container limits it: one
 * upload could take the daemon down, and every tool with it, three times.
 *
 * ── THE BOUND ───────────────────────────────────────────────────────────────
 *
 * The scan now reads from the FILE what each page will decode
 * (`./page-inventory`) and admits a page's images only up to
 * {@link PAGE_DECODE_BUDGET_BYTES}; the rest are left out before pdf.js sees
 * them, and counted. Measured 2026-10-11 (Node 24, Windows; MB over the
 * process's peak after a warm-up scan): six photos +23, all six counted as
 * too large; ONE photo (admitted, the positive control that the measure sees
 * a decode at all) +394, placed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { encryptPdf } from "@/tests/encrypted-pdf";
import {
  bigPhotosPdf,
  damageContentStreams,
  junkAfterEofPdf,
} from "@/tests/pptx-fidelity-fixtures";
import { PAGE_DECODE_BUDGET_BYTES } from "./page-scan";

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(ROOT, "src", "tests", "page-scan-rss.ts");
const dir = mkdtempSync(path.join(tmpdir(), "pptx-rss-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Measured {
  mode: string;
  warmMb: number;
  peakMb: number;
  ms: number;
  outcome: string;
  tooLarge?: number;
  pictures: number;
}

/** The fixture as uploaded: as built, or locked, or damaged. */
type Variant = (pdf: Uint8Array) => Promise<Uint8Array>;
const asBuilt: Variant = async (pdf) => pdf;
let files = 0;

async function measure(
  count: number,
  variant: Variant = asBuilt,
  mode = "scan",
): Promise<Measured> {
  const file = path.join(dir, `photos-${count}-${files++}.pdf`);
  writeFileSync(file, await variant((await bigPhotosPdf(count)).pdf));
  const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, file, mode], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Measured;
}

/** What the scan may add to a warm process: the page budget plus its own output. */
const BOUND_MB = PAGE_DECODE_BUDGET_BYTES / 1e6 + 150;

describe("one page's decoding is bounded before pdf.js decodes it", () => {
  it("six 8000² photos on one page: left out, counted, and the peak barely moves", async () => {
    const six = await measure(6);
    expect(six.peakMb - six.warmMb, JSON.stringify(six)).toBeLessThan(150);
    expect(six.tooLarge, JSON.stringify(six)).toBe(6);
    expect(six.pictures).toBe(0);
  }, 300_000);

  it("POSITIVE CONTROL: one such photo fits the budget, is placed, and the measure sees its decode", async () => {
    const one = await measure(1);
    expect(one.pictures, JSON.stringify(one)).toBe(1);
    expect(one.tooLarge).toBe(0);
    // The instrument can see a decode: a measure that read the same peak
    // for both would make the bound above vacuous.
    expect(one.peakMb - one.warmMb, JSON.stringify(one)).toBeGreaterThan(200);
    expect(one.peakMb - one.warmMb, JSON.stringify(one)).toBeLessThan(BOUND_MB);
  }, 300_000);

  /*
   * 2026-10-11, the second re-review. The same six photos in files the
   * second repair let past this bound: a page whose content the reader
   * could not read was given a ceiling "never below the floor" and nothing
   * counted against it — and so decoded all six. Measured that day (Node
   * 24, Windows; MB over the warm peak): +2,267 locked with an owner
   * password, in either layout; +2,270 not encrypted at all, with one byte
   * of the content stream's checksum flipped, which pdf.js ignores and the
   * reader's inflate does not. A 1 MB upload could take the daemon down
   * again. Now the locked page is READ (`./standard-security`), so its
   * photos are left out and counted like the unlocked page's; the damaged
   * one is held to the budget over everything it can reach, and counts
   * nothing it cannot see. Each variant carries its own positive control:
   * ONE photo, admitted and placed, so a variant that broke the file could
   * not pass as bounded.
   */
  const VARIANTS: [string, Variant, number][] = [
    [
      "locked with an owner password (RC4-128, classic layout)",
      (pdf) => encryptPdf(pdf, { userPassword: "", ownerPassword: "owner" }),
      6,
    ],
    [
      "locked with an owner password (AES-256, object streams)",
      (pdf) =>
        encryptPdf(pdf, {
          userPassword: "",
          ownerPassword: "owner",
          objectStreams: true,
          cipher: "aes-256",
        }),
      6,
    ],
    ["with a broken checksum on its content stream", damageContentStreams, 0],
  ];
  it.each(VARIANTS)(
    "six 8000² photos on one page %s: bounded all the same",
    async (_, variant, counted) => {
      const one = await measure(1, variant);
      expect(one.pictures, JSON.stringify(one)).toBe(1);
      expect(one.peakMb - one.warmMb, JSON.stringify(one)).toBeGreaterThan(200);
      const six = await measure(6, variant);
      expect(six.peakMb - six.warmMb, JSON.stringify(six)).toBeLessThan(150);
      expect(six.pictures, JSON.stringify(six)).toBe(0);
      expect(six.tooLarge, JSON.stringify(six)).toBe(counted);
    },
    300_000,
  );

  /*
   * 2026-10-11, after the second re-review. A file pdf-lib cannot LOAD — the
   * fixture appends 25 bytes after %%EOF, an object that never ends; pdf.js
   * reads the file as before — gave the scan no inventory, and it then
   * opened pdf.js at the floor ceiling with no bound. The control below is
   * that path, kept as the instrument's proof that it sees the growth.
   * Now such a file is rebuilt first, the way Repair PDF does (`repairPdf`,
   * qpdf in the worker; a stand-in here), and scanned bounded; and with no
   * way to rebuild it, it is REFUSED before pdf.js decodes anything.
   */
  const junk: Variant = async (pdf) => junkAfterEofPdf(pdf);

  it("CONTROL: six 8000² photos behind junk after %%EOF, decoded the old way, take the daemon past two gigabytes", async () => {
    const six = await measure(6, junk, "floor-decode");
    expect(six.outcome, JSON.stringify(six)).toBe("decoded");
    expect(six.peakMb - six.warmMb, JSON.stringify(six)).toBeGreaterThan(1500);
  }, 300_000);

  it("the same file, no way to rebuild it: refused as damaged, and the peak barely moves", async () => {
    const six = await measure(6, junk, "engine");
    expect(six.outcome, JSON.stringify(six)).toBe("unreadable");
    expect(six.peakMb - six.warmMb, JSON.stringify(six)).toBeLessThan(150);
  }, 300_000);

  it("the same file, rebuilt first: converted, its photos counted, and bounded like the intact page", async () => {
    // Positive control: one photo, rebuilt and placed — the measure sees a
    // decode, and the rebuilt file is really scanned.
    const one = await measure(1, junk, "engine-repair");
    expect(one.outcome, JSON.stringify(one)).toBe("repaired");
    expect(one.tooLarge, JSON.stringify(one)).toBe(0);
    expect(one.peakMb - one.warmMb, JSON.stringify(one)).toBeGreaterThan(200);
    const six = await measure(6, junk, "engine-repair");
    expect(six.outcome, JSON.stringify(six)).toBe("repaired");
    expect(six.tooLarge, JSON.stringify(six)).toBe(6);
    expect(six.peakMb - six.warmMb, JSON.stringify(six)).toBeLessThan(150);
  }, 300_000);
});
