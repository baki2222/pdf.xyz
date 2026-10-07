// @vitest-environment node
/**
 * Text to PDF's page, held to the decoder and the font routing the runner
 * actually uses.
 *
 * Two changes made four of this page's sentences false, and on 2026-10-07 it
 * still served all of them (verifier, 028d3a10):
 *
 *   - the runner stopped reading files with `file.text()` and started reading
 *     them through `decodeTextFile` (byte-order mark, UTF-16 NUL sniff, strict
 *     UTF-8, Windows-1252), while the page said "Files are always decoded as
 *     UTF-8" and that an ANSI or UTF-16 file comes out garbled;
 *   - the body font started asking for "mono", which puts the Geist Mono pack
 *     first, while the page said Polish or Cyrillic "switches the body text to
 *     a Noto typeface" that "is not fixed-width", that the only file it may
 *     fetch is a Noto face, and counted Geist Mono among "6 bundled Noto
 *     faces".
 *
 * So this reads everything the page SERVES. The shipped sentences are the
 * corpus of a ban list, in both directions (house rule 1), and each ban is
 * licensed by running the code the claim is about — the decoder on real
 * Windows-1252 and UTF-16 bytes, `textToPdf` on Polish and Russian text with
 * the shipped font files — so the day the code makes a claim true again, the
 * licence goes red first, not the ban.
 *
 * WHAT THIS DOES NOT SEE: a synonym of the shipped shapes ("only UTF-8 is
 * understood"), and a claim about a script other than the ones named.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { toolFacts } from "./tool-facts";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { textToPdf } from "@/lib/pdf/text-to-pdf";
import { FONT_PACKS, fontPack, type FontPack } from "@/lib/pdf/font-packs";
import { readNotoTtf } from "@/lib/pdf/noto-source";
import { resetFontCache, setFontByteSource } from "@/lib/pdf/unicode-font";
import { decodeTextBytes, describeDecoding } from "@/lib/text/decode-text-file";
import { embeddedFaces } from "@/tests/unicode-fonts";

/** Discovered from the registry, so a second slug on this runner is held too. */
const SLUGS = supportedToolSlugs.filter(
  (s) => getRunnerKind(s) === "text-to-pdf",
);

/** Everything the tool page renders, as the page renders it. */
function served(slug: string): string[] {
  const tool = getToolBySlug(slug)!;
  return [
    tool.tagline,
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...toolFacts(slug).map((f) => f.value),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const sentences = (texts: readonly string[]) =>
  texts.flatMap((t) => t.split(/(?<=[.!?])\s+/));

/** The Noto faces a "bundled Noto faces (…)" list may name: by FILE, not label. */
const NOTO_LABELS = new Set(
  FONT_PACKS.filter((pack) => /^Noto/.test(pack.file)).map((p) => p.label),
);

/**
 * A sentence counting "N bundled Noto faces (a; b; …)" whose count or members
 * are not the shipped Noto files. Returns the reason, or null.
 */
function wrongNotoList(sentence: string): string | null {
  const m = /\b(\d+) bundled Noto faces \(([^)]*)\)/.exec(sentence);
  if (!m) return null;
  const listed = m[2]!.split(/;\s*/);
  const notNoto = listed.filter((label) => !NOTO_LABELS.has(label));
  if (notNoto.length > 0) return `not Noto: ${notNoto.join(", ")}`;
  if (Number(m[1]) !== listed.length)
    return `counts ${m[1]} but lists ${listed.length}`;
  if (listed.length !== NOTO_LABELS.size)
    return `lists ${listed.length} of ${NOTO_LABELS.size}`;
  return null;
}

const BANS: { name: string; pattern: RegExp; shipped: string[] }[] = [
  {
    name: "a file is read as UTF-8 only",
    pattern:
      /\b(?:always (?:decoded|read) as UTF-8|no encoding detection)\b|\bUTF-16 text comes out garbled\b/i,
    shipped: [
      "Files are always decoded as UTF-8.",
      "Files are read as UTF-8 with no encoding detection, so an older ANSI (Windows-1252) or Latin-1 text converts without any warning but shows replacement marks (\u{fffd}) where its accented letters were, and UTF-16 text comes out garbled the same way.",
    ],
  },
  {
    name: "Polish or Cyrillic moves the body to a Noto face",
    pattern:
      /\b(?:Polish|Cyrillic|Russian)\b[^.]*\b(?:switch|move)\w*\b[^.]*\bNoto\b/i,
    shipped: [
      "A character beyond that set, from Polish letters to Cyrillic, and even one in the file name, switches the body text to a Noto typeface fetched from pdf.xyz's own server and embedded with only the characters you used.",
    ],
  },
  {
    // A fetch the page describes as a Noto file and nothing else. Geist Mono
    // is fetched for Polish and Cyrillic, so a sentence about what is fetched
    // that never names it says only Noto is.
    name: "the only font fetched is a Noto face",
    pattern:
      /^(?=.*\b(?:fetch\w*|request\w*|download\w*)\b)(?=.*\bNoto\b)(?!.*\bGeist Mono\b)/i,
    shipped: [
      "A character beyond that set, from Polish letters to Cyrillic, and even one in the file name, switches the body text to a Noto typeface fetched from pdf.xyz's own server and embedded with only the characters you used.",
      'Its label switches to "Creating PDF…" until the document is ready; when the text or file name needs a Noto face, that font file is fetched first, and it is reused for later conversions until you reload or close the tab.',
      "Apart from the page's own code, the only thing it may request from pdf.xyz is a Noto font file, when your text needs a script beyond Western European.",
    ],
  },
];

/** The shipped use case, rebuilt from the pack table as it rendered then. */
const SHIPPED_NOTO_LIST = `The characters are drawn from one of ${FONT_PACKS.length} bundled Noto faces (${FONT_PACKS.map((p) => p.label).join("; ")}), picked to match the script, and the conversion halts with an explanation naming any character none of them can draw.`;

/** Run `textToPdf` against the shipped TTFs, recording every face fetched. */
async function recording(
  text: string,
  title: string,
): Promise<{ bytes: Uint8Array; requested: FontPack[] }> {
  const requested: FontPack[] = [];
  const previous = setFontByteSource(async (pack) => {
    requested.push(pack);
    return readNotoTtf(pack);
  });
  resetFontCache();
  try {
    return { bytes: await textToPdf(text, { title }), requested };
  } finally {
    setFontByteSource(previous);
    resetFontCache();
  }
}

describe("Text to PDF's page matches its decoder and its fonts", () => {
  beforeEach(() => resetFontCache());
  afterEach(() => resetFontCache());

  it("health check: the slug is discovered and the page serves substance", () => {
    expect(SLUGS).toEqual(["text-to-pdf"]);
    const all = sentences(served(SLUGS[0]!));
    expect(all.length).toBeGreaterThan(30);
    // The Noto set is read off the files; the monospace pack is not in it.
    expect(NOTO_LABELS.size).toBeGreaterThan(3);
    expect(NOTO_LABELS.has(fontPack("mono").label)).toBe(false);
  });

  it("every ban catches every sentence that shipped, and the list check catches the shipped count", () => {
    for (const ban of BANS) {
      expect(ban.shipped.length, ban.name).toBeGreaterThan(0);
      for (const sentence of ban.shipped)
        expect(ban.pattern.test(sentence), `${ban.name}: ${sentence}`).toBe(
          true,
        );
    }
    expect(wrongNotoList(SHIPPED_NOTO_LIST)).toMatch(/not Noto: monospace/);
  });

  it("no served sentence makes a banned claim, and every Noto list is the Noto files", () => {
    for (const slug of SLUGS) {
      const all = sentences(served(slug));
      for (const ban of BANS)
        expect(
          all.filter((s) => ban.pattern.test(s)),
          `${slug}: ${ban.name}`,
        ).toEqual([]);
      const lists = all.filter((s) => /bundled Noto faces \(/.test(s));
      expect(lists.length, "the page no longer lists its Noto faces").toBe(1);
      expect(lists.map(wrongNotoList)).toEqual([null]);
    }
  });

  it("licence: a Windows-1252 file and a UTF-16 file are read correctly, and an assumed encoding is named", () => {
    // "café “quoted”" in Windows-1252 bytes: not valid UTF-8.
    const ansi = decodeTextBytes(
      new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94]),
    );
    expect(ansi.text).toBe("café “q”");
    expect(ansi.encoding).toBe("windows-1252");
    expect(describeDecoding(ansi)).toMatch(/Windows-1252/);
    const bom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Grüße", "utf16le"),
    ]);
    expect(decodeTextBytes(new Uint8Array(bom)).text).toBe("Grüße");
    const unmarked = decodeTextBytes(
      new Uint8Array(Buffer.from("Hello, world é", "utf16le")),
    );
    expect(unmarked.text).toBe("Hello, world é");
    expect(describeDecoding(unmarked)).toMatch(/UTF-16/);
  });

  it("licence: Polish and Russian text is set in Geist Mono, one width, and nothing Noto is fetched", async () => {
    const { bytes, requested } = await recording(
      "Zażółć gęślą jaźń\nПривет, мир\nWide iii",
      "notes",
    );
    expect(requested.map((pack) => pack.file)).toEqual([fontPack("mono").file]);
    expect(fontPack("mono").file).not.toMatch(/Noto/);
    const faces = await embeddedFaces(bytes);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.characters).toContain("ż");
    expect(faces[0]!.characters).toContain("П");
    expect([...faces[0]!.advanceWidths]).toHaveLength(1);
  }, 30_000);

  it("positive control: Greek text does reach a proportional Noto face", async () => {
    const { bytes, requested } = await recording("Καλημέρα κόσμε", "notes");
    expect(requested.some((pack) => /^Noto/.test(pack.file))).toBe(true);
    const faces = await embeddedFaces(bytes);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.advanceWidths.size).toBeGreaterThan(1);
  }, 30_000);
});
