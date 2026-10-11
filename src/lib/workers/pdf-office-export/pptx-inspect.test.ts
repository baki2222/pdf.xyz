// @native-canvas
/**
 * The instrument that decides whether a .pptx has the chain PowerPoint needs,
 * tested in both directions (CLAUDE.md rule 1):
 *
 *  - POSITIVE CONTROL: a deck Microsoft PowerPoint saved itself passes. Without
 *    it, this module and the engine are written by the same author and can
 *    share a misconception; with it, the vocabulary here answers to the
 *    consumer's. `fixtures/powerpoint-authored.pptx` was made on 2026-09-27 by
 *    PowerPoint 16.0 build 20326 over COM (`Presentations.Add`, one blank
 *    slide with a text box, the ten unused layouts deleted, `SaveAs`), then its
 *    `dc:creator`/`cp:lastModifiedBy` were rewritten to "pdf.xyz test
 *    fixture". The scrubbed file was reopened through COM before it was
 *    committed: 1 slide, 1 master, its text read back.
 *  - NEGATIVE CONTROL: the package the engine wrote before 2026-09-27, which
 *    PowerPoint refused, fails, naming why.
 *  - EVERY CHECK FIRES: one mutation per check id, typed so the compiler wants
 *    a mutation for each, and asserted so each must actually fire.
 *  - EVERY PART AND EDGE IS LOAD-BEARING: deleting any part, or any
 *    relationship, of a passing package turns it red, apart from one removal
 *    that was measured against PowerPoint and is named below.
 */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages } from "./page-scan";
import {
  inspectPptxPackage,
  PPTX_CHECKS,
  type PptxCheck,
} from "./pptx-inspect";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";
import { handBuiltPptx } from "@/tests/pptx-fixture";
import { linesPdf, pdftotextStandIn } from "@/tests/pptx-fidelity-fixtures";
import { xmlWellFormedness } from "@/tests/xml-well-formed";

const POWERPOINT_AUTHORED = new Uint8Array(
  readFileSync(new URL("./fixtures/powerpoint-authored.pptx", import.meta.url)),
);

const PAGES = [
  { pageNumber: 1, text: "One", characterCount: 3 },
  { pageNumber: 2, text: "Two", characterCount: 3 },
];

/**
 * The engine's deck for a real two-page PDF whose first page carries a
 * picture, through the real page reader — so the picture checks below have a
 * `p:pic`, a blip, an image relationship and a media part to mutate. Until
 * 2026-10-10 this fed the engine a stub extraction of two text pages, and the
 * deck it made had no picture for any check to look at.
 */
async function engineDeck(): Promise<Uint8Array> {
  const fixture = await linesPdf([["One"], ["Two"]], { picture: true });
  const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
    extract: async () => pdftotextStandIn(fixture),
    scanPages: scanPdfPages,
  });
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

async function inspect(bytes: Uint8Array) {
  return inspectPptxPackage(bytes, { wellFormed: xmlWellFormedness });
}
const checksOf = (inspection: { problems: readonly { check: PptxCheck }[] }) =>
  new Set(inspection.problems.map((p) => p.check));

/** Rebuild a package after `edit`. */
async function mutate(
  bytes: Uint8Array,
  edit: (zip: JSZip) => Promise<void>,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  await edit(zip);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/**
 * Replace text inside one part, and FAIL if nothing changed. A mutation that
 * silently misses its line looks exactly like a thin guard from outside.
 */
async function replaceIn(
  zip: JSZip,
  part: string,
  from: string | RegExp,
  to: string,
): Promise<void> {
  const file = zip.file(part);
  if (!file) throw new Error(`mutation target ${part} is not in the package`);
  const before = await file.async("string");
  const after = before.replace(from, to);
  if (after === before)
    throw new Error(`mutation did not land: ${String(from)} in ${part}`);
  zip.file(part, after);
}

/**
 * The id of the one relationship of `type` in `relsPart`, read from the
 * package, so a mutation can point an element at a relationship of the WRONG
 * type without knowing how the writer numbers them.
 */
async function relIdOfType(
  zip: JSZip,
  relsPart: string,
  type: string,
): Promise<string> {
  const xml = await zip.file(relsPart)!.async("string");
  const ids = [...xml.matchAll(/<Relationship [^>]*\/>/g)]
    .map((m) => m[0])
    .filter((rel) => rel.includes(`/relationships/${type}"`))
    .map((rel) => /Id="([^"]+)"/.exec(rel)![1]!);
  if (ids.length !== 1)
    throw new Error(`${relsPart} has ${ids.length} ${type} relationships`);
  return ids[0]!;
}

const PRES = "ppt/presentation.xml";
const PRES_RELS = "ppt/_rels/presentation.xml.rels";
const MASTER = "ppt/slideMasters/slideMaster1.xml";
const MASTER_RELS = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
const LAYOUT = "ppt/slideLayouts/slideLayout1.xml";
const LAYOUT_RELS = "ppt/slideLayouts/_rels/slideLayout1.xml.rels";
const CT = "[Content_Types].xml";
const SLIDE1 = "ppt/slides/slide1.xml";
const SLIDE1_RELS = "ppt/slides/_rels/slide1.xml.rels";

type Mutation = (base: Uint8Array) => Promise<Uint8Array>;
const edit =
  (fn: (zip: JSZip) => Promise<void>): Mutation =>
  (base) =>
    mutate(base, fn);

/**
 * One mutation per check. `Record<PptxCheck, …>`: a check added to the module
 * does not compile here until it has a mutation, and the test below requires
 * every mutation to fire its own check.
 *
 * A mutation names a relationship by the element that points at it, never by
 * its `rId`: the ids are the writer's own business. The first version spelled
 * out the numbering of the writer it was written against (master `rId1`,
 * slides from `rId3`), and when the writer in `./pptx-package` replaced that
 * one (slides from `rId1`, master after them) `replaceIn` refused to run the
 * mutation instead of letting it miss quietly.
 */
const FIRES: Record<PptxCheck, Mutation> = {
  "not-zip": async () => new TextEncoder().encode("not a zip at all"),
  "content-types-missing": edit(async (z) => void z.remove(CT)),
  "override-without-part": edit((z) =>
    replaceIn(
      z,
      CT,
      "</Types>",
      `<Override PartName="/ppt/slides/slide99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    ),
  ),
  "part-without-content-type": edit(async (z) => void z.file("notes.txt", "x")),
  "duplicate-relationship-id": edit((z) =>
    // The second relationship takes the first one's id, whatever it is.
    replaceIn(
      z,
      PRES_RELS,
      /Id="([^"]+)"([\s\S]*?)Id="[^"]+"/,
      'Id="$1"$2Id="$1"',
    ),
  ),
  "dangling-relationship": edit(
    async (z) => void z.remove("ppt/theme/theme1.xml"),
  ),
  "unreachable-part": edit(async (z) => {
    z.file("ppt/slides/slide9.xml", "<x/>");
    await replaceIn(
      z,
      CT,
      "</Types>",
      `<Override PartName="/ppt/slides/slide9.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    );
  }),
  "office-document": edit((z) =>
    replaceIn(
      z,
      "_rels/.rels",
      "relationships/officeDocument",
      "relationships/extended-properties",
    ),
  ),
  "no-slide-master": edit((z) =>
    replaceIn(z, PRES, /<p:sldMasterIdLst>.*<\/p:sldMasterIdLst>/, ""),
  ),
  "master-id-range": edit((z) =>
    replaceIn(z, PRES, 'sldMasterId id="2147483648"', 'sldMasterId id="1"'),
  ),
  // The listed master points at the presentation's THEME relationship: one
  // that exists, of the wrong type.
  "master-reference": edit(async (z) =>
    replaceIn(
      z,
      PRES,
      /(sldMasterId id="2147483648" r:id=")[^"]*"/,
      `$1${await relIdOfType(z, PRES_RELS, "theme")}"`,
    ),
  ),
  "slide-id-range": edit((z) =>
    replaceIn(z, PRES, 'sldId id="256"', 'sldId id="2147483999"'),
  ),
  "duplicate-slide-id": edit((z) =>
    replaceIn(z, PRES, 'sldId id="257"', 'sldId id="256"'),
  ),
  // The first slide points at an id no relationship has.
  "slide-reference": edit((z) =>
    replaceIn(z, PRES, /(sldId id="256" r:id=")[^"]*"/, '$1rId99"'),
  ),
  "unlisted-slide": edit((z) =>
    replaceIn(z, PRES, /<p:sldId id="257" r:id="[^"]*"\/>/, ""),
  ),
  "no-slide-size": edit((z) => replaceIn(z, PRES, /<p:sldSz [^>]*\/>/, "")),
  // Half an inch wide: under the inch PowerPoint takes.
  "slide-size-range": edit((z) =>
    replaceIn(z, PRES, /(<p:sldSz cx=")\d+"/, '$1457200"'),
  ),
  // The picture keeps its blip element but loses the attribute naming it.
  "picture-without-blip": edit((z) =>
    replaceIn(z, SLIDE1, /<a:blip r:embed="[^"]*"/, "<a:blip"),
  ),
  // The blip names the slide's LAYOUT relationship: one that exists, of the
  // wrong type.
  "picture-reference": edit(async (z) =>
    replaceIn(
      z,
      SLIDE1,
      /<a:blip r:embed="[^"]*"/,
      `<a:blip r:embed="${await relIdOfType(z, SLIDE1_RELS, "slideLayout")}"`,
    ),
  ),
  // The media part's extension is declared as something that is not an image.
  "picture-content-type": edit((z) =>
    replaceIn(
      z,
      CT,
      /<Default Extension="(png|jpeg)" ContentType="image\/(png|jpeg)"\/>/,
      '<Default Extension="$1" ContentType="application/octet-stream"/>',
    ),
  ),
  // The bytes behind the image are not an image at all.
  "picture-format": edit(async (z) => {
    const media = Object.keys(z.files).filter(
      (n) => n.startsWith("ppt/media/") && !z.files[n]!.dir,
    );
    if (media.length === 0)
      throw new Error("mutation target: the deck has no media part");
    z.file(media[0]!, "this is not an image");
  }),
  "master-theme": edit((z) =>
    replaceIn(z, MASTER_RELS, /<Relationship [^>]*\/theme"[^>]*\/>/, ""),
  ),
  "no-slide-layout": edit((z) =>
    replaceIn(z, MASTER, /<p:sldLayoutIdLst>.*<\/p:sldLayoutIdLst>/, ""),
  ),
  "layout-id-range": edit((z) =>
    replaceIn(z, MASTER, 'sldLayoutId id="2147483649"', 'sldLayoutId id="5"'),
  ),
  "layout-id-reused": edit((z) =>
    replaceIn(
      z,
      MASTER,
      'sldLayoutId id="2147483649"',
      'sldLayoutId id="2147483648"',
    ),
  ),
  // The listed layout points at the master's theme relationship.
  "layout-reference": edit(async (z) =>
    replaceIn(
      z,
      MASTER,
      /(sldLayoutId id="2147483649" r:id=")[^"]*"/,
      `$1${await relIdOfType(z, MASTER_RELS, "theme")}"`,
    ),
  ),
  "layout-back-reference": edit((z) =>
    replaceIn(
      z,
      LAYOUT_RELS,
      'slideMaster" Target="../slideMasters/slideMaster1.xml"',
      'theme" Target="../theme/theme1.xml"',
    ),
  ),
  "slide-layout-count": edit(
    async (z) => void z.remove("ppt/slides/_rels/slide1.xml.rels"),
  ),
  "slide-layout-unlisted": edit(async (z) => {
    // A second, well-formed layout that points at the master, which the
    // master does not list, used by slide 1.
    z.file(
      "ppt/slideLayouts/slideLayout2.xml",
      await z.file(LAYOUT)!.async("string"),
    );
    z.file(
      "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
      await z.file(LAYOUT_RELS)!.async("string"),
    );
    await replaceIn(
      z,
      CT,
      "</Types>",
      `<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>`,
    );
    await replaceIn(
      z,
      "ppt/slides/_rels/slide1.xml.rels",
      "slideLayout1.xml",
      "slideLayout2.xml",
    );
  }),
  "wrong-content-type": edit((z) =>
    replaceIn(
      z,
      CT,
      /(PartName="\/ppt\/theme\/theme1.xml" ContentType=")[^"]*"/,
      '$1application/xml"',
    ),
  ),
  "not-well-formed": edit((z) =>
    replaceIn(z, "ppt/slides/slide1.xml", "</p:sld>", "</p:sld><oops"),
  ),
};

describe("xmlWellFormedness (the parser the checks below lean on)", () => {
  it("accepts XML and refuses what XML 1.0 refuses", () => {
    // Positive controls for the helper itself: a parser that stopped reporting
    // errors would pass every package in this file.
    expect(xmlWellFormedness("<a><b/></a>")).toBeNull();
    expect(xmlWellFormedness("<a><b></a>")).not.toBeNull();
    expect(xmlWellFormedness("<a>\u0001</a>")).not.toBeNull();
    expect(xmlWellFormedness("<a>\uFFFF</a>")).not.toBeNull();
    expect(xmlWellFormedness("<p:x/>")).not.toBeNull();
  });
});

describe("inspectPptxPackage", () => {
  it("POSITIVE CONTROL: passes a deck PowerPoint saved itself", async () => {
    const inspection = await inspect(POWERPOINT_AUTHORED);
    expect(inspection.problems).toEqual([]);
    expect(inspection.counts).toEqual({
      parts: 17,
      reached: 17,
      masters: 1,
      layouts: 1,
      themes: 1,
      slides: 1,
      pictures: 0,
    });
  });

  it("NEGATIVE CONTROL: fails the package PowerPoint refused, naming the chain", async () => {
    const inspection = await inspect(await pptxBefore20260927(PAGES));
    expect([...checksOf(inspection)].sort()).toEqual([
      "no-slide-master",
      "no-slide-size",
      "slide-layout-count",
    ]);
    expect(inspection.counts).toMatchObject({ masters: 0, slides: 2 });
  });

  it("POSITIVE CONTROL: passes the hand-built deck `./validate-ooxml` is calibrated on", async () => {
    // The other branch's control for the same refusal: built part by part,
    // independent of both the writer and this module, opened by PowerPoint
    // (COM, 2026-09-27) and converted by LibreOffice on every proof run.
    const inspection = await inspect(await handBuiltPptx());
    expect(inspection.problems).toEqual([]);
    expect(inspection.counts).toEqual({
      parts: 11,
      reached: 11,
      masters: 1,
      layouts: 1,
      themes: 1,
      slides: 1,
      pictures: 0,
    });
  });

  it("passes the engine's package, so the mutations below start from green", async () => {
    const inspection = await inspect(await engineDeck());
    expect(inspection.problems).toEqual([]);
    expect(inspection.counts).toMatchObject({
      masters: 1,
      layouts: 1,
      themes: 1,
      slides: 2,
    });
    // Health: the picture checks have a picture to check.
    expect(inspection.counts.pictures).toBeGreaterThanOrEqual(1);
  });

  it("EVERY CHECK FIRES on the mutation written for it", async () => {
    const base = await engineDeck();
    const checks = Object.keys(PPTX_CHECKS) as PptxCheck[];
    // Health check on the corpus itself: it is derived from the module's own
    // check list, so an empty or collapsed list would pass vacuously.
    expect(checks.length).toBeGreaterThanOrEqual(20);
    const missed: string[] = [];
    for (const check of checks) {
      const fired = checksOf(await inspect(await FIRES[check](base)));
      if (!fired.has(check))
        missed.push(
          `${check} (fired instead: ${[...fired].join(", ") || "nothing"})`,
        );
    }
    expect(missed).toEqual([]);
  });

  it.each([
    ["the engine's package", engineDeck],
    ["PowerPoint's own deck", async () => POWERPOINT_AUTHORED],
  ])(
    "EVERY PART of %s is load-bearing: deleting any one turns it red",
    async (_, make) => {
      const base = await make();
      const zip = await JSZip.loadAsync(base);
      const parts = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
      // Bound the sweep by the inspector's own count, so a sweep that quietly
      // lost members cannot report the strongest possible pass.
      expect(parts.length).toBe((await inspect(base)).counts.parts);
      expect(parts.length).toBeGreaterThanOrEqual(13);
      const survived: string[] = [];
      for (const part of parts) {
        const inspection = await inspect(
          await mutate(base, async (z) => void z.remove(part)),
        );
        if (inspection.problems.length === 0) survived.push(part);
      }
      expect(survived).toEqual([]);
    },
  );

  it("EVERY RELATIONSHIP of the engine's package is load-bearing, bar one measured exception", async () => {
    const base = await engineDeck();
    const zip = await JSZip.loadAsync(base);
    const relsParts = Object.keys(zip.files).filter((n) => n.endsWith(".rels"));
    const survived: string[] = [];
    let swept = 0;
    for (const part of relsParts) {
      const xml = await zip.file(part)!.async("string");
      for (const rel of xml.match(/<Relationship [^>]*\/>/g) ?? []) {
        swept++;
        const inspection = await inspect(
          await mutate(base, (z) => replaceIn(z, part, rel, "")),
        );
        if (inspection.problems.length === 0)
          survived.push(`${part} → ${/Type="[^"]*\/(\w+)"/.exec(rel)?.[1]}`);
      }
    }
    // 1 root + 4 presentation (master, theme, two slides) + 2 master (layout,
    // theme) + 1 layout + 1 per slide: ten relationships in a two-page deck,
    // and one per distinct picture on its slide since 2026-10-10 (the first
    // page's picture, and the slide's drawing layer when the page has one).
    const pictures = (await inspect(base)).counts.pictures;
    expect(pictures).toBeGreaterThanOrEqual(1);
    expect(swept).toBe(10 + pictures);
    // THE ONE EXCEPTION, AND WHY IT IS ALLOWED: PowerPoint writes a
    // presentation → theme relationship, but on 2026-09-27 (16.0 build 20326)
    // it opened the engine's file through COM with that relationship removed —
    // 3 slides, 1 master. The master → theme edge, which IS checked, carries
    // the theme. If PowerPoint ever refuses such a file, make the inspector
    // require it and this list goes empty.
    expect(survived).toEqual(["ppt/_rels/presentation.xml.rels → theme"]);
  });
});
