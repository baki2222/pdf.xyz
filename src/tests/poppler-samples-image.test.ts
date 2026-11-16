/**
 * #28 slice 3 (wraps): health checks on the committed captures of the worker
 * image's poppler (`./poppler-samples-image`, brief §1.5). Every check here
 * DISCOVERS its subjects from the module, and every relationship it relies on
 * has a bound or a positive control, because a corpus that quietly shrinks —
 * or a drift check that compares nothing — reports the strongest pass.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBboxFlow } from "@/lib/workers/pdf-text/parse";
import { CAPTURE_FIXTURES } from "./poppler-image-fixtures";
import * as image from "./poppler-samples-image";
import * as popplerSamples from "./poppler-samples";
import {
  drawnWords,
  SOFT_HYPHEN,
  wrappedInvoiceItems,
} from "./word-wrap-fixtures";

/** Every `IMAGE_*_BBOX` export, by capture name (`IMAGE_X_BBOX` → `X`). */
const exports = Object.entries(image as Record<string, unknown>)
  .filter(([key]) => /^IMAGE_\w+_BBOX$/.test(key))
  .map(([key, xhtml]) => ({
    key,
    name: key.slice("IMAGE_".length, -"_BBOX".length),
    xhtml: String(xhtml),
  }));
const meta = image.IMAGE_CAPTURES;

/** The word multiset difference: `+w` captured but not drawn, `-w` drawn but not captured. */
function wordDrift(
  captured: readonly string[],
  drawn: readonly string[],
): string[] {
  const count = new Map<string, number>();
  for (const w of captured) count.set(w, (count.get(w) ?? 0) + 1);
  for (const w of drawn) count.set(w, (count.get(w) ?? 0) - 1);
  return [...count]
    .filter(([, n]) => n !== 0)
    .map(([w, n]) => `${n > 0 ? "+" : "-"}${JSON.stringify(w)}×${Math.abs(n)}`);
}

/**
 * FINDINGS, measured on the image's poppler (22.12.0) at capture time and
 * pinned as found — never the fixture reshaped to agree. Each entry is the
 * EXACT drift its capture shows; the check below asserts every synthetic
 * capture's drift equals its entry (or none), so a spec edited after the
 * capture still fails it, and an entry whose drift went away fails too.
 */
const KNOWN_DRIFT: Readonly<Record<string, readonly string[]>> = {
  // U+00AD drawn in Helvetica goes out as WinAnsi 0xAD, whose glyph is
  // `hyphen`; poppler reads it back as U+002D. The standard-font invoice
  // never hands flow a soft hyphen: "car-" / "tridges" is a letter-hyphen.
  WRAPPED_INVOICE: ['+"car-"×1', `-"car${SOFT_HYPHEN}"×1`],
  WRAPPED_INVOICE_STRAY_NUMBER: ['+"car-"×1', `-"car${SOFT_HYPHEN}"×1`],
  WRAPPED_INVOICE_AMOUNT_NOTE: ['+"car-"×1', `-"car${SOFT_HYPHEN}"×1`],
  // In the embedded Noto Sans, pdf-lib's shaper drops the default-ignorable
  // U+00AD before it is drawn: poppler reads "car". No capture in this
  // corpus carries a U+00AD to flow; that join needs a hand-built page.
  WRAPPED_INVOICE_EMBEDDED: ['+"car"×1', `-"car${SOFT_HYPHEN}"×1`],
  // Poppler reads the embedded Bengali subset in VISUAL glyph order (a
  // pre-base vowel sign before its consonant; ো split into ে + া), and one
  // letter comes back as another (ঢ as ট). The word count still matches:
  // 10 drawn words, 10 read, one for one.
  WRAPPED_BENGALI_TABLE: [
    '+"িববরণ"×1',
    '+"চােয়র"×1',
    '+"মািটর"×1',
    '+"ৈতির"×1',
    '+"পািনর"×1',
    '+"েবাতল"×1',
    '+"টাকনা"×1',
    '+"হােত"×1',
    '+"েবানা"×1',
    '+"কাপেড়র"×1',
    '-"বিবরণ"×1',
    '-"চায়ের"×1',
    '-"মাটির"×1',
    '-"তৈরি"×1',
    '-"পানির"×1',
    '-"বোতল"×1',
    '-"ঢাকনা"×1',
    '-"হাতে"×1',
    '-"বোনা"×1',
    '-"কাপড়ের"×1',
  ],
};

const capturedWords = (xhtml: string) =>
  parseBboxFlow(xhtml).pages.flatMap((p) =>
    p.blocks.flatMap((b) => b.lines.flatMap((l) => l.words.map((w) => w.text))),
  );

describe("poppler-samples-image: the worker image's captures", () => {
  it("HEALTH: the corpus is discovered, bounded, and every export is described", () => {
    console.log(
      `image captures (${exports.length}): ${exports.map((e) => e.name).join(", ")}`,
    );
    // S1–S14 and S16 plus the 17 re-captures; under this the CORPUS failed,
    // not the code (an empty or truncated module would pass every check below).
    expect(
      exports.length,
      "the image corpus is implausibly small: the capture or the module writer failed",
    ).toBeGreaterThanOrEqual(25);
    expect(exports.map((e) => e.name).sort()).toEqual(Object.keys(meta).sort());
  });

  it("every export parses to pages that each hold words, as many pages as were captured", () => {
    for (const { name, xhtml } of exports) {
      const pages = parseBboxFlow(xhtml).pages;
      expect(pages.length, name).toBeGreaterThanOrEqual(1);
      expect(pages.length, name).toBe(meta[name]!.pages);
      for (const page of pages)
        expect(
          page.blocks.flatMap((b) => b.lines.flatMap((l) => l.words)).length,
          `${name} page ${page.pageNumber}`,
        ).toBeGreaterThan(0);
    }
  });

  it("S15: every capture of ./poppler-samples (25.07) has its image twin, from the same generator", () => {
    // Derived from that module's docblocks, not typed: a capture added there
    // without a twin here fails, and so does a twin of the wrong generator.
    const source = readFileSync(
      fileURLToPath(new URL("./poppler-samples.ts", import.meta.url)),
      "utf8",
    );
    const named = new Map<string, string>();
    for (const m of source.matchAll(
      /\/\*\*\s*`(\w+)\(\)` through `pdftotext -bbox-layout`[\s\S]*?\*\/\s*export const (\w+)_BBOX\s*=/g,
    ))
      named.set(m[2]!, `${m[1]!}()`);
    const bboxes = Object.keys(popplerSamples).filter((k) =>
      k.endsWith("_BBOX"),
    );
    expect(named.size).toBe(bboxes.length);
    expect(named.size).toBeGreaterThanOrEqual(17);
    for (const [name, generator] of named)
      expect(meta[name]?.source, `IMAGE_${name}_BBOX`).toBe(generator);
  });

  it("DRIFT: each synthetic capture holds exactly the words its generator's spec draws", () => {
    const exempt = exports.filter(
      (e) => meta[e.name]!.kind === "ocr" || meta[e.name]!.kind === "real",
    );
    console.log(
      `exempt from the drift check (ocr: Tesseract reads the page; real: no generator): ${exempt.map((e) => e.name).join(", ")}`,
    );
    // The exempt set is EXACTLY the ocr/real captures, and the registry
    // agrees with the module on every kind: relabelling a synthetic capture
    // in one place cannot excuse it from the comparison.
    for (const { name } of exports) {
      if (meta[name]!.kind === "real") continue;
      expect(CAPTURE_FIXTURES[name]?.kind, name).toBe(meta[name]!.kind);
      expect(CAPTURE_FIXTURES[name]?.words === null, name).toBe(
        meta[name]!.kind === "ocr",
      );
    }
    const compared = exports.filter((e) => !exempt.includes(e));
    expect(compared.length + exempt.length).toBe(exports.length);
    expect(compared.length).toBeGreaterThanOrEqual(25);
    // Every drift at once, so one finding cannot hide the next.
    const drift = Object.fromEntries(
      compared
        .map(({ name, xhtml }) => [
          name,
          wordDrift(capturedWords(xhtml), CAPTURE_FIXTURES[name]!.words!()),
        ])
        .filter(([, d]) => d!.length > 0),
    );
    console.log(`pinned drift: ${Object.keys(drift).join(", ")}`);
    expect(drift).toEqual(KNOWN_DRIFT);
  });

  it("DRIFT positive control: one word of a spec changed fails the comparison", () => {
    // On a capture with no pinned drift, through the same function the
    // check uses: clean first (health), then one word changed.
    const drawn = drawnWords(wrappedInvoiceItems({ everyRow: 3 }));
    const words = capturedWords(image.IMAGE_WRAPPED_INVOICE_EVERY_ROW_BBOX);
    expect(wordDrift(words, drawn)).toEqual([]);
    const changed = drawn.map((w) => (w === "Bamboo" ? "Bambo" : w));
    expect(changed).not.toEqual(drawn);
    expect(wordDrift(words, changed)).toEqual(['+"Bamboo"×1', '-"Bambo"×1']);
  });

  it("one session, one binary: every capture's pdftotext -v is the session's", () => {
    const lines = new Set(Object.values(meta).map((m) => m.poppler));
    console.log(`pdftotext -v: ${JSON.stringify([...lines])}`);
    expect(lines.size).toBe(1);
    expect([...lines][0]).toBe(image.IMAGE_CAPTURE_SESSION.poppler);
    expect(image.IMAGE_CAPTURE_SESSION.poppler).toMatch(/^pdftotext version /);
  });

  // The committed strings against the capture they were written from, when
  // the capture is on this machine (it is not committed: brief §1.4).
  const capture = [
    process.env.PDFXYZ_IMAGE_CAPTURE,
    path.resolve(".claude/captures", image.IMAGE_CAPTURE_SESSION.file),
    path.resolve(
      "../pdf.xyz/.claude/captures",
      image.IMAGE_CAPTURE_SESSION.file,
    ),
  ].find((p): p is string => !!p && existsSync(p));
  it.skipIf(!capture)(
    capture
      ? "every export equals the capture's xhtml, byte for byte"
      : `every export equals the capture's xhtml (SKIPPED: ${image.IMAGE_CAPTURE_SESSION.file} is not on this machine; set PDFXYZ_IMAGE_CAPTURE)`,
    () => {
      const lines = readFileSync(capture!, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { name?: string; xhtml?: string });
      const byName = new Map(
        lines.filter((l) => l.name).map((l) => [l.name!, l.xhtml!]),
      );
      expect(byName.size).toBe(exports.length);
      for (const { name, xhtml } of exports)
        expect(xhtml === byName.get(name), name).toBe(true);
    },
  );
});
