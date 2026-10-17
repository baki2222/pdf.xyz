/**
 * Read a PPTX the way PowerPoint has to before it will show a slide — for
 * PROOFS and tests, not for production.
 *
 * PDF to PowerPoint shipped a package PowerPoint refused as "corrupted and
 * unreadable" on every input: no slide master, layout or theme, no slide size,
 * empty `nvSpPr`, and a textless page's `txBody` with no paragraph. Both checks
 * that certified it asked the author's question — the unit test that
 * `ppt/slides/slide1.xml` was IN the ZIP, the deployment proof that the bytes
 * began with `PK` — and both were true of the corrupt deck. This asks the
 * consumer's question instead, and the unit test and the deployment proof
 * import the same function, so the bytes production returns are held to the
 * same bar as `main`.
 *
 * What it checks, all DISCOVERED from the package rather than from a list of
 * part names:
 * - every XML part is well-formed and namespace-bound (jsdom's XML parser);
 * - every part has a content type, and every relationship in every `.rels`
 *   resolves to a part that exists, declared with the type its relationship
 *   demands;
 * - the chain PowerPoint walks: package → presentation (`sldMasterIdLst`
 *   before `sldIdLst`, a `sldSz` PowerPoint accepts, `notesSz`, a theme) →
 *   each master (theme, `clrMap`, its layouts) → each slide → exactly one
 *   layout that a master lists;
 * - the shape tree: `nvGrpSpPr`/`nvSpPr` carry `cNvPr` (with id and name),
 *   `cNvSpPr`/`cNvGrpSpPr` and `nvPr`, and every `txBody` holds a paragraph;
 * - pictures (since 2026-10-10, when the deck began carrying them): every
 *   `p:pic` is `nvPicPr` (`cNvPr`, `cNvPicPr`, `nvPr`), `blipFill` (an
 *   `a:blip` first) and `spPr`, in that order; every `a:blip r:embed` names an
 *   IMAGE relationship, whose part is declared an `image/` type; and every
 *   `a:off`/`a:ext` holds whole numbers, an extent never negative;
 * - a theme whose colour, font and format schemes are complete.
 *
 * It is not a schema validator and does not pretend to be: a green here is
 * necessary, and the positive controls (a hand-built deck and a deck PowerPoint
 * saved itself) are what calibrate it. It shares nothing with the writer in
 * `./pptx-package`, so a wrong writer cannot be agreed with by its own inverse.
 */
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { inspectPptxPackage } from "./pptx-inspect";

const PML = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DML = "http://schemas.openxmlformats.org/drawingml/2006/main";
const ODOC_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";

const rel = (name: string) => `${ODOC_REL}/${name}`;
const PML_CT = "application/vnd.openxmlformats-officedocument.presentationml";
/** The content type the target of each relationship type must be declared as. */
const TARGET_CONTENT_TYPE: Readonly<Record<string, string>> = {
  [rel("officeDocument")]: `${PML_CT}.presentation.main+xml`,
  [rel("slide")]: `${PML_CT}.slide+xml`,
  [rel("slideLayout")]: `${PML_CT}.slideLayout+xml`,
  [rel("slideMaster")]: `${PML_CT}.slideMaster+xml`,
  [rel("theme")]: "application/vnd.openxmlformats-officedocument.theme+xml",
};

/** `ST_SlideSizeCoordinate`: PowerPoint refuses a slide outside this, in EMU. */
export const SLIDE_SIZE_RANGE_EMU = [914_400, 51_206_400] as const;
/** `ST_SlideMasterId` / `ST_SlideLayoutId` start here; `ST_SlideId` is 256–2147483647. */
const FIRST_MASTER_ID = 2_147_483_648;

let parser: DOMParser | undefined;
/** A parsed document, or the parser's complaint. */
function parse(xml: string): Document | string {
  parser ??= new new JSDOM("").window.DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  return error ? (error.textContent ?? "").trim() || "parse error" : doc;
}

/** Why `xml` is not well-formed, namespace-bound XML 1.0 — empty when it is. */
export function xmlProblems(xml: string): string[] {
  const parsed = parse(xml);
  return typeof parsed === "string" ? [parsed] : [];
}

const kids = (el: Element) => Array.from(el.children);
const is = (el: Element | undefined, ns: string, local: string) =>
  el?.namespaceURI === ns && el.localName === local;
const all = (root: Document | Element, ns: string, local: string) =>
  Array.from(root.getElementsByTagNameNS(ns, local));
const child = (el: Element, ns: string, local: string) =>
  kids(el).find((c) => is(c, ns, local));
function intAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

function dirOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash < 0 ? "" : part.slice(0, slash);
}
/** `ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels`; `""` → `_rels/.rels`. */
function relsPartOf(part: string): string {
  const dir = dirOf(part);
  const base = part.slice(dir.length ? dir.length + 1 : 0);
  return `${dir ? `${dir}/` : ""}_rels/${base}.rels`;
}
/** The inverse, for discovering every `.rels` in the package. */
function sourceOfRels(relsPart: string): string | null {
  const m = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(relsPart);
  if (!m) return null;
  return `${m[1] ? `${m[1]}/` : ""}${m[2]}`;
}
function resolve(fromDir: string, target: string): string {
  const segments = target.startsWith("/")
    ? []
    : fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  return segments.join("/");
}

interface Relationship {
  id: string;
  type: string;
  /** Resolved package part name, or the raw target when external. */
  target: string;
  external: boolean;
}

export interface PptxRead {
  /** Every reason PowerPoint could refuse the package; empty when none was found. */
  problems: string[];
  /** Each slide's paragraphs, in the order the presentation lists the slides. */
  slides: string[][];
  /**
   * Every part the relationship walk reached from `_rels/.rels`. A health
   * check for the walk itself: a walker that reaches nothing finds nothing
   * wrong, so callers assert this is plausibly large.
   */
  reached: string[];
}

export async function readPptx(bytes: Uint8Array): Promise<PptxRead> {
  const problems: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    return {
      problems: [`not a ZIP package: ${(error as Error).message}`],
      slides: [],
      reached: [],
    };
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const actualName = new Map(names.map((n) => [n.toLowerCase(), n]));

  // ── every XML part, well-formed ────────────────────────────────────────────
  const docs = new Map<string, Document>();
  for (const name of names) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const parsed = parse(await zip.file(name)!.async("string"));
    if (typeof parsed === "string")
      problems.push(`${name}: not well-formed XML — ${parsed}`);
    else docs.set(name, parsed);
  }

  // ── content types ──────────────────────────────────────────────────────────
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const types = docs.get("[Content_Types].xml");
  if (!types) problems.push("[Content_Types].xml is missing or unreadable");
  else {
    for (const d of all(types, CONTENT_TYPES, "Default"))
      defaults.set(
        (d.getAttribute("Extension") ?? "").toLowerCase(),
        d.getAttribute("ContentType") ?? "",
      );
    for (const o of all(types, CONTENT_TYPES, "Override"))
      overrides.set(
        (o.getAttribute("PartName") ?? "").replace(/^\//, "").toLowerCase(),
        o.getAttribute("ContentType") ?? "",
      );
  }
  const contentTypeOf = (part: string): string | undefined => {
    const ext = /\.([^./]+)$/.exec(part)?.[1]?.toLowerCase() ?? "";
    return overrides.get(part.toLowerCase()) ?? defaults.get(ext);
  };
  for (const name of names)
    if (name !== "[Content_Types].xml" && !contentTypeOf(name))
      problems.push(`${name}: no content type declared for it`);

  // ── relationships, every .rels in the package ──────────────────────────────
  const relCache = new Map<string, Map<string, Relationship>>();
  const relsOf = (part: string): Map<string, Relationship> => {
    const cached = relCache.get(part);
    if (cached) return cached;
    const map = new Map<string, Relationship>();
    relCache.set(part, map);
    const relsPart = relsPartOf(part);
    const doc = docs.get(relsPart);
    if (!doc) return map;
    for (const r of all(doc, PKG_REL, "Relationship")) {
      const id = r.getAttribute("Id") ?? "";
      const type = r.getAttribute("Type") ?? "";
      const rawTarget = r.getAttribute("Target") ?? "";
      const external = r.getAttribute("TargetMode") === "External";
      if (map.has(id)) problems.push(`${relsPart}: Id ${id} is used twice`);
      const target = external ? rawTarget : resolve(dirOf(part), rawTarget);
      map.set(id, { id, type, target, external });
      if (external) continue;
      const found = actualName.get(target.toLowerCase());
      if (!found) {
        problems.push(
          `${relsPart}: ${id} targets ${target}, which is not in the package`,
        );
        continue;
      }
      const want = TARGET_CONTENT_TYPE[type];
      const got = contentTypeOf(found);
      if (want && got !== want)
        problems.push(
          `${relsPart}: ${id} is a ${type.split("/").pop()} relationship, but ${found} is declared ${got ?? "with no content type"}`,
        );
      if (type === rel("image") && !got?.startsWith("image/"))
        problems.push(
          `${relsPart}: ${id} is an image relationship, but ${found} is declared ${got ?? "with no content type"}`,
        );
    }
    return map;
  };
  for (const name of names) {
    const source = sourceOfRels(name);
    if (source !== null) relsOf(source);
  }
  const ofType = (part: string, name: string) =>
    [...relsOf(part).values()].filter((r) => r.type === rel(name));

  // ── the walk PowerPoint makes ──────────────────────────────────────────────
  const reached = new Set<string>();
  const slides: string[][] = [];
  /** The root element of `part`, or null (with a problem) when it is not `ns:local`. */
  const rootOf = (part: string, ns: string, local: string): Element | null => {
    reached.add(part);
    const doc = docs.get(part);
    const root = doc?.documentElement;
    if (!root || !is(root, ns, local)) {
      problems.push(
        `${part}: expected a ${local} part, found ${root ? root.localName : "nothing readable"}`,
      );
      return null;
    }
    // Every r:id / r:embed / r:link on any element names a relationship this part has.
    const ids = relsOf(part);
    for (const el of Array.from(root.getElementsByTagName("*")))
      for (const attr of Array.from(el.attributes))
        if (attr.namespaceURI === ODOC_REL && !ids.has(attr.value))
          problems.push(
            `${part}: ${el.localName} r:${attr.localName}="${attr.value}" names no relationship`,
          );
    return root;
  };

  const officeDocuments = ofType("", "officeDocument");
  if (officeDocuments.length !== 1) {
    problems.push(
      `_rels/.rels: ${officeDocuments.length} officeDocument relationships, want exactly 1`,
    );
    return { problems, slides, reached: [...reached] };
  }
  const presentationPart = officeDocuments[0]!.target;
  const presentation = rootOf(presentationPart, PML, "presentation");
  if (!presentation) return { problems, slides, reached: [...reached] };

  const order = kids(presentation)
    .filter((c) => c.namespaceURI === PML)
    .map((c) => c.localName);
  const required = ["sldMasterIdLst", "sldSz", "notesSz"];
  for (const name of required)
    if (!order.includes(name))
      problems.push(`${presentationPart}: no p:${name}`);
  const sequence = ["sldMasterIdLst", "sldIdLst", "sldSz", "notesSz"]
    .map((name) => order.indexOf(name))
    .filter((i) => i >= 0);
  if (sequence.some((index, i) => i > 0 && index < sequence[i - 1]!))
    problems.push(
      `${presentationPart}: children out of schema order (${order.join(", ")})`,
    );
  const sldSz = child(presentation, PML, "sldSz");
  if (sldSz) {
    const [min, max] = SLIDE_SIZE_RANGE_EMU;
    for (const axis of ["cx", "cy"]) {
      const v = intAttr(sldSz, axis);
      if (v === null || v < min || v > max)
        problems.push(
          `${presentationPart}: sldSz ${axis}="${sldSz.getAttribute(axis)}" is outside ${min}–${max} EMU`,
        );
    }
  }
  const notesSz = child(presentation, PML, "notesSz");
  if (notesSz)
    for (const axis of ["cx", "cy"])
      if (!intAttr(notesSz, axis))
        problems.push(`${presentationPart}: notesSz ${axis} is not a size`);
  if (ofType(presentationPart, "theme").length === 0)
    problems.push(`${presentationPart}: no theme relationship`);

  const masterIds = new Set<number>();
  const takeMasterId = (part: string, el: Element, what: string) => {
    const id = intAttr(el, "id");
    if (id === null || id < FIRST_MASTER_ID)
      problems.push(
        `${part}: ${what} id="${el.getAttribute("id")}" is below ${FIRST_MASTER_ID}`,
      );
    else if (masterIds.has(id))
      problems.push(`${part}: ${what} id ${id} is not unique`);
    else masterIds.add(id);
  };
  const target = (part: string, el: Element, relName: string) => {
    const r = relsOf(part).get(el.getAttributeNS(ODOC_REL, "id") ?? "");
    if (!r || r.type !== rel(relName) || r.external) {
      problems.push(
        `${part}: ${el.localName} does not reference a ${relName} relationship`,
      );
      return null;
    }
    return actualName.get(r.target.toLowerCase()) ?? null;
  };

  // Masters first: a slide's layout must be one a master lists.
  const listedLayouts = new Map<string, string>(); // layout → its master
  const masterList = child(presentation, PML, "sldMasterIdLst");
  const masters = masterList ? all(masterList, PML, "sldMasterId") : [];
  if (masterList && masters.length === 0)
    problems.push(`${presentationPart}: sldMasterIdLst lists no master`);
  for (const entry of masters) {
    takeMasterId(presentationPart, entry, "sldMasterId");
    const masterPart = target(presentationPart, entry, "slideMaster");
    if (!masterPart || reached.has(masterPart)) continue;
    const master = rootOf(masterPart, PML, "sldMaster");
    if (!master) continue;
    shapeTreeProblems(masterPart, master, problems);
    if (!child(master, PML, "clrMap"))
      problems.push(`${masterPart}: no p:clrMap`);
    const themes = ofType(masterPart, "theme");
    if (themes.length !== 1)
      problems.push(
        `${masterPart}: ${themes.length} theme relationships, want exactly 1`,
      );
    for (const t of themes) {
      const themePart = actualName.get(t.target.toLowerCase());
      if (!themePart || reached.has(themePart)) continue;
      const theme = rootOf(themePart, DML, "theme");
      if (theme) themeProblems(themePart, theme, problems);
    }
    const layoutList = child(master, PML, "sldLayoutIdLst");
    const layouts = layoutList ? all(layoutList, PML, "sldLayoutId") : [];
    if (layouts.length === 0)
      problems.push(`${masterPart}: sldLayoutIdLst lists no layout`);
    for (const layoutEntry of layouts) {
      takeMasterId(masterPart, layoutEntry, "sldLayoutId");
      const layoutPart = target(masterPart, layoutEntry, "slideLayout");
      if (!layoutPart || listedLayouts.has(layoutPart)) continue;
      listedLayouts.set(layoutPart, masterPart);
      const layout = rootOf(layoutPart, PML, "sldLayout");
      if (!layout) continue;
      shapeTreeProblems(layoutPart, layout, problems);
      const back = ofType(layoutPart, "slideMaster");
      if (
        back.length !== 1 ||
        actualName.get(back[0]!.target.toLowerCase()) !== masterPart
      )
        problems.push(
          `${layoutPart}: must have exactly one slideMaster relationship, to ${masterPart}`,
        );
    }
  }

  const slideIds = new Set<number>();
  const slideList = child(presentation, PML, "sldIdLst");
  for (const entry of slideList ? all(slideList, PML, "sldId") : []) {
    const id = intAttr(entry, "id");
    if (id === null || id < 256 || id >= FIRST_MASTER_ID || slideIds.has(id))
      problems.push(
        `${presentationPart}: sldId id="${entry.getAttribute("id")}" is not a unique id in 256–2147483647`,
      );
    else slideIds.add(id);
    const slidePart = target(presentationPart, entry, "slide");
    if (!slidePart) continue;
    const slide = rootOf(slidePart, PML, "sld");
    if (!slide) continue;
    shapeTreeProblems(slidePart, slide, problems);
    for (const blip of all(slide, DML, "blip")) {
      const r = relsOf(slidePart).get(
        blip.getAttributeNS(ODOC_REL, "embed") ?? "",
      );
      if (!r || r.type !== rel("image"))
        problems.push(
          `${slidePart}: a:blip r:embed="${blip.getAttributeNS(ODOC_REL, "embed") ?? ""}" is not an image relationship`,
        );
    }
    const layouts = ofType(slidePart, "slideLayout");
    const layoutPart =
      layouts.length === 1
        ? actualName.get(layouts[0]!.target.toLowerCase())
        : undefined;
    if (layouts.length !== 1)
      problems.push(
        `${slidePart}: ${layouts.length} slideLayout relationships, want exactly 1`,
      );
    else if (!layoutPart || !listedLayouts.has(layoutPart))
      problems.push(
        `${slidePart}: its layout ${layouts[0]!.target} is not listed by any slide master`,
      );
    slides.push(
      all(slide, DML, "p").map((p) =>
        all(p, DML, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      ),
    );
  }

  // Five parts is the least a deck PowerPoint opens can have: presentation,
  // master, layout, theme and one slide. Fewer means the walk itself broke.
  if (reached.size < 5)
    problems.push(
      `the relationship walk reached only ${reached.size} part(s): ${[...reached].join(", ")}`,
    );
  return { problems, slides, reached: [...reached] };
}

/**
 * The deployment proof's verdict on a PDF to PowerPoint artifact: the deck
 * must pass `readPptx`, pass the package inspector the worker itself runs
 * (`./pptx-inspect`), and carry `wantText` on some slide. Lives here, not in
 * `scripts/worker-prove-tools.ts`, so the verdict the proof prints is the one
 * the unit tests pin — including against the deck PowerPoint refused.
 *
 * Both readers, because neither covers the other: the inspector has no model
 * of a shape tree or a theme, and `readPptx` never reads a content-type
 * override or a part nothing points at.
 */
export async function pptxProofVerdict(
  bytes: Uint8Array,
  wantText: string,
): Promise<{ ok: boolean; detail: string }> {
  const deck = await readPptx(bytes);
  if (deck.problems.length > 0)
    return {
      ok: false,
      detail: `PowerPoint cannot open this deck — ${deck.problems.length} problem(s): ${deck.problems.slice(0, 4).join("; ")}`,
    };
  // No `wellFormed` parser: every part already went through one above.
  const inspected = await inspectPptxPackage(bytes);
  if (inspected.problems.length > 0)
    return {
      ok: false,
      detail: `not a complete presentation — ${inspected.problems.length} problem(s): ${inspected.problems
        .slice(0, 4)
        .map((p) => `${p.check}: ${p.detail}`)
        .join("; ")}`,
    };
  const found = deck.slides.some((paragraphs) =>
    paragraphs.some((p) => p.includes(wantText)),
  );
  return found
    ? {
        ok: true,
        detail: `${deck.slides.length} slide(s), ${deck.reached.length} parts walked, fixture text found`,
      }
    : {
        ok: false,
        detail: `the deck's ${deck.slides.length} slide(s) carry no "${wantText}"`,
      };
}

/** Structure PowerPoint requires of a slide, layout or master's shapes. */
function shapeTreeProblems(part: string, root: Element, problems: string[]) {
  const cSld = child(root, PML, "cSld");
  if (!cSld || kids(root)[0] !== cSld) {
    problems.push(`${part}: p:cSld is missing or not first`);
    return;
  }
  const first = kids(cSld).filter((c) => !is(c, PML, "bg"))[0];
  if (!is(first, PML, "spTree"))
    problems.push(`${part}: p:cSld has no p:spTree`);
  const sequence = (el: Element, names: string[], what: string) => {
    const got = kids(el).map((c) => c.localName);
    if (names.some((name, i) => !is(kids(el)[i], PML, name)))
      problems.push(
        `${part}: ${what} holds [${got.join(", ")}], needs [${names.join(", ")}] first`,
      );
  };
  for (const tree of [...all(root, PML, "spTree"), ...all(root, PML, "grpSp")])
    sequence(tree, ["nvGrpSpPr", "grpSpPr"], tree.localName);
  for (const nv of all(root, PML, "nvGrpSpPr"))
    sequence(nv, ["cNvPr", "cNvGrpSpPr", "nvPr"], "nvGrpSpPr");
  for (const nv of all(root, PML, "nvSpPr"))
    sequence(nv, ["cNvPr", "cNvSpPr", "nvPr"], "nvSpPr");
  for (const sp of all(root, PML, "sp")) sequence(sp, ["nvSpPr", "spPr"], "sp");
  for (const pic of all(root, PML, "pic")) {
    sequence(pic, ["nvPicPr", "blipFill", "spPr"], "pic");
    const fill = child(pic, PML, "blipFill");
    if (fill && !is(kids(fill)[0], DML, "blip"))
      problems.push(`${part}: a p:blipFill does not start with a:blip`);
  }
  for (const nv of all(root, PML, "nvPicPr"))
    sequence(nv, ["cNvPr", "cNvPicPr", "nvPr"], "nvPicPr");
  // Only an xfrm's own off/ext: `a:ext` is also the element of every
  // extension list (`a:extLst`), which carries a uri and no size.
  for (const xfrm of all(root, DML, "xfrm")) {
    const off = child(xfrm, DML, "off");
    const ext = child(xfrm, DML, "ext");
    for (const axis of ["x", "y"])
      if (off && !/^-?\d+$/.test(off.getAttribute(axis) ?? ""))
        problems.push(
          `${part}: a:off ${axis}="${off.getAttribute(axis)}" is not a whole number`,
        );
    for (const axis of ["cx", "cy"])
      if (ext && !/^\d+$/.test(ext.getAttribute(axis) ?? ""))
        problems.push(
          `${part}: a:ext ${axis}="${ext.getAttribute(axis)}" is not a whole, non-negative number`,
        );
  }
  for (const c of all(root, PML, "cNvPr"))
    if (intAttr(c, "id") === null || !c.hasAttribute("name"))
      problems.push(`${part}: a cNvPr lacks a numeric id or a name`);
  for (const body of all(root, PML, "txBody")) {
    const children = kids(body);
    const rest = children.slice(is(children[1], DML, "lstStyle") ? 2 : 1);
    if (!is(children[0], DML, "bodyPr"))
      problems.push(`${part}: a txBody does not start with a:bodyPr`);
    if (rest.length === 0)
      problems.push(`${part}: a txBody holds no a:p — the schema needs one`);
    else if (!rest.every((c) => is(c, DML, "p")))
      problems.push(`${part}: a txBody holds something other than a:p`);
  }
}

/** A theme PowerPoint can resolve colours, fonts and fills from. */
function themeProblems(part: string, theme: Element, problems: string[]) {
  const elements = child(theme, DML, "themeElements");
  const clr = elements && child(elements, DML, "clrScheme");
  const font = elements && child(elements, DML, "fontScheme");
  const fmt = elements && child(elements, DML, "fmtScheme");
  if (!clr || kids(clr).length !== 12)
    problems.push(`${part}: clrScheme must hold the 12 scheme colours`);
  for (const face of ["majorFont", "minorFont"]) {
    const f = font && child(font, DML, face);
    if (!f || !["latin", "ea", "cs"].every((s) => child(f, DML, s)))
      problems.push(`${part}: fontScheme ${face} needs latin, ea and cs`);
  }
  for (const list of [
    "fillStyleLst",
    "lnStyleLst",
    "effectStyleLst",
    "bgFillStyleLst",
  ]) {
    const l = fmt && child(fmt, DML, list);
    if (!l || kids(l).length < 3)
      problems.push(`${part}: fmtScheme ${list} needs at least 3 entries`);
  }
}
