/**
 * Does a .pptx carry the part chain Microsoft PowerPoint needs before it will
 * open the file?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Until 2026-09-27 the PDF to PowerPoint engine wrote a package holding
 * `presentation.xml` and one slide per page, and nothing else. Every check the
 * product had was green: the unit test asserted `ppt/slides/slide1.xml` was in
 * the ZIP, and the deployment proof asserted the download started `PK`. The
 * Windows desktop app refused every one of those files as "corrupted and
 * unreadable" (0x80070570). Both checks read the author's artifact — "did I
 * write the slide?" — and neither asked what a reader needs to open it.
 *
 * ── WHAT IT CHECKS, AND HOW IT FINDS ITS SUBJECTS ───────────────────────────
 *
 * It WALKS the package from `_rels/.rels`, following every relationship, rather
 * than naming files: a named list cannot see a part it does not name, and a
 * slide written under the wrong filename (the old engine named slide files by
 * page number and relationships by index) is exactly such a part. Then it
 * checks the chain PresentationML requires:
 *
 *   package root ─officeDocument→ presentation
 *   presentation ─sldMasterIdLst→ slide master ─theme→ theme
 *                                  slide master ─sldLayoutIdLst→ slide layout(s)
 *   presentation ─sldIdLst→ slide ─slideLayout→ a layout that master lists
 *   slide layout ─slideMaster→ the master that lists it
 *
 * plus the content type of every part, the ID ranges ECMA-376 sets, and that
 * nothing in the ZIP is unreachable from the root. A `presentation → theme`
 * relationship is NOT required: PowerPoint writes one, but measured on
 * 2026-09-27 it opened a generated file with that relationship removed (the
 * writer of that day, since replaced by `./pptx-package`).
 *
 * Every check has an id in {@link PPTX_CHECKS}, and `pptx-inspect.test.ts`
 * holds a mutation that fires each one, so no check here is decoration.
 *
 * This module was `pptx-package.ts` until 2026-10-09. Two branches fixed the
 * same refusal on the same day, one with this inspector and one with a new
 * writer that took the name; the writer kept it, and this moved here.
 *
 * ── WHY IT SHARES NO CONSTANTS WITH THE WRITER ──────────────────────────────
 *
 * The relationship types and content types below are typed out again rather
 * than imported from the writer, `./pptx-package`, on purpose. If both read one
 * constant, a typo in it would be consistent in both and this check would pass
 * it. Instead each side answers to something else: this module must pass a
 * deck saved by PowerPoint itself (`pptx-inspect.test.ts`, the positive
 * control), which pins its vocabulary to the consumer's, and the writer's
 * output must pass this module: before every delivery (`./engine` refuses a
 * deck that fails, as `incomplete_output`) and at worker start-up
 * (`./capability`, published as `pptxPresentationChain`).
 *
 * `./validate-ooxml` is a second reader of the same files, deeper (shape trees,
 * theme schemes, a real namespace-aware parser) and built on jsdom, which the
 * worker image does not carry; it runs in tests and proofs. This one needs
 * nothing beyond JSZip, which is why it is the one a worker can run.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means the structural chain is present and resolves. It does NOT mean
 * PowerPoint opens the file: PowerPoint also rejects things this module does
 * not model (a non-numeric shape offset, for one). The only instrument for that
 * property is PowerPoint, and `scripts/prove-pptx-opens.ts` runs it where
 * PowerPoint is installed. This is the necessary condition that CI and a Linux
 * worker can check.
 *
 * Element names are matched with the `p:` and `r:` prefixes PowerPoint and the
 * writer both write. A package using other prefixes reads as broken, which is
 * a false red and never a false green.
 */

import JSZip from "jszip";

const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_TYPE = {
  officeDocument: `${OFFICE_REL}/officeDocument`,
  slide: `${OFFICE_REL}/slide`,
  slideLayout: `${OFFICE_REL}/slideLayout`,
  slideMaster: `${OFFICE_REL}/slideMaster`,
  theme: `${OFFICE_REL}/theme`,
  image: `${OFFICE_REL}/image`,
} as const;

const OFFICE_CT = "application/vnd.openxmlformats-officedocument";
const CONTENT_TYPE = {
  presentation: `${OFFICE_CT}.presentationml.presentation.main+xml`,
  slide: `${OFFICE_CT}.presentationml.slide+xml`,
  slideLayout: `${OFFICE_CT}.presentationml.slideLayout+xml`,
  slideMaster: `${OFFICE_CT}.presentationml.slideMaster+xml`,
  theme: `${OFFICE_CT}.theme+xml`,
  relationships: "application/vnd.openxmlformats-package.relationships+xml",
} as const;

/** `sldMasterId` and `sldLayoutId` values share this floor (ECMA-376 §19.2.1). */
const MASTER_ID_FLOOR = 2_147_483_648;
/** `sldId` values live in [256, 2^31) (ECMA-376 §19.2.1). */
const SLIDE_ID_FLOOR = 256;
/**
 * `ST_SlideSizeCoordinate`, in EMU: 1 inch to 56 inches. PowerPoint refuses a
 * deck whose `p:sldSz` is outside it. Typed again here, not imported from the
 * writer, for the reason the header gives.
 */
const SLIDE_SIZE_EMU = [914_400, 51_206_400] as const;

/**
 * The DrawingML transform attributes a slide places and sizes things with:
 * offsets are `ST_Coordinate` (a signed long), extents
 * `ST_PositiveCoordinate` (non-negative). Each must be a whole number.
 */
const COORDINATE_ATTRIBUTES: readonly (readonly [
  string,
  readonly string[],
  boolean,
])[] = [
  ["a:off", ["x", "y"], true],
  ["a:chOff", ["x", "y"], true],
  ["a:ext", ["cx", "cy"], false],
  ["a:chExt", ["cx", "cy"], false],
];
/** The first bytes of each image type a picture may name. */
const IMAGE_MAGIC: Readonly<Record<string, readonly number[]>> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

const CONTENT_TYPES_PART = "[Content_Types].xml";
const ROOT_RELS = "_rels/.rels";

/**
 * Every check this module makes, by id. Enforced in both directions, by two
 * different things: `fail()` only accepts a key of this object, so a check
 * cannot exist without a line here (the compiler); and `pptx-inspect.test.ts`
 * derives its corpus from these keys and requires a mutation that fires each,
 * so a line cannot outlive its check (the test).
 */
export const PPTX_CHECKS = {
  "not-zip": "the file is not a ZIP container",
  "content-types-missing": "[Content_Types].xml is absent",
  "override-without-part": "a content-type override names a missing part",
  "part-without-content-type": "a part has no content type",
  "duplicate-relationship-id": "a relationships part reuses an id",
  "dangling-relationship": "a relationship targets a missing part",
  "unreachable-part": "a part nothing points at",
  "office-document": "the root does not name exactly one officeDocument",
  "no-slide-master": "the presentation lists no slide master",
  "master-id-range": "a slide master id is below 2^31",
  "master-reference": "a listed master is not a slideMaster relationship",
  "slide-id-range": "a slide id is outside [256, 2^31)",
  "duplicate-slide-id": "two slides share an id",
  "slide-reference": "a listed slide is not a slide relationship",
  "unlisted-slide": "a slide relationship sldIdLst does not list",
  "no-slide-size": "the presentation has no p:sldSz",
  "slide-size-range": "the slide size is outside 1–56 inches",
  "coordinate-not-integer":
    "a slide position or size is not a whole number of EMU",
  "picture-without-blip": "a picture names no image",
  "picture-reference": "a picture's blip is not an image relationship",
  "picture-content-type": "a picture's part is not typed as an image",
  "picture-format": "a picture's bytes are not the image its type says",
  "master-theme": "a master lacks exactly one theme",
  "no-slide-layout": "a master lists no layout",
  "layout-id-range": "a layout id is below 2^31",
  "layout-id-reused": "a layout id repeats a master or layout id",
  "layout-reference": "a listed layout is not a slideLayout relationship",
  "layout-back-reference": "a layout does not point back at its master",
  "slide-layout-count": "a slide lacks exactly one layout",
  "slide-layout-unlisted": "a slide uses a layout no master lists",
  "wrong-content-type": "a chain part has the wrong content type",
  "not-well-formed": "a part is not well-formed XML",
} as const satisfies Record<string, string>;

export type PptxCheck = keyof typeof PPTX_CHECKS;

export interface PptxProblem {
  readonly check: PptxCheck;
  readonly detail: string;
}

/** Says why an XML part is not well formed, or `null` when it is. */
export type XmlWellFormedness = (xml: string) => string | null;

export interface PptxPackageInspection {
  /** Every reason this package is not a complete presentation. Empty = pass. */
  readonly problems: readonly PptxProblem[];
  /**
   * What the walk reached — its own health check. A walk that reached nothing
   * reports no problems about the parts it never saw, so `problems: []` only
   * means something next to counts that could not be zero.
   */
  readonly counts: {
    readonly parts: number;
    readonly reached: number;
    readonly masters: number;
    readonly layouts: number;
    readonly themes: number;
    readonly slides: number;
    /**
     * Pictures (`p:pic`) on the listed slides whose image resolves: an image
     * relationship to a part typed as, and holding, an image. Lets the engine
     * check the deck holds every picture it planned.
     */
    readonly pictures: number;
  };
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  /** Package-relative part name, no leading slash. */
  readonly target: string;
  readonly external: boolean;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Attributes of every `<qname …>` element in `xml`, in document order. */
function elements(xml: string, qname: string): Record<string, string>[] {
  const tag = new RegExp(
    `<${qname.replace(/[.:]/g, "\\$&")}(\\s[^>]*?)?/?>`,
    "g",
  );
  const found: Record<string, string>[] = [];
  for (const match of xml.matchAll(tag)) {
    const attributes: Record<string, string> = {};
    for (const attr of (match[1] ?? "").matchAll(
      /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    ))
      attributes[attr[1]!] = decodeXmlAttribute(attr[2] ?? attr[3] ?? "");
    found.push(attributes);
  }
  return found;
}

function directoryOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash === -1 ? "" : part.slice(0, slash);
}

/** The relationships part that belongs to `part` ("" is the package itself). */
function relsPartFor(part: string): string {
  if (part === "") return ROOT_RELS;
  const dir = directoryOf(part);
  const base = part.slice(dir.length === 0 ? 0 : dir.length + 1);
  return `${dir.length === 0 ? "" : `${dir}/`}_rels/${base}.rels`;
}

/** Resolve a relationship target against its source part, as OPC does. */
function resolveTarget(source: string, target: string): string {
  let raw = target;
  try {
    raw = decodeURIComponent(target);
  } catch {
    // Not percent-encoded; use it as written.
  }
  const joined = raw.startsWith("/")
    ? raw.slice(1)
    : [directoryOf(source), raw].filter(Boolean).join("/");
  const segments: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

function extensionOf(part: string): string {
  const dot = part.lastIndexOf(".");
  return dot === -1 ? "" : part.slice(dot + 1).toLowerCase();
}

function idValue(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Walk a .pptx and list every way it falls short of a complete presentation.
 *
 * `wellFormed`, when given, is run over every XML and relationships part. It is
 * a parameter rather than built in because the real XML parser available to
 * the tests (jsdom) is a dev dependency, and the worker's start-up probe runs
 * this module in an image that does not carry one.
 */
export async function inspectPptxPackage(
  bytes: Uint8Array,
  options: { wellFormed?: XmlWellFormedness } = {},
): Promise<PptxPackageInspection> {
  const problems: PptxProblem[] = [];
  const fail = (check: PptxCheck, detail: string) =>
    problems.push({ check, detail });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    fail("not-zip", "the file is not a ZIP container");
    return {
      problems,
      counts: {
        parts: 0,
        reached: 0,
        masters: 0,
        layouts: 0,
        themes: 0,
        slides: 0,
        pictures: 0,
      },
    };
  }
  const names = new Set(
    Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name),
  );
  const text = new Map<string, string>();
  const read = async (part: string): Promise<string | undefined> => {
    if (text.has(part)) return text.get(part);
    const file = zip.file(part);
    if (!file) return undefined;
    const xml = await file.async("string");
    text.set(part, xml);
    return xml;
  };

  // ── Content types ──────────────────────────────────────────────────────
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const typesXml = await read(CONTENT_TYPES_PART);
  if (typesXml === undefined) {
    fail("content-types-missing", `${CONTENT_TYPES_PART} is missing`);
  } else {
    for (const d of elements(typesXml, "Default"))
      if (d.Extension && d.ContentType)
        defaults.set(d.Extension.toLowerCase(), d.ContentType);
    for (const o of elements(typesXml, "Override")) {
      if (!o.PartName || !o.ContentType) continue;
      const part = o.PartName.replace(/^\//, "");
      overrides.set(part, o.ContentType);
      if (!names.has(part))
        fail(
          "override-without-part",
          `${CONTENT_TYPES_PART} declares ${part}, which is not in the package`,
        );
    }
  }
  const contentTypeOf = (part: string): string | undefined =>
    overrides.get(part) ?? defaults.get(extensionOf(part));
  for (const part of names) {
    if (part === CONTENT_TYPES_PART) continue;
    if (!contentTypeOf(part))
      fail("part-without-content-type", `${part} has no content type`);
  }

  // ── Relationship walk from the package root ───────────────────────────
  const relsOf = new Map<string, Relationship[]>();
  const reached = new Set<string>([CONTENT_TYPES_PART]);
  const queue: string[] = [""];
  while (queue.length > 0) {
    const source = queue.shift()!;
    const relsPart = relsPartFor(source);
    const relsXml = await read(relsPart);
    if (relsXml === undefined) {
      relsOf.set(source, []);
      continue;
    }
    reached.add(relsPart);
    const seenIds = new Set<string>();
    const rels: Relationship[] = [];
    for (const r of elements(relsXml, "Relationship")) {
      const id = r.Id ?? "";
      if (seenIds.has(id))
        fail(
          "duplicate-relationship-id",
          `${relsPart} uses relationship id ${id} twice`,
        );
      seenIds.add(id);
      const external = r.TargetMode === "External";
      const target = external
        ? (r.Target ?? "")
        : resolveTarget(source, r.Target ?? "");
      rels.push({ id, type: r.Type ?? "", target, external });
      if (external) continue;
      if (!names.has(target)) {
        fail(
          "dangling-relationship",
          `${relsPart} (${id}) points at ${target}, which is not in the package`,
        );
        continue;
      }
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
    relsOf.set(source, rels);
  }
  for (const part of names)
    if (!reached.has(part))
      fail(
        "unreachable-part",
        `${part} is in the package but nothing points at it`,
      );

  const relById = (source: string, id: string | undefined) =>
    (relsOf.get(source) ?? []).find((r) => r.id === id && !r.external);
  const relsOfType = (source: string, type: string) =>
    (relsOf.get(source) ?? []).filter((r) => r.type === type && !r.external);
  const expectType = (part: string, want: string, role: string) => {
    const got = contentTypeOf(part);
    if (got !== want)
      fail(
        "wrong-content-type",
        `${part} is used as the ${role} but its content type is ${got ?? "missing"}`,
      );
  };

  // ── The presentation part ─────────────────────────────────────────────
  const docRels = relsOfType("", REL_TYPE.officeDocument);
  if (docRels.length !== 1)
    fail(
      "office-document",
      `${ROOT_RELS} must name exactly one officeDocument part; it names ${docRels.length}`,
    );
  const presentation = docRels[0]?.target;
  const masters = new Set<string>();
  const layoutsListedBy = new Map<string, string>();
  const themes = new Set<string>();
  const slides: string[] = [];
  let pictures = 0;
  const presentationXml =
    presentation !== undefined && names.has(presentation)
      ? await read(presentation)
      : undefined;

  if (presentation !== undefined && presentationXml !== undefined) {
    expectType(presentation, CONTENT_TYPE.presentation, "presentation");
    const masterIds = new Set<number>();

    const masterRefs = elements(presentationXml, "p:sldMasterId");
    if (masterRefs.length === 0)
      fail(
        "no-slide-master",
        `${presentation} lists no slide master (p:sldMasterIdLst is empty or absent)`,
      );
    for (const ref of masterRefs) {
      const id = idValue(ref.id);
      if (id === null || id < MASTER_ID_FLOOR)
        fail(
          "master-id-range",
          `${presentation} gives a slide master the id ${ref.id ?? "(none)"}; it must be at least ${MASTER_ID_FLOOR}`,
        );
      else masterIds.add(id);
      const rel = relById(presentation, ref["r:id"]);
      if (!rel || rel.type !== REL_TYPE.slideMaster) {
        fail(
          "master-reference",
          `${presentation} lists slide master ${ref["r:id"] ?? "(no r:id)"}, which is not a slideMaster relationship`,
        );
        continue;
      }
      if (names.has(rel.target)) masters.add(rel.target);
    }

    const slideIds = new Set<number>();
    for (const ref of elements(presentationXml, "p:sldId")) {
      const id = idValue(ref.id);
      if (id === null || id < SLIDE_ID_FLOOR || id >= MASTER_ID_FLOOR)
        fail(
          "slide-id-range",
          `${presentation} gives a slide the id ${ref.id ?? "(none)"}; it must be in [${SLIDE_ID_FLOOR}, ${MASTER_ID_FLOOR})`,
        );
      else if (slideIds.has(id))
        fail("duplicate-slide-id", `${presentation} uses slide id ${id} twice`);
      else slideIds.add(id);
      const rel = relById(presentation, ref["r:id"]);
      if (!rel || rel.type !== REL_TYPE.slide) {
        fail(
          "slide-reference",
          `${presentation} lists slide ${ref["r:id"] ?? "(no r:id)"}, which is not a slide relationship`,
        );
        continue;
      }
      if (names.has(rel.target)) slides.push(rel.target);
    }
    for (const rel of relsOfType(presentation, REL_TYPE.slide))
      if (!slides.includes(rel.target))
        fail(
          "unlisted-slide",
          `${presentation} has a slide relationship to ${rel.target} that p:sldIdLst does not list`,
        );

    const sizes = elements(presentationXml, "p:sldSz");
    if (sizes.length === 0)
      fail("no-slide-size", `${presentation} has no slide size (p:sldSz)`);
    for (const size of sizes)
      for (const axis of ["cx", "cy"] as const) {
        const v = idValue(size[axis]);
        if (v === null || v < SLIDE_SIZE_EMU[0] || v > SLIDE_SIZE_EMU[1])
          fail(
            "slide-size-range",
            `${presentation} sets the slide ${axis} to ${size[axis] ?? "(none)"} EMU; PowerPoint takes ${SLIDE_SIZE_EMU[0]}–${SLIDE_SIZE_EMU[1]}`,
          );
      }

    // ── Masters: theme + the layouts each one lists ───────────────────────
    const layoutIds = new Set<number>(masterIds);
    for (const master of masters) {
      expectType(master, CONTENT_TYPE.slideMaster, "slide master");
      const masterThemes = relsOfType(master, REL_TYPE.theme);
      if (masterThemes.length !== 1)
        fail(
          "master-theme",
          `${master} must have exactly one theme relationship; it has ${masterThemes.length}`,
        );
      for (const rel of masterThemes) {
        if (!names.has(rel.target)) continue;
        expectType(rel.target, CONTENT_TYPE.theme, "theme");
        themes.add(rel.target);
      }
      const masterXml = await read(master);
      const layoutRefs = masterXml ? elements(masterXml, "p:sldLayoutId") : [];
      if (layoutRefs.length === 0)
        fail(
          "no-slide-layout",
          `${master} lists no slide layout (p:sldLayoutIdLst is empty or absent)`,
        );
      for (const ref of layoutRefs) {
        const id = idValue(ref.id);
        if (id === null || id < MASTER_ID_FLOOR)
          fail(
            "layout-id-range",
            `${master} gives a slide layout the id ${ref.id ?? "(none)"}; it must be at least ${MASTER_ID_FLOOR}`,
          );
        else if (layoutIds.has(id))
          fail(
            "layout-id-reused",
            `${master} reuses the id ${id}; master and layout ids must all differ`,
          );
        else layoutIds.add(id);
        const rel = relById(master, ref["r:id"]);
        if (!rel || rel.type !== REL_TYPE.slideLayout) {
          fail(
            "layout-reference",
            `${master} lists layout ${ref["r:id"] ?? "(no r:id)"}, which is not a slideLayout relationship`,
          );
          continue;
        }
        if (names.has(rel.target)) layoutsListedBy.set(rel.target, master);
      }
    }

    // ── Layouts point back at the master that lists them ──────────────────
    for (const [layout, master] of layoutsListedBy) {
      expectType(layout, CONTENT_TYPE.slideLayout, "slide layout");
      const back = relsOfType(layout, REL_TYPE.slideMaster);
      if (back.length !== 1 || back[0]!.target !== master)
        fail(
          "layout-back-reference",
          `${layout} must point back at its slide master ${master}; it points at ${back.map((r) => r.target).join(", ") || "nothing"}`,
        );
    }

    // ── Positions and sizes: whole EMU, sizes not negative ─────────────────
    // PowerPoint refuses a slide whose a:off or a:ext is not an integer
    // (0x80070570), and a structural check cannot see a number: a NaN from
    // the page scan reached production this way (2026-10-17).
    for (const slide of slides) {
      const slideXml = (await read(slide)) ?? "";
      for (const [qname, keys, signed] of COORDINATE_ATTRIBUTES)
        for (const element of elements(slideXml, qname))
          for (const key of keys) {
            const value = element[key];
            if (value === undefined) continue;
            if (!(signed ? /^-?\d+$/ : /^\d+$/).test(value)) {
              fail(
                "coordinate-not-integer",
                `${slide} has <${qname} ${key}="${value}">; PowerPoint takes only a whole${signed ? "" : ", non-negative"} number of EMU`,
              );
              break;
            }
          }
    }

    // ── Pictures: each blip an image relationship to an image part ────────
    for (const slide of slides) {
      const slideXml = (await read(slide)) ?? "";
      for (const pic of slideXml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
        const embed = elements(pic, "a:blip")[0]?.["r:embed"];
        if (!embed) {
          fail(
            "picture-without-blip",
            `${slide} has a picture with no a:blip r:embed`,
          );
          continue;
        }
        const rel = relById(slide, embed);
        if (!rel || rel.type !== REL_TYPE.image) {
          fail(
            "picture-reference",
            `${slide} has a picture whose blip ${embed} is not an image relationship`,
          );
          continue;
        }
        if (!names.has(rel.target)) continue; // dangling-relationship says so
        const type = contentTypeOf(rel.target);
        const magic = type ? IMAGE_MAGIC[type] : undefined;
        if (!type?.startsWith("image/")) {
          fail(
            "picture-content-type",
            `${rel.target} is a picture on ${slide} but its content type is ${type ?? "missing"}`,
          );
          continue;
        }
        const head = await zip.file(rel.target)!.async("uint8array");
        if (magic && !magic.every((b, i) => head[i] === b)) {
          fail(
            "picture-format",
            `${rel.target} is typed ${type} but its bytes are not one`,
          );
          continue;
        }
        pictures++;
      }
    }

    // ── Slides use a layout that some master lists ────────────────────────
    for (const slide of slides) {
      expectType(slide, CONTENT_TYPE.slide, "slide");
      const layoutRels = relsOfType(slide, REL_TYPE.slideLayout);
      if (layoutRels.length !== 1) {
        fail(
          "slide-layout-count",
          `${slide} must have exactly one slide layout relationship; it has ${layoutRels.length}`,
        );
        continue;
      }
      const layout = layoutRels[0]!.target;
      if (names.has(layout) && !layoutsListedBy.has(layout))
        fail(
          "slide-layout-unlisted",
          `${slide} uses the layout ${layout}, which no slide master lists`,
        );
    }
  }

  // ── Every relationship part is typed as one ───────────────────────────
  for (const part of reached)
    if (part.endsWith(".rels") && names.has(part))
      expectType(part, CONTENT_TYPE.relationships, "relationships part");

  // ── Well-formedness, when a parser was supplied ────────────────────────
  if (options.wellFormed) {
    for (const part of names) {
      const ext = extensionOf(part);
      if (ext !== "xml" && ext !== "rels") continue;
      const why = options.wellFormed((await read(part)) ?? "");
      if (why !== null)
        fail("not-well-formed", `${part} is not well-formed XML: ${why}`);
    }
  }

  return {
    problems,
    counts: {
      parts: names.size,
      reached: [...reached].filter((part) => names.has(part)).length,
      masters: masters.size,
      layouts: layoutsListedBy.size,
      themes: themes.size,
      slides: slides.length,
      pictures,
    },
  };
}
