/**
 * Read a .docx's body as Word's schema shapes it — paragraphs and tables,
 * each run with its text and its formatting — and say what in it Word could
 * refuse or misread. For PDF to Word's check before delivery
 * (`./engine`, `undeliverableDocx`), its start-up probes (`./capability`) and
 * the deployment proof.
 *
 * ── WHY ITS OWN READER ───────────────────────────────────────────────────────
 *
 * `./docx-read` finds paragraphs with a flat `<w:p\b…</w:p>` pattern: a table
 * cell's paragraphs come out as body paragraphs, a run's formatting is not
 * read at all, and malformed XML can still yield "paragraphs". Once the
 * writer puts formatting on each run (since 2026-11-15) the questions the
 * engine has to ask before delivery are structural — is this element where
 * the schema allows it, is the text in these runs the text poppler read — so
 * this module WALKS the XML with a small tokenizer and builds the tree. It
 * imports nothing from the writer (`./docx-package`, `./docx-layout`) or the
 * other readers (`./docx-read`, `./docx-text`): a wrong writer cannot be
 * agreed with by its own inverse.
 *
 * ── WELL-FORMEDNESS AT RUNTIME, WITHOUT jsdom ───────────────────────────────
 *
 * The tokenizer refuses what an XML 1.0 parser refuses on the shapes a .docx
 * holds: an unbalanced or misnested tag, an unquoted or repeated attribute, a
 * bare `&` or unknown entity, a character XML cannot carry, an unbound
 * namespace prefix, a DOCTYPE, text outside the root. `./validate-ooxml`'s
 * `xmlProblems` uses jsdom, which is a DEV dependency the worker image does
 * not ship, so it cannot run here; the tests hold this tokenizer to it (every
 * corpus part agrees, and each malformed control is refused by both).
 *
 * It is not a schema validator. Each check below is one a real Word refusal
 * or misreading is behind, and each has a negative control in
 * `docx-structure.test.ts`.
 */
import JSZip from "jszip";

/* ------------------------------------------------------------------ *
 *  What it reads
 * ------------------------------------------------------------------ */

/** One `<w:r>`: its text (`<w:tab/>` read as a tab) and its `<w:rPr>`. */
export interface DocxReadRun {
  text: string;
  b?: true;
  bCs?: true;
  i?: true;
  iCs?: true;
  /** Half-points (`w:sz`), as written. */
  sz?: number;
  szCs?: number;
  /** "RRGGBB", as written. */
  color?: string;
  rtl?: true;
  /** `w:rFonts`'s `w:ascii`, when the run names a typeface. */
  fonts?: string;
  /** `w:rFonts`'s `w:hAnsi`, `w:cs` and `w:eastAsia`, each when written. */
  fontsHAnsi?: string;
  fontsCs?: string;
  fontsEastAsia?: string;
  /** Every other attribute `w:rFonts` carries (`w:asciiTheme`, `w:hint`…). */
  fontsOther?: string[];
}

export type DocxBodyBlock =
  | {
      kind: "p";
      runs: DocxReadRun[];
      /** It holds a `<w:drawing>`. */
      drawing: boolean;
      /** It holds a `<w:br w:type="page"/>`. */
      pageBreak: boolean;
    }
  | {
      kind: "tbl";
      gridCols: number[];
      rows: {
        cells: {
          span: number;
          blocks: DocxBodyBlock[];
          /** `w:tcW` in twips, when it is a dxa width (#28 slice 2). */
          width?: number;
        }[];
      }[];
      /** `w:tblW` in twips, when it is a dxa width. */
      width?: number;
      /** `w:tblBorders`, by side ("top", "insideV", …). */
      borders?: Record<string, DocxTableBorder>;
    };

/** One side of `w:tblBorders`: its style, width in eighths of a point, colour. */
export interface DocxTableBorder {
  val: string;
  sz: number;
  color: string;
}

/** A .docx's body, its package's parts and their declared content types. */
export interface DocxStructure {
  blocks: DocxBodyBlock[];
  parts: string[];
  contentTypes: {
    defaults: Record<string, string>;
    overrides: Record<string, string>;
  };
}

/* ------------------------------------------------------------------ *
 *  The tokenizer
 * ------------------------------------------------------------------ */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

/** Characters XML 1.0 cannot carry at all, escaped or not (U+FFFE, U+FFFF too). */
const XML_INVALID = new RegExp(
  `[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F${String.fromCharCode(0xfffe)}${String.fromCharCode(0xffff)}]`,
);
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** XML's end-of-line handling: CR LF and a lone CR read as LF. */
const eol = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * `text` as any XML part can carry it: without the characters XML 1.0
 * cannot hold (a writer must drop them) and with XML's end-of-line handling
 * applied (a reader must). The engine's text-conservation check compares
 * poppler's text through this against what {@link docxPageTexts} reads, so
 * the one difference XML itself forces is not called a lost word.
 */
export function asXmlCarries(text: string): string {
  return eol(
    text
      .replace(new RegExp(XML_INVALID.source, "g"), "")
      // A lone surrogate has no UTF-8 form: every encoder writes U+FFFD.
      .replace(LONE_SURROGATE, String.fromCharCode(0xfffd)),
  );
}
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function decodeEntities(raw: string, problems: string[]): string {
  return raw.replace(/&([^;&\s]*);?/g, (whole, name: string) => {
    if (!whole.endsWith(";")) {
      problems.push(`a bare "&" in the text`);
      return whole;
    }
    if (name in ENTITY) return ENTITY[name]!;
    const ref = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(name);
    if (!ref) {
      problems.push(`an unknown entity &${name};`);
      return whole;
    }
    const code = ref[1] !== undefined ? parseInt(ref[1], 16) : Number(ref[2]);
    const ok =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!ok) {
      problems.push(`a character reference XML cannot carry (&${name};)`);
      return "";
    }
    return String.fromCodePoint(code);
  });
}

/**
 * Parse `xml` into its root element, collecting every well-formedness problem
 * found on the way. The root is null only when nothing could be built.
 */
export function parseXml(xml: string): {
  root: XmlElement | null;
  problems: string[];
} {
  const problems: string[] = [];
  if (XML_INVALID.test(xml)) problems.push("a character XML cannot carry");
  const stack: { el: XmlElement; ns: Map<string, string> }[] = [];
  let root: XmlElement | null = null;
  let closed = false;
  let i = 0;
  const n = xml.length;
  const text = (raw: string) => {
    if (raw.length === 0) return;
    const top = stack[stack.length - 1];
    if (!top) {
      if (raw.trim()) problems.push("text outside the root element");
      return;
    }
    if (raw.includes("]]>")) problems.push(`"]]>" in text`);
    const value = eol(decodeEntities(raw, problems));
    const last = top.el.children[top.el.children.length - 1];
    if (typeof last === "string")
      top.el.children[top.el.children.length - 1] = last + value;
    else top.el.children.push(value);
  };
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      text(xml.slice(i));
      break;
    }
    text(xml.slice(i, lt));
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) {
        problems.push("an unterminated processing instruction");
        break;
      }
      if (lt !== 0 && /^<\?xml[\s?]/.test(xml.slice(lt, lt + 6)))
        problems.push("an XML declaration that is not at the start");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) {
        problems.push("an unterminated comment");
        break;
      }
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) {
        problems.push("an unterminated CDATA section");
        break;
      }
      const top = stack[stack.length - 1];
      if (!top) problems.push("CDATA outside the root element");
      else top.el.children.push(eol(xml.slice(lt + 9, end)));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      problems.push("a DOCTYPE or declaration (a .docx part has none)");
      const end = xml.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // A tag. Find its end outside quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < n; j++) {
      const c = xml[j]!;
      if (quote) {
        if (c === quote) quote = "";
        else if (c === "<") break;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">" || c === "<") break;
    }
    if (j >= n || xml[j] !== ">") {
      problems.push("an unterminated tag");
      break;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top) {
        problems.push(`a closing </${name}> with nothing open`);
        continue;
      }
      if (top.el.name !== name)
        problems.push(`</${name}> closes <${top.el.name}>`);
      if (stack.length === 0) closed = true;
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^[^\s/>]+/.exec(inner);
    const name = nameMatch?.[0] ?? "";
    if (!NAME.test(name)) problems.push(`an element named "${name}"`);
    const attrs: Record<string, string> = {};
    let rest = inner.slice(name.length);
    const ATTR = /^\s+([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
    for (;;) {
      if (rest.trim() === "") break;
      const m = ATTR.exec(rest);
      if (!m) {
        problems.push(`a malformed attribute on <${name}>`);
        break;
      }
      const key = m[1]!;
      if (!NAME.test(key)) problems.push(`an attribute named "${key}"`);
      if (key in attrs) problems.push(`a repeated attribute ${key}`);
      const raw = m[2] ?? m[3] ?? "";
      if (raw.includes("<")) problems.push(`"<" in an attribute value`);
      // Attribute-value normalisation: whitespace characters read as spaces.
      attrs[key] = decodeEntities(raw, problems).replace(/[\t\n\r]/g, " ");
      rest = rest.slice(m[0].length);
    }
    if (root && stack.length === 0) {
      problems.push(closed ? "a second root element" : "content after root");
    }
    const parentNs = stack[stack.length - 1]?.ns;
    const ns = new Map(parentNs ?? [["xml", "xml"]]);
    for (const [k, v] of Object.entries(attrs))
      if (k.startsWith("xmlns:")) ns.set(k.slice(6), v);
    const bound = (qname: string) => {
      const colon = qname.indexOf(":");
      if (colon < 0) return true;
      const prefix = qname.slice(0, colon);
      return prefix === "xmlns" || ns.has(prefix);
    };
    if (!bound(name)) problems.push(`an unbound prefix on <${name}>`);
    for (const k of Object.keys(attrs))
      if (!bound(k)) problems.push(`an unbound prefix on ${k}`);
    const el: XmlElement = { name, attrs, children: [] };
    const top = stack[stack.length - 1];
    if (top) top.el.children.push(el);
    else root ??= el;
    if (selfClosing) {
      if (stack.length === 0) closed = true;
    } else stack.push({ el, ns });
  }
  if (stack.length > 0)
    problems.push(`<${stack[stack.length - 1]!.el.name}> is never closed`);
  if (!root) problems.push("no root element");
  return { root, problems: [...new Set(problems)] };
}

const elements = (el: XmlElement) =>
  el.children.filter((c): c is XmlElement => typeof c !== "string");
const childNamed = (el: XmlElement, name: string) =>
  elements(el).find((c) => c.name === name);
const textOf = (el: XmlElement): string =>
  el.children.map((c) => (typeof c === "string" ? c : "")).join("");

/* ------------------------------------------------------------------ *
 *  The body
 * ------------------------------------------------------------------ */

/** `CT_RPr`'s children, in the schema's sequence (ECMA-376 §17.3.2.28). */
export const RPR_ORDER = [
  "w:rStyle",
  "w:rFonts",
  "w:b",
  "w:bCs",
  "w:i",
  "w:iCs",
  "w:caps",
  "w:smallCaps",
  "w:strike",
  "w:dstrike",
  "w:outline",
  "w:shadow",
  "w:emboss",
  "w:imprint",
  "w:noProof",
  "w:snapToGrid",
  "w:vanish",
  "w:webHidden",
  "w:color",
  "w:spacing",
  "w:w",
  "w:kern",
  "w:position",
  "w:sz",
  "w:szCs",
  "w:highlight",
  "w:u",
  "w:effect",
  "w:bdr",
  "w:shd",
  "w:fitText",
  "w:vertAlign",
  "w:rtl",
  "w:cs",
  "w:em",
  "w:lang",
  "w:eastAsianLayout",
  "w:specVanish",
  "w:oMath",
  "w:rPrChange",
] as const;
const RPR_RANK = new Map<string, number>(RPR_ORDER.map((n, k) => [n, k]));

/** `w:sz` / `w:szCs` (`ST_HpsMeasure`): Word's 1 to 1,638 points, in half-points. */
export const HALF_POINTS_RANGE = [2, 3276] as const;
/** Word's limit on a table's grid columns. */
export const MAX_GRID_COLUMNS = 63;

/** A toggle property is on unless its `w:val` says off. */
const on = (el: XmlElement | undefined) =>
  el !== undefined && !/^(?:0|false|off)$/.test(el.attrs["w:val"] ?? "");

function readRun(r: XmlElement, problems: string[], into: ParaState): void {
  const run: DocxReadRun = { text: "" };
  for (const c of elements(r)) {
    switch (c.name) {
      case "w:rPr": {
        let rank = -1;
        for (const p of elements(c)) {
          const k = RPR_RANK.get(p.name);
          if (k === undefined) problems.push(`<${p.name}> inside <w:rPr>`);
          else if (k <= rank)
            problems.push(
              `<w:rPr> children out of schema order at <${p.name}>`,
            );
          else rank = k;
        }
        const get = (name: string) => childNamed(c, name);
        if (on(get("w:b"))) run.b = true;
        if (on(get("w:bCs"))) run.bCs = true;
        if (on(get("w:i"))) run.i = true;
        if (on(get("w:iCs"))) run.iCs = true;
        if (on(get("w:rtl"))) run.rtl = true;
        for (const key of ["sz", "szCs"] as const) {
          const el = get(`w:${key}`);
          if (!el) continue;
          const raw = el.attrs["w:val"] ?? "";
          const v = Number(raw);
          if (
            !/^\d+$/.test(raw) ||
            v < HALF_POINTS_RANGE[0] ||
            v > HALF_POINTS_RANGE[1]
          )
            problems.push(`w:${key} "${raw}" is not a size Word accepts`);
          else run[key] = v;
        }
        const color = get("w:color");
        if (color) {
          const raw = color.attrs["w:val"] ?? "";
          if (!/^[0-9A-F]{6}$/.test(raw))
            problems.push(`w:color "${raw}" is not RRGGBB`);
          else run.color = raw;
        }
        const fonts = get("w:rFonts");
        if (fonts) {
          run.fonts = fonts.attrs["w:ascii"] ?? "";
          const a = fonts.attrs;
          if (a["w:hAnsi"] !== undefined) run.fontsHAnsi = a["w:hAnsi"];
          if (a["w:cs"] !== undefined) run.fontsCs = a["w:cs"];
          if (a["w:eastAsia"] !== undefined)
            run.fontsEastAsia = a["w:eastAsia"];
          const other = Object.keys(a).filter(
            (k) => !["w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"].includes(k),
          );
          if (other.length > 0) run.fontsOther = other;
        }
        break;
      }
      case "w:t":
        run.text += textOf(c);
        break;
      case "w:tab":
        run.text += "\t";
        break;
      case "w:br":
        if (c.attrs["w:type"] === "page") into.pageBreak = true;
        break;
      case "w:drawing":
        into.drawing = true;
        break;
      default:
        break;
    }
  }
  into.runs.push(run);
}

interface ParaState {
  runs: DocxReadRun[];
  drawing: boolean;
  pageBreak: boolean;
}

function readParagraph(p: XmlElement, problems: string[]): DocxBodyBlock {
  const state: ParaState = { runs: [], drawing: false, pageBreak: false };
  const walk = (el: XmlElement) => {
    for (const c of elements(el)) {
      if (c.name === "w:r") readRun(c, problems, state);
      // Runs Word nests: a hyperlink's, a field's, a tracked insertion's.
      else if (
        /^w:(?:hyperlink|fldSimple|ins|smartTag|sdtContent|sdt)$/.test(c.name)
      )
        walk(c);
    }
  };
  walk(p);
  return { kind: "p", ...state };
}

function readBlocks(
  container: XmlElement,
  problems: string[],
  where: string,
): DocxBodyBlock[] {
  const out: DocxBodyBlock[] = [];
  const kids = elements(container);
  kids.forEach((c, k) => {
    if (c.name === "w:p") out.push(readParagraph(c, problems));
    else if (c.name === "w:tbl") {
      const next = kids[k + 1];
      if (next?.name === "w:tbl")
        problems.push(`two tables side by side in ${where}`);
      if (!next || next.name === "w:sectPr")
        problems.push(`a table with no paragraph after it in ${where}`);
      out.push(readTable(c, problems));
    }
  });
  return out;
}

/** Children of `el` known to `rank` and in its order; problems otherwise. */
function inOrder(
  el: XmlElement,
  rank: ReadonlyMap<string, number>,
  problems: string[],
): void {
  let at = -1;
  for (const p of elements(el)) {
    const k = rank.get(p.name);
    if (k === undefined) problems.push(`<${p.name}> inside <${el.name}>`);
    else if (k <= at)
      problems.push(`<${el.name}> children out of schema order at <${p.name}>`);
    else at = k;
  }
}

const rankOf = (names: readonly string[]) =>
  new Map<string, number>(names.map((n, k) => [n, k]));

/** `CT_TblPr`'s children, in the schema's sequence (ECMA-376 §17.4.60). */
export const TBLPR_ORDER = [
  "w:tblStyle",
  "w:tblpPr",
  "w:tblOverlap",
  "w:bidiVisual",
  "w:tblStyleRowBandSize",
  "w:tblStyleColBandSize",
  "w:tblW",
  "w:jc",
  "w:tblCellSpacing",
  "w:tblInd",
  "w:tblBorders",
  "w:shd",
  "w:tblLayout",
  "w:tblCellMar",
  "w:tblLook",
  "w:tblCaption",
  "w:tblDescription",
  "w:tblPrChange",
] as const;
/** `CT_TcPr`'s children, in the schema's sequence (ECMA-376 §17.4.70). */
export const TCPR_ORDER = [
  "w:cnfStyle",
  "w:tcW",
  "w:gridSpan",
  "w:hMerge",
  "w:vMerge",
  "w:tcBorders",
  "w:shd",
  "w:noWrap",
  "w:tcMar",
  "w:textDirection",
  "w:tcFitText",
  "w:vAlign",
  "w:hideMark",
  "w:tcPrChange",
] as const;
/** `CT_TblBorders`'s children (start/end are left/right's later names). */
const BORDER_RANK = new Map<string, number>([
  ["w:top", 0],
  ["w:left", 1],
  ["w:start", 1],
  ["w:bottom", 2],
  ["w:right", 3],
  ["w:end", 3],
  ["w:insideH", 4],
  ["w:insideV", 5],
]);
const TBLPR_RANK = rankOf(TBLPR_ORDER);
const TCPR_RANK = rankOf(TCPR_ORDER);
/** `w:sz` of a border: eighths of a point, 2 to 96 (Word's ¼ to 12 points). */
export const BORDER_EIGHTHS_RANGE = [2, 96] as const;

/** A whole number of at least 1, or a problem naming `what`. */
function wholeAtLeastOne(
  raw: string | undefined,
  what: string,
  problems: string[],
): number | null {
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
    problems.push(`${what} "${raw ?? ""}" is not a whole number of at least 1`);
    return null;
  }
  return Number(raw);
}

/** A `w:tblW` / `w:tcW` (`CT_TblWidth`): its type and, for dxa, twips. */
function readWidth(
  el: XmlElement | undefined,
  what: string,
  problems: string[],
): number | undefined {
  if (!el) return undefined;
  const type = el.attrs["w:type"] ?? "dxa";
  const raw = el.attrs["w:w"] ?? "0";
  if (!/^(?:dxa|auto|pct|nil)$/.test(type))
    problems.push(`${what} type "${type}" is not one Word reads`);
  if (!/^-?\d+$/.test(raw)) {
    problems.push(`${what} w "${raw}" is not a whole number`);
    return undefined;
  }
  return type === "dxa" ? Number(raw) : undefined;
}

function readBorders(
  el: XmlElement | undefined,
  problems: string[],
): Record<string, DocxTableBorder> | undefined {
  if (!el) return undefined;
  inOrder(el, BORDER_RANK, problems);
  const out: Record<string, DocxTableBorder> = {};
  for (const b of elements(el)) {
    const side = b.name.replace(/^w:/, "");
    const val = b.attrs["w:val"] ?? "";
    const sz = b.attrs["w:sz"] ?? "";
    const color = b.attrs["w:color"] ?? "";
    if (!/^(?:single|nil|none)$/.test(val))
      problems.push(`border ${side} val "${val}" is not single, nil or none`);
    if (
      val === "single" &&
      (!/^\d+$/.test(sz) ||
        Number(sz) < BORDER_EIGHTHS_RANGE[0] ||
        Number(sz) > BORDER_EIGHTHS_RANGE[1])
    )
      problems.push(`border ${side} sz "${sz}" is not a width Word accepts`);
    if (color !== "" && !/^(?:[0-9A-F]{6}|auto)$/.test(color))
      problems.push(`border ${side} color "${color}" is not RRGGBB`);
    out[side] = { val, sz: Number(sz), color };
  }
  return out;
}

function readTable(tbl: XmlElement, problems: string[]): DocxBodyBlock {
  const grid = childNamed(tbl, "w:tblGrid");
  const gridCols = grid
    ? elements(grid)
        .filter((g) => g.name === "w:gridCol")
        .map((g) => {
          // A grid column must be a whole number of twips, at least 1
          // (#28 slice 2): until then Number() of garbage read as NaN.
          const raw = g.attrs["w:w"];
          if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1)
            problems.push(
              `w:gridCol w:w "${raw ?? ""}" is not a whole number of at least 1`,
            );
          return Number(raw ?? 0);
        })
    : [];
  if (gridCols.length === 0) problems.push("a table with no grid columns");
  if (gridCols.length > MAX_GRID_COLUMNS)
    problems.push(
      `a table of ${gridCols.length} grid columns (Word's limit is ${MAX_GRID_COLUMNS})`,
    );
  const gridSum = gridCols.reduce((s, w) => s + w, 0);
  const tblPr = childNamed(tbl, "w:tblPr");
  let width: number | undefined;
  let borders: Record<string, DocxTableBorder> | undefined;
  if (tblPr) {
    inOrder(tblPr, TBLPR_RANK, problems);
    width = readWidth(childNamed(tblPr, "w:tblW"), "w:tblW", problems);
    if (width !== undefined && width !== gridSum)
      problems.push(`w:tblW ${width} is not its grid's ${gridSum}`);
    borders = readBorders(childNamed(tblPr, "w:tblBorders"), problems);
  }
  const rows = elements(tbl)
    .filter((r) => r.name === "w:tr")
    .map((tr, rowIndex) => {
      let at = 0;
      const cells = elements(tr)
        .filter((c) => c.name === "w:tc")
        .map((tc) => {
          const tcPr = childNamed(tc, "w:tcPr");
          if (tcPr) inOrder(tcPr, TCPR_RANK, problems);
          const spanEl = tcPr ? childNamed(tcPr, "w:gridSpan") : undefined;
          const span = spanEl
            ? (wholeAtLeastOne(spanEl.attrs["w:val"], "w:gridSpan", problems) ??
              1)
            : 1;
          const cellWidth = readWidth(
            tcPr ? childNamed(tcPr, "w:tcW") : undefined,
            "w:tcW",
            problems,
          );
          if (cellWidth !== undefined) {
            let spanned = 0;
            for (let k = at; k < at + span && k < gridCols.length; k++)
              spanned += gridCols[k]!;
            if (cellWidth !== spanned)
              problems.push(
                `w:tcW ${cellWidth} is not its grid columns' ${spanned} (row ${rowIndex + 1})`,
              );
          }
          at += span;
          if (!elements(tc).some((c) => c.name === "w:p"))
            problems.push(
              `a table cell with no paragraph (row ${rowIndex + 1})`,
            );
          return {
            span,
            blocks: readBlocks(tc, problems, "a table cell"),
            ...(cellWidth !== undefined ? { width: cellWidth } : {}),
          };
        });
      const spanned = cells.reduce((s, c) => s + c.span, 0);
      if (spanned !== gridCols.length)
        problems.push(
          `row ${rowIndex + 1} spans ${spanned} of ${gridCols.length} grid columns`,
        );
      return { cells };
    });
  return {
    kind: "tbl",
    gridCols,
    rows,
    ...(width !== undefined ? { width } : {}),
    ...(borders ? { borders } : {}),
  };
}

/** The relationship parts in a package, and their (resolved) internal targets. */
function relTargets(relsPath: string, xml: string): string[] {
  const m = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(relsPath);
  const base = m?.[1] ?? "";
  const { root } = parseXml(xml);
  if (!root) return [];
  return elements(root)
    .filter(
      (r) => r.name === "Relationship" && r.attrs.TargetMode !== "External",
    )
    .map((r) => {
      const target = r.attrs.Target ?? "";
      const segments = target.startsWith("/")
        ? []
        : base.split("/").filter(Boolean);
      for (const seg of target.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") segments.pop();
        else segments.push(seg);
      }
      return segments.join("/");
    });
}

interface Package {
  zip: JSZip;
  parts: string[];
  document: string;
}

async function openPackage(bytes: Uint8Array): Promise<Package> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const document = await zip.file("word/document.xml")?.async("string");
  if (document === undefined)
    throw new Error("the DOCX has no word/document.xml");
  return { zip, parts, document };
}

async function contentTypesOf(
  zip: JSZip,
  problems: string[],
): Promise<DocxStructure["contentTypes"]> {
  const out: DocxStructure["contentTypes"] = { defaults: {}, overrides: {} };
  const xml = await zip.file("[Content_Types].xml")?.async("string");
  if (xml === undefined) {
    problems.push("no [Content_Types].xml");
    return out;
  }
  const parsed = parseXml(xml);
  for (const p of parsed.problems) problems.push(`[Content_Types].xml: ${p}`);
  for (const c of parsed.root ? elements(parsed.root) : []) {
    if (c.name === "Default" && c.attrs.Extension)
      out.defaults[c.attrs.Extension.toLowerCase()] = c.attrs.ContentType ?? "";
    if (c.name === "Override" && c.attrs.PartName)
      out.overrides[c.attrs.PartName.replace(/^\//, "")] =
        c.attrs.ContentType ?? "";
  }
  return out;
}

function bodyOf(document: string, problems: string[]): DocxBodyBlock[] {
  const parsed = parseXml(document);
  for (const p of parsed.problems) problems.push(`word/document.xml: ${p}`);
  const body = parsed.root ? childNamed(parsed.root, "w:body") : undefined;
  if (!body) {
    problems.push("word/document.xml has no <w:body>");
    return [];
  }
  return readBlocks(body, problems, "the body");
}

/**
 * Read a .docx's body: paragraphs and tables in order, each run with its
 * text and formatting, and the package's parts and content types. Throws
 * when the file is not a ZIP or has no `word/document.xml`; malformed XML is
 * read as far as it goes ({@link docxStructureProblems} says what is wrong).
 */
export async function readDocxStructure(
  bytes: Uint8Array,
): Promise<DocxStructure> {
  const pkg = await openPackage(bytes);
  const ignored: string[] = [];
  return {
    blocks: bodyOf(pkg.document, ignored),
    parts: pkg.parts,
    contentTypes: await contentTypesOf(pkg.zip, ignored),
  };
}

/**
 * Everything in the .docx that Word could refuse or misread, as far as these
 * checks see; empty when none:
 *   - every part listed here is well-formed XML (`word/document.xml`,
 *     `[Content_Types].xml`, every `.rels`);
 *   - every table cell holds a paragraph; every row spans the grid; the grid
 *     has at most {@link MAX_GRID_COLUMNS} columns; no table is followed
 *     directly by the section or by another table;
 *   - (since #28 slice 2) every `w:gridCol` width and `w:gridSpan` is a
 *     whole number of at least 1; `w:tblPr` and `w:tcPr` children are known
 *     and in schema order ({@link TBLPR_ORDER}, {@link TCPR_ORDER}); a
 *     `w:tcW`/`w:tblW` has a type Word reads and a whole width, and a dxa
 *     one equals the grid columns it covers; `w:tblBorders` sides are in
 *     order, each single/nil/none, {@link BORDER_EIGHTHS_RANGE} wide, RRGGBB;
 *   - every `w:sz`/`w:szCs` is a whole number in {@link HALF_POINTS_RANGE},
 *     every `w:color` six upper-case hex digits;
 *   - each `w:rPr`'s children are known and in `CT_RPr`'s order;
 *   - every part a relationship names exists and has a content type.
 */
export async function docxStructureProblems(
  bytes: Uint8Array,
): Promise<string[]> {
  return (await inspectDocxStructure(bytes)).problems;
}

/**
 * {@link readDocxStructure} and {@link docxStructureProblems} from ONE parse
 * of the package — the engine's check before delivery reads both, and a
 * 500-page document's body parsed twice took 340 ms (measured 2026-11-15,
 * `docx-run-style-measure.ts engine 500`). `structure` is null when the file
 * is not a readable package.
 */
export async function inspectDocxStructure(bytes: Uint8Array): Promise<{
  structure: DocxStructure | null;
  problems: string[];
}> {
  const problems: string[] = [];
  let pkg: Package;
  try {
    pkg = await openPackage(bytes);
  } catch (error) {
    return {
      structure: null,
      problems: [`not a readable DOCX: ${(error as Error).message}`],
    };
  }
  const blocks = bodyOf(pkg.document, problems);
  const types = await contentTypesOf(pkg.zip, problems);
  const present = new Set(pkg.parts);
  for (const rels of pkg.parts.filter((p) => p.endsWith(".rels"))) {
    const xml = await pkg.zip.file(rels)!.async("string");
    const parsed = parseXml(xml);
    for (const p of parsed.problems) problems.push(`${rels}: ${p}`);
    for (const target of relTargets(rels, xml)) {
      if (!present.has(target))
        problems.push(`${rels} names ${target}, which is not in the package`);
      const ext = target.split(".").pop()?.toLowerCase() ?? "";
      if (!(target in types.overrides) && !(ext in types.defaults))
        problems.push(`${target} has no content type`);
    }
  }
  return {
    structure: { blocks, parts: pkg.parts, contentTypes: types },
    problems: [...new Set(problems)],
  };
}

/**
 * The text a reader of the .docx sees, page by page: the body split at each
 * page-break paragraph; within a page each paragraph's runs joined, and the
 * paragraphs joined by "\n". A paragraph holding only a picture (or nothing
 * but the break) adds no line. A table row reads as its cells joined by
 * tabs. A body with nothing in it has no pages. This is the read-back side
 * of the engine's text-conservation check: it must equal poppler's
 * `flowPageText` for every page the document holds.
 *
 * Since #28 slice 2 (2026-11-15), when PDF to Word began writing real Word
 * tables, two rules more — each STRUCTURAL, never by text:
 *   - an EMPTY SLOT, a cell whose paragraphs hold no run at all, adds no
 *     cell to its row's line: a row reads as its other cells, in column
 *     order, joined by tabs — poppler's row, which never had a value there.
 *     A cell whose run has EMPTY text (made only of characters XML cannot
 *     carry, which the writer drops) is not an empty slot and keeps its tab;
 *   - a body paragraph with no run at all (the separator after a table)
 *     adds no line. A real paragraph emptied of its runs' text still does,
 *     so a lost word is still a difference.
 * What this cannot see: a writer that drops the empty slots and shifts the
 * values left reads back as the same text. The start-up probe
 * (`provesDocxTables`) and the flow's placement guard see placement.
 */
export function docxPageTexts(body: Pick<DocxStructure, "blocks">): string[] {
  if (body.blocks.length === 0) return [];
  const pages: string[][] = [[]];
  const paragraphText = (p: Extract<DocxBodyBlock, { kind: "p" }>) =>
    p.runs.map((r) => r.text).join("");
  const emptySlot = (blocks: DocxBodyBlock[]) =>
    blocks.every((b) => b.kind === "p" && b.runs.length === 0);
  const rowText = (
    row: Extract<DocxBodyBlock, { kind: "tbl" }>["rows"][number],
  ) =>
    row.cells
      .filter((c) => !emptySlot(c.blocks))
      .map((c) => cellText(c.blocks))
      .join("\t");
  const cellText = (blocks: DocxBodyBlock[]): string =>
    blocks
      .map((b) =>
        b.kind === "p" ? paragraphText(b) : b.rows.map(rowText).join("\n"),
      )
      .join("\n");
  for (const block of body.blocks) {
    const page = pages[pages.length - 1]!;
    if (block.kind === "tbl") {
      for (const row of block.rows) page.push(rowText(row));
      continue;
    }
    const text = paragraphText(block);
    if (!(
      text === "" &&
      (block.drawing || block.pageBreak || block.runs.length === 0)
    ))
      page.push(text);
    if (block.pageBreak) pages.push([]);
  }
  return pages.map((lines) => lines.join("\n"));
}
