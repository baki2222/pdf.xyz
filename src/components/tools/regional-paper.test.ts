// @vitest-environment node
/**
 * Audit backlog #5 (2026-11-16): every control that offers a page size starts
 * on the browser region's paper — A4, or US Letter in a Letter country — until
 * the person picks one. JPG/PNG to PDF did since 2026-11-07; Text to PDF had
 * no size at all, HTML and Webpage to PDF started on "As the page sets it"
 * (Letter, for a page that names none), and Scan, Resize, Multiple Pages per
 * Sheet and Booklet started everyone on A4.
 *
 * The controls are DISCOVERED, not listed: every component that draws a
 * page-size table, where a page-size table is any array a component imports
 * from a module under @/lib and `.map`s whose entries include both an A4 and a Letter
 * id — decided by importing the module and reading the VALUE, so a new table
 * under a new name is found by its shape. The property each must hold: the
 * control, or a component that imports it (where its state lives), starts the
 * value on `regionalChoice(<that table>, …)` — the one function that maps
 * `useRegionalPaper()` onto a table — or on `imagePageSizeForLocales(` itself.
 *
 * WHAT THIS DOES NOT SEE: whether the regional value is the value the state
 * actually starts on (a call that is made and then ignored passes). That is
 * held by the DOM tests of the two server-rendered panels
 * (`regional-paper.dom.test.tsx`) and by e2e
 * (`e2e/regional-paper.spec.ts`); the four client-only editors are held here
 * and by reading.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imagePageSizeForLocales } from "@/lib/pdf/image-page-defaults";
import { browserLocales, regionalChoice } from "./use-regional-paper";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(full);
  }
  return out;
}

interface Import {
  names: string[];
  from: string;
}

/** Value imports (never `import type`, never a `type X` member). */
function importsOf(source: string): Import[] {
  const out: Import[] = [];
  for (const m of source.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g,
  )) {
    if (m[1]) continue;
    const names = m[2]!
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) =>
        n
          .split(/\s+as\s+/)
          .pop()!
          .trim(),
      );
    out.push({ names, from: m[3]! });
  }
  return out;
}

/** A page-size table: entries with string ids, an A4 and a Letter among them. */
function isPageSizeTable(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = value
    .map((e) =>
      e && typeof e === "object" ? (e as { id?: unknown }).id : null,
    )
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.toLowerCase());
  return ids.includes("a4") && ids.includes("letter");
}

interface Control {
  file: string;
  table: string;
}

type Loader = (specifier: string) => Promise<Record<string, unknown>>;

/** Every (component, table) pair where the component draws the table. */
async function discoverControls(
  files: Record<string, string>,
  load: Loader,
): Promise<Control[]> {
  const controls: Control[] = [];
  for (const [file, source] of Object.entries(files)) {
    for (const imp of importsOf(source)) {
      if (!imp.from.startsWith("@/lib/")) continue;
      const mapped = imp.names.filter((n) =>
        new RegExp(`\\b${n}\\.map\\(`).test(source),
      );
      if (mapped.length === 0) continue;
      const mod = await load(imp.from);
      for (const n of mapped) {
        if (!(n in mod))
          throw new Error(`${file}: "${n}" is not exported by ${imp.from}`);
        if (isPageSizeTable(mod[n])) controls.push({ file, table: n });
      }
    }
  }
  return controls;
}

/** The file a relative or `@/` specifier names, if it is one of `files`. */
function resolveIn(
  files: Record<string, string>,
  from: string,
  specifier: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(path.resolve(ROOT, ".."), specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"])
    if (files[base + ext] !== undefined) return base + ext;
  return null;
}

/** The control and every component that imports it: where its state can live. */
function ownersOf(files: Record<string, string>, control: string): string[] {
  const owners = [control];
  for (const [file, source] of Object.entries(files))
    if (
      importsOf(source).some((i) => resolveIn(files, file, i.from) === control)
    )
      owners.push(file);
  return owners;
}

function startsRegional(files: Record<string, string>, c: Control): boolean {
  return ownersOf(files, c.file).some((owner) => {
    const src = files[owner]!;
    return (
      new RegExp(`\\bregionalChoice\\(\\s*${c.table}\\b`).test(src) ||
      (owner === c.file && /\bimagePageSizeForLocales\(/.test(src))
    );
  });
}

/**
 * Controls whose start is NOT the regional paper, each with why. Held in
 * both directions below: each must still be discovered and must still not
 * start regional, so a fix has to delete its line.
 */
const NOT_REGIONAL: Record<string, string> = {
  "tools/epub-layout-options.tsx:EPUB_PAGE_SIZES":
    "A5 on purpose: a book's page, about a paperback, so lines run at a book's length (DEFAULT_EPUB_RENDER_OPTIONS); not a region's office paper.",
};

const key = (c: Control) =>
  `${path.relative(ROOT, c.file).split(path.sep).join("/")}:${c.table}`;

const realFiles = Object.fromEntries(
  walk(ROOT).map((f) => [f, readFileSync(f, "utf8")]),
);
const realLoad: Loader = (specifier) =>
  import(/* @vite-ignore */ specifier) as Promise<Record<string, unknown>>;

describe("every page-size control starts on the regional paper", () => {
  it("discovers the controls (health: a plausible number, known members present)", async () => {
    const controls = await discoverControls(realFiles, realLoad);
    const keys = controls.map(key).sort();
    console.log(`[regional-paper] controls:\n  ${keys.join("\n  ")}`);
    expect(Object.keys(realFiles).length).toBeGreaterThan(200);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys.length).toBeLessThan(30);
    for (const known of [
      "tools/runner/text-page-setup.tsx:TEXT_PAGE_SIZES",
      "tools/html-render-layout-options.tsx:HTML_PAGE_SIZES",
      "tools/runner/image-to-pdf-runner.tsx:IMAGE_PAGE_SIZES",
      "tools/runner/scan-runner.tsx:SCAN_PAGE_SIZES",
    ])
      expect(keys).toContain(known);
  });

  it("each one, or the component holding its state, starts on regionalChoice", async () => {
    const controls = await discoverControls(realFiles, realLoad);
    const failing = controls
      .filter((c) => !startsRegional(realFiles, c))
      .map(key)
      .sort();
    expect(failing).toEqual(Object.keys(NOT_REGIONAL).sort());
  });

  it("POSITIVE CONTROL: a control that starts on a fixed size is caught, and the fix clears it", async () => {
    const file = path.join(ROOT, "tools", "fake-control.tsx");
    const fixed = (start: string) => ({
      [file]: `import { useState } from "react";
import { IMAGE_PAGE_SIZES } from "@/lib/pdf/image-page-layout";
import { regionalChoice, useRegionalPaper } from "./use-regional-paper";
export function Fake() {
  const [size] = useState(${start});
  return IMAGE_PAGE_SIZES.map((s) => s.id === size);
}`,
    });
    const bad = fixed(`"a4"`);
    const badControls = await discoverControls(bad, realLoad);
    expect(badControls.map((c) => c.table)).toEqual(["IMAGE_PAGE_SIZES"]);
    expect(startsRegional(bad, badControls[0]!)).toBe(false);
    const good = fixed(`regionalChoice(IMAGE_PAGE_SIZES, useRegionalPaper())`);
    expect(
      startsRegional(good, (await discoverControls(good, realLoad))[0]!),
    ).toBe(true);
    // A regional call on ANOTHER table does not license this one.
    const other = fixed(`regionalChoice(SCAN_PAGE_SIZES, useRegionalPaper())`);
    expect(
      startsRegional(other, (await discoverControls(other, realLoad))[0]!),
    ).toBe(false);
  });

  it("a table name that is not exported is FATAL, not skipped", async () => {
    const file = path.join(ROOT, "tools", "fake-broken.tsx");
    await expect(
      discoverControls(
        {
          [file]: `import { NO_SUCH_TABLE } from "@/lib/pdf/image-page-layout";
NO_SUCH_TABLE.map((s) => s);`,
        },
        realLoad,
      ),
    ).rejects.toThrow(/not exported/);
  });

  it("the shape test: A4 and Letter both, by id, any case", () => {
    expect(isPageSizeTable([{ id: "A4" }, { id: "Letter" }])).toBe(true);
    expect(isPageSizeTable([{ id: "a4" }, { id: "a5" }])).toBe(false);
    expect(isPageSizeTable([{ id: "normal" }])).toBe(false);
    expect(isPageSizeTable("a4 letter")).toBe(false);
  });
});

describe("the regional paper, by the browser's languages", () => {
  const paperFor = (nav: Parameters<typeof browserLocales>[0]) =>
    imagePageSizeForLocales(browserLocales(nav));

  it.each([
    ["en-US", "letter"],
    ["en-CA", "letter"],
    ["fr-CA", "letter"],
    ["es-MX", "letter"],
    ["en", "letter"], // no region: CLDR's likely one, US
    ["en-GB", "a4"],
    ["en-IN", "a4"],
    ["hi-IN", "a4"],
    ["bn-BD", "a4"],
    ["bn", "a4"], // likely region BD
    ["de-DE", "a4"],
    ["ja-JP", "a4"],
    ["ja", "a4"],
  ])("%s -> %s", (tag, paper) => {
    expect(paperFor({ languages: [tag], language: tag })).toBe(paper);
  });

  it("the FIRST preference decides", () => {
    expect(paperFor({ languages: ["en-GB", "en-US"] })).toBe("a4");
    expect(paperFor({ languages: ["en-US", "en-GB"] })).toBe("letter");
  });

  /*
   * The safe default is A4: it is the paper of every region CLDR does not
   * list as Letter — most of the world — and it is what the server's render
   * shows before the browser is asked, so an unreadable list changes nothing
   * on screen.
   */
  it("an empty, missing or malformed list falls back to navigator.language, then A4", () => {
    expect(paperFor({ languages: [], language: "en-US" })).toBe("letter");
    expect(paperFor({ languages: [], language: "" })).toBe("a4");
    expect(paperFor({})).toBe("a4");
    expect(paperFor({ languages: undefined, language: undefined })).toBe("a4");
    expect(paperFor({ languages: ["!!not a tag"] })).toBe("a4");
    expect(paperFor({ languages: [""] as string[] })).toBe("a4");
    expect(
      paperFor({
        languages: [42, null] as unknown as string[],
        language: "en-US",
      }),
    ).toBe("letter");
  });

  it("regionalChoice finds the size by id without case, and refuses a table without it", () => {
    expect(regionalChoice([{ id: "A4" }, { id: "Letter" }], "letter")).toBe(
      "Letter",
    );
    expect(regionalChoice([{ id: "a4" }, { id: "letter" }], "a4")).toBe("a4");
    expect(() => regionalChoice([{ id: "a5" }], "a4")).toThrow(/no "a4"/);
  });
});
