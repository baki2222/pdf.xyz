// @vitest-environment node
/**
 * THE PROPERTY: the per-file size a tool's page states IS the size the thing
 * that runs that tool refuses above — for every tool in the catalogue, and
 * measured on the markup a reader receives.
 *
 * Not "the hint must derive from `toolFileCeilingMb`" — that is a mechanism,
 * and it goes green the moment somebody adds a second surface that does not.
 * The property is a relationship: render the page, take every data-size figure
 * on it, and require each one to equal that tool's own gate.
 *
 * ── WHAT WAS MEASURED BEFORE THIS GUARD (2026-08-22, all fifty pages rendered
 * and scanned for data-size figures) ─────────────────────────────────────────
 *
 *   25 pages    nothing at all          merge, split, rotate, sign, redact, …
 *   20 pages    "100 MB" + "100.0 MB"   the runner-less tools: panel, FAQ, fact
 *    1 page     "100 MB"                compress-pdf — hybrid, so its FAQ asked
 *    2 pages    "25 MB"                 jpg-to-pdf, png-to-pdf
 *    2 pages    "2 MB"                  text-to-pdf, markdown-to-pdf
 *
 * Every figure there was true of its own tool, and one of the 21 stating
 * "100 MB per file" was `webpage-to-pdf`, whose input is a URL.
 *
 * So the reported defect — *"all 50 tool pages state the same Max 100 MB"* —
 * was NOT what shipped. The line it names,
 * `page.tsx: hint={... JOB_LIMITS.maxFileBytes ...}`, renders only for a tool
 * that is `processing: "client"` AND has no runner; there are 29 of the first,
 * 20 of the second, and **0 in both**. A wrong number that reaches nobody is
 * worth exactly as much as no number at all — in this direction too.
 *
 * What was actually wrong was structural, and it is what this file pins:
 *
 *  1. every size a tool page could state came from ONE global constant, so each
 *     correct figure above was correct by coincidence. Remove any single runner
 *     and that hint ships 100 MB on a page whose gate refuses at 2 MB;
 *  2. 25 pages stated no ceiling anywhere a reader meets before picking a file;
 *  3. `webpage-to-pdf` stated a per-file ceiling for a tool the API refuses
 *     uploads for outright.
 *
 * ── DERIVED SETS, never typed ───────────────────────────────────────────────
 *
 *  - the tools come from the catalogue, not a list here;
 *  - each tool's runner comes from `getRunnerKind` — the same registry the tool
 *    page dispatches on to decide whether a runner mounts at all;
 *  - each runner's COMPONENT comes from the real `switch` in
 *    `runner/tool-runner.tsx`, resolved through that file's own import table;
 *  - each runner's GATE is classified from that component's own source: the
 *    `validatePdfFile` / `partitionPdfFiles` call it admits files through, or
 *    the `.size > CONSTANT` comparison it makes. An unclassifiable runner
 *    FAILS; it is never skipped;
 *  - which constant the module CLAIMS per runner is read back out of
 *    `file-ceilings.ts`'s own source as an identifier, so the comparison is
 *    name-to-name. `MAX_PDF_BYTES` and `JOB_LIMITS.maxFileBytes` are both
 *    exactly 100 MB today, and a value comparison would call two different
 *    tiers' constants the same answer.
 *
 * ── THE WALK IS DELIBERATELY NARROW, AND THAT IS ITS OWN RULE ───────────────
 *
 * Gate classification follows RELATIVE imports only — the runner's own
 * composition — not the transitive `@/` closure. Measured: `image-to-pdf`'s
 * full closure names `MAX_SOURCE_BYTES`, `JOB_LIMITS.maxFileBytes` and
 * `MAX_PDF_BYTES` alongside the one constant that actually gates an image,
 * because it reaches `tool-facts`. Widening a set is a defect too, and a walk
 * that ADDS constants answers an easier question than the one asked. The
 * narrowing is not taken on trust: a control below proves at least one runner's
 * wide closure really does name more than its narrow one.
 *
 * ── WHAT IS RUN, NOT READ ──────────────────────────────────────────────────
 *
 * Every constant the table names is exercised against its real validator at the
 * ceiling and one byte over. A classification the engine is never run against
 * is decoration, and the completeness check demands a probe for each constant
 * BY NAME rather than accepting whichever probes happen to exist.
 *
 * ── THE EXIT CONDITION names the property: a surface leaves this guard when it
 * states its own tool's gate, never because two numbers agree this week.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadZone } from "@/components/upload/upload-zone";
import { JOB_LIMITS } from "@/lib/jobs/types";
import { parseCreateUploadSessionRequest } from "@/lib/jobs/validation";
import { MAX_PDF_BYTES, validatePdfFile } from "@/lib/pdf/files";
import { validateImagePdfInputs } from "@/lib/pdf/image-to-pdf";
import { validateMarkdownInput } from "@/lib/pdf/markdown-to-pdf";
import { validatePlainTextInput } from "@/lib/pdf/text-to-pdf";
import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { getAllToolSlugs, tools } from "./index";
import { withoutComments } from "./copy-surface";
import { FONT_PACKS } from "@/lib/pdf/font-packs";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import { MAX_PDF_PASSWORD_BYTES } from "@/lib/jobs/pdf-security";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { nativeHtmlRenderDeps } from "@/lib/workers/html-render/native";
import type { Processor } from "@/lib/workers/processor/types";
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES } from "./limits";
import {
  ENGINE_INPUT_CEILINGS,
  RUNNER_FILE_CEILINGS,
  WORKER_FILE_CEILING,
  stagingHint,
  toolFileCeiling,
  toolFileCeilingMb,
} from "./file-ceilings";
import type { Tool } from "./types";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");
const MB = 1024 * 1024;

const DISPATCH = path.join(ROOT, "src/components/tools/runner/tool-runner.tsx");
const CEILINGS_MODULE = path.join(ROOT, "src/lib/tools/file-ceilings.ts");
const PDF_FILES_MODULE = path.join(ROOT, "src/lib/pdf/files.ts");
const TOOL_PAGE = path.join(ROOT, "src/app/tools/[slug]/page.tsx");

/* ------------------------------------------------------------------ *
 *  Module resolution and the two closures.
 * ------------------------------------------------------------------ */

function resolveSpec(fromFile: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("."))
    base = path.resolve(path.dirname(fromFile), spec);
  else return undefined;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      readFileSync(base + suffix);
      return base + suffix;
    } catch {
      /* try the next extension */
    }
  }
  return undefined;
}

/**
 * Value-import closure. `relativeOnly` is the gate walk (the runner's own
 * composition); the wide walk exists only so the control below can show why the
 * narrow one is narrow. `import type` edges are skipped in both — they are
 * erased at runtime, and following them adds edges nothing executes.
 */
function closure(entry: string, relativeOnly: boolean): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = read(file);
    } catch {
      continue;
    }
    for (const match of source.matchAll(
      /import\s+([\s\S]*?)from\s*"([^"]+)"/g,
    )) {
      if (/^\s*type\b/.test(match[1]!)) continue;
      const spec = match[2]!;
      if (relativeOnly && !spec.startsWith(".")) continue;
      const next = resolveSpec(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

/* ------------------------------------------------------------------ *
 *  Set: runner kind → the component the page really mounts.
 * ------------------------------------------------------------------ */

function runnersFromDispatch(): Map<string, string> {
  const source = withoutComments(read(DISPATCH));
  const imports = new Map<string, string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g,
  )) {
    for (const name of match[1]!.split(","))
      imports.set(name.trim(), match[2]!);
  }
  const byKind = new Map<string, string>();
  let pending: string | null = null;
  for (const token of source.matchAll(
    /case "([\w-]+)":|<([A-Z][A-Za-z0-9]*)/g,
  )) {
    if (token[1]) {
      pending = token[1];
      continue;
    }
    if (!pending) continue;
    const spec = imports.get(token[2]!);
    if (!spec) continue;
    const file = resolveSpec(DISPATCH, spec);
    if (!file) continue;
    byKind.set(pending, file);
    pending = null;
  }
  return byKind;
}

const dispatch = runnersFromDispatch();

/* ------------------------------------------------------------------ *
 *  The constants, by NAME. A value table would conflate MAX_PDF_BYTES
 *  with JOB_LIMITS.maxFileBytes — different tiers, same 100 MB.
 * ------------------------------------------------------------------ */

const CEILING_CONSTANTS: Readonly<Record<string, number>> = {
  MAX_PDF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_SOURCE_BYTES,
};

/** runner kind → the constant NAME `file-ceilings.ts` states for it. */
function declaredCeilingNames(): Map<string, string> {
  const source = withoutComments(read(CEILINGS_MODULE));
  const table = source.match(
    /RUNNER_FILE_CEILINGS[^=]*=\s*\{([\s\S]*?)\n\};/,
  )?.[1];
  if (!table) {
    throw new Error(
      `${rel(CEILINGS_MODULE)} no longer declares a RUNNER_FILE_CEILINGS object ` +
        "literal this guard can read — the name-level comparison is the only " +
        "thing that tells two 100 MB constants apart",
    );
  }
  const names = new Map<string, string>();
  for (const line of table.matchAll(
    /^\s*"?([\w-]+)"?\s*:\s*([A-Z]\w*)\s*,/gm,
  )) {
    names.set(line[1]!, line[2]!);
  }
  return names;
}

const declared = declaredCeilingNames();

/* ------------------------------------------------------------------ *
 *  The classifier: which constant does this runner's gate compare to?
 * ------------------------------------------------------------------ */

/**
 * Every ceiling constant NAME one source admits an input against. Takes SOURCE
 * rather than a path, so the health check below runs the real extractor over
 * strings whose answers are known — a blind extractor and a clean codebase are
 * indistinguishable from the outside.
 */
function gateConstantsInSource(source: string): Set<string> {
  const found = new Set<string>();
  for (const call of source.matchAll(
    /\b(?:validatePdfFile|partitionPdfFiles)\s*\(([^)]*)\)/g,
  )) {
    const args = call[1]!.split(",");
    // One argument means the parameter default, which a check below reads out
    // of `pdf/files.ts` rather than assuming.
    found.add(args.length > 1 ? args[1]!.trim() : "MAX_PDF_BYTES");
  }
  for (const cmp of source.matchAll(
    /\.(?:size|byteLength)\s*>\s*([A-Z][A-Z0-9_]*)/g,
  )) {
    found.add(cmp[1]!);
  }
  return found;
}

function gateConstantsIn(files: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const name of gateConstantsInSource(withoutComments(read(file)))) {
      found.add(name);
    }
  }
  return found;
}

/** The one constant a runner admits files against. Throws rather than guesses. */
function classifyRunner(kind: string): string {
  const entry = dispatch.get(kind);
  if (!entry) {
    throw new Error(
      `runner/tool-runner.tsx has no \`case "${kind}"\` mounting a component — ` +
        "the gate cannot be discovered from the artifact the page dispatches on",
    );
  }
  const names = [...gateConstantsIn(closure(entry, true))];
  if (names.length !== 1) {
    throw new Error(
      `${kind} (${rel(entry)}) admits files against ${names.length} ceilings ` +
        `[${names.join(", ") || "none"}] — classify it here before any page ` +
        "states one of them",
    );
  }
  const name = names[0]!;
  if (!(name in CEILING_CONSTANTS)) {
    throw new Error(
      `${kind} gates on "${name}", which this guard has no value or probe for — ` +
        "add it to CEILING_CONSTANTS and give it a behavioural probe",
    );
  }
  return name;
}

/* ------------------------------------------------------------------ *
 *  The size-claim extractor, shared by the checks and their controls.
 * ------------------------------------------------------------------ */

const UNIT_MB: Readonly<Record<string, number>> = {
  bytes: 1 / MB,
  kb: 1 / 1024,
  mb: 1,
  gb: 1024,
  tb: 1024 * 1024,
};

/**
 * Every data-size figure in a rendered sentence, in megabytes.
 *
 * Bare "B" is deliberately not a unit here: `\d+\s*B\b` matches the "2b" in
 * "PDF/A-2b", and this scan runs over the PDF/A page. `bytes` spelled out IS
 * matched, because that is the spelling the API errors use.
 */
const SIZE_CLAIM = /(?<![\w-])(\d[\d,]*(?:\.\d+)?)\s*(bytes|KB|MB|GB|TB)\b/gi;

function sizeClaimsMb(text: string): number[] {
  return [
    // Not preceded by a letter or hyphen: "UTF-8 bytes" is an encoding, and
    // read as a size it made "8 bytes" a claim on two pages (2026-09-27).
    ...text.matchAll(SIZE_CLAIM),
  ].map(
    (match) =>
      Number(match[1]!.replace(/,/g, "")) * UNIT_MB[match[2]!.toLowerCase()]!,
  );
}

/**
 * Sizes a tool page states that are NOT the per-file ceiling of the file the
 * reader picks — each gated TWICE, by value and by subject.
 *
 * Added 2026-09-27, when the authored content reached the pages: a font the
 * browser downloads ("137.8 KB for Bengali"), a password's length ("up to 127
 * bytes") and a picture inserted into the PDF ("up to 10 MB"). Every one is
 * true, and this guard failed pages on them, because it asked "is there a
 * size on the page?" while claiming to ask "what does the page say the tool
 * accepts?".
 *
 * VALUE alone would license the defect: a page on a 2 MB tool saying "up to
 * 10 MB" would pass as the picture cap. SUBJECT alone would too: "a PNG of up
 * to 100 MB" on the 25 MB image tool mentions a picture. Both must hold — the
 * figure equals a constant that owns this other quantity, AND the words
 * around it name that quantity. `controls` keeps each class's shipped sentence
 * exempt and a plain ceiling claim with the same value red.
 *
 * REMOVED THE SAME DAY: a fourth class, "the converting engine's own input
 * cap", exempted LibreOffice's 50 MB and Chromium's 20 MB as "NOT the per-file
 * ceiling of the file the reader picks". They are exactly that file's ceiling
 * (a bigger one uploads and is then refused), and the exemption let the Word,
 * Excel, PowerPoint and HTML pages state "Up to 100 MB per file", the upload
 * gate, a few lines below "the converter refuses a Word file over 50 MB", both
 * in the FAQPage JSON-LD, with this guard green. The fix was the ceiling, not
 * the guard: `toolFileCeiling` now takes the lower of the gate and the
 * engine's cap (`ENGINE_INPUT_CEILINGS`), and section 3b runs each engine at
 * it. The control "an engine's input cap is a CEILING claim" keeps the class
 * from coming back.
 */
const MB_OF = (bytes: number) => bytes / MB;
const OTHER_SIZES: readonly {
  what: string;
  valuesMb: readonly number[];
  near: RegExp;
  window: number;
  shipped: string;
}[] = [
  {
    what: "a font the browser downloads",
    valuesMb: FONT_PACKS.map((pack) => MB_OF(pack.bytes)),
    near: /\b(?:font|typeface|Noto)\b/i,
    window: 200,
    shipped:
      "a Noto typeface from the /fonts/ folder on this same site: 137.8 KB for Bengali up to 10.1 MB for Chinese",
  },
  {
    what: "a password's length",
    valuesMb: [MB_OF(MAX_PDF_PASSWORD_BYTES)],
    near: /\bpassword\b|\bToo long\b/i,
    // Wide: in the FAQPage JSON-LD the question ("…the password itself?")
    // and the figure sit ~170 characters apart. The value gate is exact.
    window: 240,
    shipped:
      "Enter it in the New password field. It can be up to 127 bytes long.",
  },
  {
    what: "a picture inserted into the PDF",
    valuesMb: [MB_OF(MAX_EDIT_IMAGE_BYTES)],
    near: /\b(?:picture|image|photo|PNG|JPG)\b/i,
    window: 80,
    shipped: "Choose a PNG or JPG of up to 10 MB",
  },
];

/** The per-file CEILING claims on a page: every size not in OTHER_SIZES. */
function ceilingClaimsMb(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(SIZE_CLAIM)) {
    const mb =
      Number(match[1]!.replace(/,/g, "")) * UNIT_MB[match[2]!.toLowerCase()]!;
    const at = match.index ?? 0;
    const other = OTHER_SIZES.some((kind) => {
      if (!kind.valuesMb.some((v) => Math.abs(v - mb) / v < 0.01)) return false;
      const around = text.slice(
        Math.max(0, at - kind.window),
        at + match[0].length + kind.window,
      );
      return kind.near.test(around);
    });
    if (!other) out.push(mb);
  }
  return out;
}

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&middot;|&#183;/g, " ")
    .replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ *
 *  Rendering: the point of consumption.
 * ------------------------------------------------------------------ */

const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CENSUS = path.join(ROOT, "src", "tests", "render-tool-pages.ts");

/**
 * Every tool page, rendered in a FRESH PROCESS.
 *
 * Not for speed. Under `isolate: false` one module cache is shared by every
 * test file in a worker, and `chat-with-pdf-worker-panel.test.tsx` mocks
 * `@/lib/workers/chat-with-pdf-client` before importing its panel. The tool
 * page statically imports that panel, so a test file importing the page would
 * become the stub's observer — `tests/mock-isolation.test.ts` says so by name —
 * and this census would be reading a page rendered against another file's fake
 * driver. For an assertion about what a page renders, that is the hazard
 * itself, not a rule to route around.
 *
 * Spawned as `node .../tsx/dist/cli.mjs`, never `node_modules/.bin/tsx`: that
 * shim is a shebang script Windows cannot exec.
 */
function renderAllPages(): Record<string, string> {
  const stdout = execFileSync(process.execPath, [TSX_CLI, CENSUS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Record<string, string>;
}

function renderStagingZone(tool: Tool): string {
  return textOf(
    renderToStaticMarkup(
      createElement(UploadZone, { hint: stagingHint(tool) }),
    ),
  );
}

const pageText = new Map<string, string>();

beforeAll(() => {
  for (const [slug, text] of Object.entries(renderAllPages())) {
    pageText.set(slug, text);
  }
}, 180_000);

/* ------------------------------------------------------------------ *
 *  The behavioural probes.
 * ------------------------------------------------------------------ */

type Verdict = "accepted" | "refused";

const GATE_PROBES: readonly {
  constant: string;
  engine: string;
  run: (bytes: number) => Verdict;
}[] = [
  {
    constant: "MAX_PDF_BYTES",
    engine: "validatePdfFile",
    run: (bytes) =>
      validatePdfFile({ name: "a.pdf", type: "application/pdf", size: bytes })
        .ok
        ? "accepted"
        : "refused",
  },
  {
    constant: "MAX_IMAGE_BYTES",
    engine: "validateImagePdfInputs",
    run: (bytes) => {
      try {
        validateImagePdfInputs("jpg", [
          { name: "a.jpg", type: "image/jpeg", bytes: new Uint8Array(bytes) },
        ]);
        return "accepted";
      } catch {
        return "refused";
      }
    },
  },
  {
    constant: "MAX_SOURCE_BYTES",
    engine: "validatePlainTextInput",
    run: (bytes) => {
      try {
        validatePlainTextInput("a".repeat(bytes));
        return "accepted";
      } catch {
        return "refused";
      }
    },
  },
  {
    constant: "MAX_SOURCE_BYTES",
    engine: "validateMarkdownInput",
    run: (bytes) => {
      try {
        validateMarkdownInput("a".repeat(bytes));
        return "accepted";
      } catch {
        return "refused";
      }
    },
  },
  {
    constant: "WORKER_FILE_CEILING",
    engine: "parseCreateUploadSessionRequest",
    run: (bytes) => {
      // The tool is DISCOVERED, not typed: the first worker-tier PDF tool the
      // catalogue offers. Naming one here would be a list of size one.
      const workerTool = tools.find(
        (tool) =>
          toolFileCeiling(tool).tier === "worker" &&
          // The gate's own figure, not a lower engine cap behind it.
          toolFileCeiling(tool).bytes === WORKER_FILE_CEILING &&
          tool.accept.includes("PDF"),
      );
      if (!workerTool) {
        throw new Error("no worker-tier PDF tool in the catalogue");
      }
      return parseCreateUploadSessionRequest({
        tool: workerTool.slug,
        files: [{ filename: "a.pdf", contentType: "application/pdf", bytes }],
      }).ok
        ? "accepted"
        : "refused";
    },
  },
];

const PROBE_VALUES: Readonly<Record<string, number>> = {
  ...CEILING_CONSTANTS,
  WORKER_FILE_CEILING,
};

/* ================================================================== *
 *  1. The derived sets are alive.
 * ================================================================== */

describe("the derived sets are alive", () => {
  it("the catalogue yields every tool (vacuity bound: ~50 today)", () => {
    // `[] ⊆ X` is vacuously true, so a collapsed catalogue would report the
    // strongest possible pass on every per-tool check below.
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(tools.length).toBeLessThanOrEqual(80);
    expect(tools.length).toBe(getAllToolSlugs().length);
    // Anchors: one tool per tier. If any leaves the set, the assertions about
    // it evaporate silently rather than failing.
    const slugs = tools.map((tool) => tool.slug);
    expect(slugs).toContain("merge-pdf"); // in-browser, PDF gate
    expect(slugs).toContain("jpg-to-pdf"); // in-browser, image gate
    expect(slugs).toContain("text-to-pdf"); // in-browser, source gate
    expect(slugs).toContain("ocr-pdf"); // worker tier
    expect(slugs).toContain("webpage-to-pdf"); // no file input
  });

  it("the runner dispatch yields a real component for every declared kind", () => {
    // Implausibly small in either direction is a broken walk, not a strict one.
    expect(dispatch.size).toBeGreaterThanOrEqual(20);
    expect([...dispatch.keys()].sort()).toEqual(
      [...Object.keys(RUNNER_FILE_CEILINGS)].sort(),
    );
    for (const [kind, file] of dispatch) {
      expect(
        () => read(file),
        `${kind} → ${rel(file)} does not exist`,
      ).not.toThrow();
    }
  });

  it("every catalogue runner kind is declared, and every declaration is used", () => {
    // Both directions of the corpus rule. A ceiling for a kind no tool mounts
    // is decoration; a mounted kind with no ceiling is a hole.
    const used = new Set(
      tools
        .map((tool) => getRunnerKind(tool.slug))
        .filter((kind): kind is RunnerKind => Boolean(kind)),
    );
    expect(used.size).toBeGreaterThanOrEqual(20);
    for (const kind of used) {
      expect(
        Object.hasOwn(RUNNER_FILE_CEILINGS, kind),
        `${kind} is mounted by a catalogue tool but has no declared ceiling`,
      ).toBe(true);
    }
    for (const kind of Object.keys(RUNNER_FILE_CEILINGS)) {
      expect(
        dispatch.has(kind),
        `${kind} has a declared ceiling but no branch in the runner dispatch`,
      ).toBe(true);
    }
  });

  it("the declared table is readable as NAMES, not just values", () => {
    expect([...declared.keys()].sort()).toEqual(
      [...Object.keys(RUNNER_FILE_CEILINGS)].sort(),
    );
    for (const [kind, name] of declared) {
      expect(
        CEILING_CONSTANTS[name],
        `${kind} is declared as ${name}, which this guard cannot value`,
      ).toBeDefined();
      expect(RUNNER_FILE_CEILINGS[kind as RunnerKind]).toBe(
        CEILING_CONSTANTS[name],
      );
    }
    // Bound: all three in-browser gates must really be represented, or the
    // classifier below is being asked an easier question than it looks.
    expect(new Set(declared.values())).toEqual(
      new Set(["MAX_PDF_BYTES", "MAX_IMAGE_BYTES", "MAX_SOURCE_BYTES"]),
    );
  });

  it("every rendered page is in the corpus and is not empty", () => {
    expect(pageText.size).toBe(tools.length);
    // The subprocess renders from its own read of the catalogue; a census that
    // covered a different set of slugs would leave per-tool checks reading
    // `undefined` rather than failing.
    expect([...pageText.keys()].sort()).toEqual(
      tools.map((tool) => tool.slug).sort(),
    );
    const total = [...pageText.values()].reduce((sum, t) => sum + t.length, 0);
    expect(
      total,
      "the rendered corpus is implausibly small — the render, not the copy, failed",
    ).toBeGreaterThan(50_000);
    for (const [slug, text] of pageText) {
      expect(text.length, `${slug} rendered almost nothing`).toBeGreaterThan(
        500,
      );
    }
  });
});

/* ================================================================== *
 *  2. The declared ceiling is the gate the runner actually uses.
 * ================================================================== */

describe("every declared ceiling is the constant its runner gates on", () => {
  it("the PDF gate's default really is MAX_PDF_BYTES", () => {
    // The classifier reads a one-argument `validatePdfFile(file)` as the
    // parameter default. That is a claim about another file, so it is checked
    // against that file rather than assumed here.
    const source = withoutComments(read(PDF_FILES_MODULE));
    for (const fn of ["validatePdfFile", "partitionPdfFiles"]) {
      expect(
        new RegExp(
          `export function ${fn}[\\s\\S]{0,400}?maxBytes = MAX_PDF_BYTES`,
        ).test(source),
        `${rel(PDF_FILES_MODULE)}: ${fn} no longer defaults maxBytes to ` +
          "MAX_PDF_BYTES, so every runner classified through it is now wrong",
      ).toBe(true);
    }
  });

  it.each([...Object.keys(RUNNER_FILE_CEILINGS)].sort())(
    "%s states the ceiling its own file gate compares against",
    (kind) => {
      const gated = classifyRunner(kind);
      expect(
        declared.get(kind),
        `${kind} is declared as ${declared.get(kind)} but its runner admits ` +
          `files against ${gated}`,
      ).toBe(gated);
    },
  );

  it("the classifier is not blind: it finds all three gates across the runners", () => {
    // A classifier that silently returned one answer for everything would make
    // every assertion above agree with itself.
    const seen = new Set(
      Object.keys(RUNNER_FILE_CEILINGS).map((kind) => classifyRunner(kind)),
    );
    expect(seen).toEqual(
      new Set(["MAX_PDF_BYTES", "MAX_IMAGE_BYTES", "MAX_SOURCE_BYTES"]),
    );
  });

  it("health check: the gate extractor sees each shape, and only real gates", () => {
    // The real extractor, over source whose answer is known. Every shape the
    // runners actually use is here; a regex that quietly stopped matching one
    // of them would otherwise report the strongest possible pass above.
    expect(gateConstantsInSource("const a = validatePdfFile(file);")).toEqual(
      new Set(["MAX_PDF_BYTES"]),
    );
    expect(
      gateConstantsInSource("partitionPdfFiles(files, MAX_IMAGE_BYTES);"),
    ).toEqual(new Set(["MAX_IMAGE_BYTES"]));
    expect(
      gateConstantsInSource("if (file.size > MAX_SOURCE_BYTES) reject();"),
    ).toEqual(new Set(["MAX_SOURCE_BYTES"]));
    expect(
      gateConstantsInSource("if (b.byteLength > MAX_EDIT_IMAGE_BYTES) stop();"),
    ).toEqual(new Set(["MAX_EDIT_IMAGE_BYTES"]));
    // And it invents no gate out of an emptiness check or an unrelated `.size`.
    expect(gateConstantsInSource("if (file.size > 0) run();")).toEqual(
      new Set(),
    );
    expect(gateConstantsInSource("const n = selected.size > count;")).toEqual(
      new Set(),
    );
  });

  it("control: the WIDE closure really does name more than the narrow one", () => {
    // Why the gate walk follows relative imports only. If this stops being true
    // the narrowing has stopped being load-bearing and should be revisited
    // deliberately — not discovered by a page stating another tier's number.
    const widened = Object.keys(RUNNER_FILE_CEILINGS).filter((kind) => {
      const entry = dispatch.get(kind)!;
      return (
        gateConstantsIn(closure(entry, false)).size >
        gateConstantsIn(closure(entry, true)).size
      );
    });
    expect(
      widened.length,
      "no runner's transitive closure over-names its gate any more",
    ).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== *
 *  3. The gate is RUN, not read.
 * ================================================================== */

describe("every stated ceiling is one an engine really refuses above", () => {
  it("every constant the table names has a probe, by name", () => {
    const probed = new Set(GATE_PROBES.map((probe) => probe.constant));
    for (const name of [...declared.values(), "WORKER_FILE_CEILING"]) {
      expect(
        probed.has(name),
        `${name} is stated on a page but never run against its engine — a ` +
          "classification nothing exercises is decoration",
      ).toBe(true);
    }
    for (const name of probed) {
      expect(
        PROBE_VALUES[name],
        `${name} has a probe but no value`,
      ).toBeDefined();
    }
  });

  it.each(GATE_PROBES.map((probe) => [probe.engine, probe] as const))(
    "%s accepts exactly its ceiling and refuses one byte more",
    (engine, probe) => {
      const bytes = PROBE_VALUES[probe.constant]!;
      expect(
        probe.run(bytes),
        `${engine} refused a file AT ${probe.constant} — every page stating ` +
          "that number under-promises what the engine honours",
      ).toBe("accepted");
      expect(
        probe.run(bytes + 1),
        `${engine} accepted ${probe.constant} + 1 byte — the published ceiling ` +
          "is not the enforced one",
      ).toBe("refused");
    },
  );
});

/* ================================================================== *
 *  3b. Behind the upload gate: engines that refuse LOWER.
 *
 *  A worker-tier file passes the upload gate and then meets the engine that
 *  runs its tool. When that engine's input cap is below the gate, the cap is
 *  the ceiling (`ENGINE_INPUT_CEILINGS`), and a page stating the gate states a
 *  size the tool will not convert, which the Word, Excel, PowerPoint and HTML
 *  pages did until 2026-09-27, with this file green. So the set of such
 *  engines is DISCOVERED here, from every worker config module and every
 *  literal cap in worker source, and each table entry is RUN through the
 *  processor the production registry routes its tool to.
 * ================================================================== */

type LazyModules = Record<string, () => Promise<Record<string, unknown>>>;
const CONFIG_MODULES = (
  import.meta as unknown as { glob: (pattern: string[]) => LazyModules }
).glob([
  "/src/lib/workers/**/*native-config.ts",
  "!/src/lib/workers/**/*.test.ts",
]);
const ENGINE_MODULES = (
  import.meta as unknown as { glob: (pattern: string) => LazyModules }
).glob("/src/lib/workers/*/engine.ts");

interface EngineCap {
  module: string;
  resolver: string;
  bytes: number;
}

/** Every worker config resolver, called with an empty env: the defaults. */
async function discoverConfigCaps(): Promise<EngineCap[]> {
  const caps: EngineCap[] = [];
  for (const [module, load] of Object.entries(CONFIG_MODULES)) {
    const mod = await load();
    for (const [name, value] of Object.entries(mod)) {
      if (!/^resolveNative\w+Config$/.test(name)) continue;
      if (typeof value !== "function") continue;
      const config = (value as (env: object) => { maxInputBytes?: unknown })(
        {},
      );
      if (typeof config.maxInputBytes !== "number") {
        throw new Error(`${module} ${name}({}) has no numeric maxInputBytes`);
      }
      caps.push({ module, resolver: name, bytes: config.maxInputBytes });
    }
  }
  return caps;
}

/** Catalogue slugs an engine module exports, as constants or as lists. */
async function engineTools(configModule: string): Promise<string[]> {
  const engine = configModule.replace(/[^/]+$/, "engine.ts");
  const load = ENGINE_MODULES[engine];
  if (!load) {
    throw new Error(
      `${configModule} caps input below the upload gate and has no sibling ` +
        "engine.ts to say which tools it runs, so the ceiling cannot be derived",
    );
  }
  const known = new Set(getAllToolSlugs());
  const slugs = new Set<string>();
  for (const value of Object.values(await load())) {
    const members: unknown[] = Array.isArray(value) ? value : [value];
    for (const member of members)
      if (typeof member === "string" && known.has(member)) slugs.add(member);
  }
  return [...slugs].sort();
}

/** `maxInputBytes: 100 * 1024 * 1024` written straight into worker source. */
const LITERAL_CAP =
  /\bmaxInputBytes:\s*(\d[\d_]*(?:\s*\*\s*\d[\d_]*)*)\s*[,}\n]/g;
function literalCaps(source: string): number[] {
  return [...source.matchAll(LITERAL_CAP)].map((match) =>
    match[1]!
      .split("*")
      .map((factor) => Number(factor.trim().replace(/_/g, "")))
      .reduce((product, factor) => product * factor, 1),
  );
}

function trackedFiles(...pathspec: string[]): string[] {
  return execFileSync("git", ["ls-files", ...pathspec], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

const MIN_PDF = new TextEncoder().encode(
  `%PDF-1.4\n${"x".repeat(64)}\n%%EOF\n`,
);
/** Every binary reported absent, so the factories contribute LIMITS only. */
const NO_BINARIES = { resolveOnPath: () => false, fileExists: () => false };

function routedProcessor(slug: string): Processor {
  // The production composition: each native deps factory's own limits, and
  // the registry that decides which processor a job's tool reaches. Only the
  // binary is faked, and it returns a PDF for whatever it is handed.
  const registry = createProcessorRegistry({
    officeConversion: {
      ...nativeOfficeConversionDeps({}, NO_BINARIES),
      libreoffice: { convertToPdf: async () => MIN_PDF },
    },
    htmlRender: {
      ...nativeHtmlRenderDeps({}, NO_BINARIES),
      chromium: {
        renderHtml: async () => MIN_PDF,
        renderUrl: async () => MIN_PDF,
      },
    },
  });
  const processor = registry.resolve(slug);
  if (!processor) throw new Error(`no processor is routed ${slug}`);
  return processor;
}

async function runAt(slug: string, bytes: number) {
  const tool = tools.find((candidate) => candidate.slug === slug)!;
  const ext = tool.accept[0]!.toLowerCase();
  return routedProcessor(slug).process({
    tool: slug,
    options: {},
    inputs: [
      {
        fileId: "f1",
        filename: `input.${ext}`,
        contentType: "application/octet-stream",
        bytes: new Uint8Array(bytes),
      },
    ],
  });
}

/** A non-comment line that gives `name` a value (env file, compose, k8s). */
function assigns(text: string, name: string): string[] {
  const pattern = new RegExp(`(?<![\\w.])${name}\\s*[=:]\\s*["']?\\S`);
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line) && pattern.test(line));
}

describe("an engine that refuses below the upload gate sets the ceiling", () => {
  it("every worker config whose default cap is below the gate is in the table, for exactly its tools", async () => {
    const caps = await discoverConfigCaps();
    // Vacuity bound: eight config modules today. A glob gone blind would make
    // "nothing is below the gate" the strongest possible pass.
    expect(
      caps.length,
      "the config discovery is implausibly small",
    ).toBeGreaterThanOrEqual(8);
    const derived = new Map<string, number>();
    for (const cap of caps.filter((c) => c.bytes < WORKER_FILE_CEILING)) {
      const slugs = await engineTools(cap.module);
      expect(
        slugs.length,
        `${cap.module} names no catalogue tool`,
      ).toBeGreaterThan(0);
      for (const slug of slugs) {
        const tool = tools.find((candidate) => candidate.slug === slug)!;
        if (toolFileCeiling(tool).tier === "no-file-input") continue;
        derived.set(slug, cap.bytes);
      }
    }
    // Positive control: the two engines that motivated this are found.
    expect(derived.size).toBeGreaterThanOrEqual(4);
    const table = Object.fromEntries(
      Object.entries(ENGINE_INPUT_CEILINGS).map(([slug, e]) => [slug, e.bytes]),
    );
    expect(
      table,
      "ENGINE_INPUT_CEILINGS must name exactly the file tools whose engine " +
        "refuses below the upload gate, at that engine's default cap",
    ).toEqual(Object.fromEntries([...derived].sort()));
  });

  it("no literal input cap in worker source sits below the gate unaccounted", () => {
    const found: { file: string; bytes: number }[] = [];
    for (const file of trackedFiles("src/lib/workers").filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    ))
      for (const bytes of literalCaps(read(path.join(ROOT, file))))
        found.push({ file, bytes });
    // The AI engines and request-signatures write 100 MB straight in.
    expect(
      found.length,
      "the literal-cap scan found implausibly few",
    ).toBeGreaterThanOrEqual(4);
    const tableValues = new Set(
      Object.values(ENGINE_INPUT_CEILINGS).map((e) => e.bytes),
    );
    const below = found.filter(
      (cap) => cap.bytes < WORKER_FILE_CEILING && !tableValues.has(cap.bytes),
    );
    expect(
      below.map((cap) => `${cap.file}: ${cap.bytes}`),
      "a worker engine caps input below the upload gate outside any config " +
        "module; its tools' ceiling is that cap, not the gate",
    ).toEqual([]);
  });

  it("health check: the literal-cap extractor reads the shapes that ship", () => {
    expect(literalCaps("maxInputBytes: 100 * 1024 * 1024,")).toEqual([
      100 * MB,
    ]);
    expect(literalCaps("{ maxInputBytes: 52_428_800 }")).toEqual([50 * MB]);
    expect(literalCaps("maxInputBytes: config.maxInputBytes,")).toEqual([]);
  });

  it.each(Object.keys(ENGINE_INPUT_CEILINGS).sort())(
    "%s: the routed processor converts a file AT the ceiling and refuses one byte more",
    async (slug) => {
      const tool = tools.find((candidate) => candidate.slug === slug)!;
      const ceiling = toolFileCeiling(tool);
      expect(ceiling.tier).toBe("worker");
      expect(ceiling.bytes).toBeLessThan(WORKER_FILE_CEILING);
      const at = await runAt(slug, ceiling.bytes!);
      expect(
        at.ok,
        `${slug} refused a file AT its stated ceiling: ${JSON.stringify(at)}`,
      ).toBe(true);
      const over = await runAt(slug, ceiling.bytes! + 1);
      expect(
        over.ok ? "converted" : over.error.code,
        `${slug} did not refuse one byte over its stated ceiling as too large`,
      ).toBe("payload_too_large");
    },
    60_000,
  );

  it("no deploy artifact in this repo overrides a cap the table states", async () => {
    const caps = await discoverConfigCaps();
    const names = new Set<string>();
    for (const cap of caps.filter((c) => c.bytes < WORKER_FILE_CEILING)) {
      const source = read(path.join(ROOT, cap.module.replace(/^\//, "")));
      // `Math.max(` in front since wave1 made an override able only to RAISE
      // the published default; the variable is the same one.
      for (const match of source.matchAll(
        /maxInputBytes:\s*(?:Math\.max\(\s*)?parsePositiveInt\(\s*env\.(\w+)/g,
      ))
        names.add(match[1]!);
    }
    // One override variable per below-gate engine, read from its own source.
    expect([...names].sort()).toEqual([
      "PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES",
      "PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES",
    ]);
    const files = trackedFiles().filter(
      (file) =>
        !file.startsWith("src/") &&
        !/\.(?:png|jpe?g|gif|ico|woff2?|ttf|otf|pdf|zip|webp)$/i.test(file),
    );
    // Health: the worker's own deploy files are in the scanned set.
    expect(files).toContain("docker-compose.worker.yml");
    expect(files).toContain(".env.worker.example");
    const setting: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = read(path.join(ROOT, file));
      } catch {
        continue;
      }
      for (const name of names)
        for (const line of assigns(text, name))
          setting.push(`${file}: ${line.trim()}`);
    }
    expect(
      setting,
      "a deploy artifact overrides an engine input cap that tool pages state " +
        "as the ceiling; those pages state the default",
    ).toEqual([]);
  });

  it("positive control: the assignment scanner sees the spellings deploys use", () => {
    const name = "PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES";
    expect(assigns(`${name}=104857600`, name)).toHaveLength(1);
    expect(assigns(`  ${name}: "104857600"`, name)).toHaveLength(1);
    expect(assigns(`      - ${name}=1`, name)).toHaveLength(1);
    expect(assigns(`# ${name}=104857600`, name)).toEqual([]);
    expect(assigns(`env.${name} is read`, name)).toEqual([]);
  });
});

/* ================================================================== *
 *  4. THE POINT OF CONSUMPTION: the rendered page.
 * ================================================================== */

describe("every size a tool page states is that tool's own ceiling", () => {
  it.each(tools.map((tool) => [tool.slug, tool] as const))(
    "%s's rendered page states its ceiling, and no other size",
    (slug, tool) => {
      const ceiling = toolFileCeilingMb(tool);
      const claims = ceilingClaimsMb(pageText.get(slug)!);
      if (ceiling === null) {
        expect(
          claims,
          `${slug} takes no file at all — the API answers unprocessable_entity ` +
            "for any upload to it — yet its page states a per-file size",
        ).toEqual([]);
        return;
      }
      // Vacuity bound: silence is not a pass. A reader deciding whether to pick
      // a file must meet the ceiling before they pick it, not after the gate
      // rejects them. 25 of 50 pages stated nothing before this guard.
      expect(
        claims.length,
        `${slug}'s page never states a file-size ceiling at all`,
      ).toBeGreaterThanOrEqual(1);
      for (const claim of claims) {
        // Tolerance is one `formatBytes` decimal, not a licence: all three
        // ceilings are exact multiples of a mebibyte today.
        expect(
          Math.abs(claim - ceiling) < 0.05,
          `${slug} states ${claim} MB but its gate refuses above ${ceiling} MB — ` +
            "a visitor sized their file against a number the tool will not accept",
        ).toBe(true);
      }
    },
  );

  it.each(tools.map((tool) => [tool.slug, tool] as const))(
    "%s's staging drop zone states the same ceiling, rendered",
    (slug, tool) => {
      // The page branch that mounts this zone renders for no tool today (29
      // client tools, 20 runner-less tools, 0 in both), so the sentence is
      // rendered here through the real component instead of waiting for a page
      // that never shows it. A check that waited would be checking nothing.
      const ceiling = toolFileCeilingMb(tool);
      const claims = sizeClaimsMb(renderStagingZone(tool));
      if (ceiling === null) {
        expect(
          claims,
          `${slug} has no file input but its zone states a size`,
        ).toEqual([]);
        return;
      }
      expect(claims).toEqual([ceiling]);
    },
  );

  it("the tool page reaches for no global per-file cap of its own", () => {
    // The property behind the line this work started from. `JOB_LIMITS` is the
    // WORKER's per-file limit; a page that is about one tool has no business
    // interpolating it, whichever surface is being written next month.
    const source = withoutComments(read(TOOL_PAGE));
    expect(
      /JOB_LIMITS/.test(source),
      `${rel(TOOL_PAGE)} references JOB_LIMITS again — the size a tool page ` +
        "states must come from that tool's gate, not the worker's global cap",
    ).toBe(false);
    expect(source).toContain("stagingHint(tool)");
  });
});

/* ================================================================== *
 *  5. Controls.
 * ================================================================== */

describe("controls", () => {
  it("the other-size classes are exercised both ways", () => {
    for (const kind of OTHER_SIZES) {
      // The sentence that needed the class is seen, and exempt...
      expect(sizeClaimsMb(kind.shipped).length, kind.what).toBeGreaterThan(0);
      expect(ceilingClaimsMb(kind.shipped), kind.what).toEqual([]);
      // ...and the SAME value, stated as what a file may be, is still a claim.
      for (const mb of kind.valuesMb) {
        const plain = `Files of up to ${mb >= 1 ? `${mb} MB` : `${Math.round(mb * MB)} bytes`} are accepted.`;
        expect(ceilingClaimsMb(plain).length, `${kind.what}: ${plain}`).toBe(1);
      }
    }
    // The subject without the value is not enough either: a picture of up to
    // 100 MB on a 25 MB image tool is a ceiling claim.
    expect(ceilingClaimsMb("Choose a PNG or JPG of up to 100 MB")).toEqual([
      100,
    ]);
  });

  it("an engine's input cap is a CEILING claim, never an exempt size", () => {
    // Inverted 2026-09-27. Until then an OTHER_SIZES class exempted this exact
    // sentence as "the converting engine's own input cap", and the Word page
    // shipped it beside the derived "Up to 100 MB per file." with this file
    // green. Now it is read as the ceiling claim it is...
    const shipped =
      "the converter refuses a Word file over 50 MB before LibreOffice ever opens it";
    expect(ceilingClaimsMb(shipped)).toEqual([50]);
    // ...it agrees with the Word tool's ceiling...
    const word = tools.find((candidate) => candidate.slug === "word-to-pdf")!;
    expect(toolFileCeilingMb(word)).toBe(50);
    // ...and the answer that shipped beside it no longer does.
    const shippedFact = `Up to ${JOB_LIMITS.maxFileBytes / MB} MB per file.`;
    expect(
      ceilingClaimsMb(shippedFact).every(
        (claim) => claim === toolFileCeilingMb(word),
      ),
    ).toBe(false);
    for (const kind of OTHER_SIZES)
      expect(kind.what).not.toMatch(/engine|converter|renderer/i);
  });

  it("health check: the size extractor sees the spellings that ship", () => {
    // A blind extractor reports the strongest possible pass above. These are
    // the forms rendered today: `formatBytes` at one decimal, whole megabytes
    // from the FAQ and the hint, and the byte spelling the API errors use.
    expect(sizeClaimsMb("Limit 100.0 MB/file")).toEqual([100]);
    expect(sizeClaimsMb("Up to 25 MB per file.")).toEqual([25]);
    expect(sizeClaimsMb("Accepts TXT · Max 2 MB per file")).toEqual([2]);
    expect(sizeClaimsMb("512 KB")).toEqual([0.5]);
    expect(sizeClaimsMb("1.5 GB")).toEqual([1536]);
    expect(sizeClaimsMb("2,097,152 bytes")).toEqual([2]);
    expect(sizeClaimsMb("no sizes here")).toEqual([]);
    // An encoding is not a size.
    expect(sizeClaimsMb("counted in UTF-8 bytes, up to 2 MB")).toEqual([2]);
    // Why bare "B" is not a unit: this really renders, on the PDF/A page.
    expect(sizeClaimsMb("Converts to PDF/A-2b and PDF/A-3b")).toEqual([]);
  });

  it("positive control: the hint production shipped until 2026-08-22 is caught", () => {
    // The literal expression from `page.tsx`, applied to a tool whose gate
    // refuses 50x lower. If the extractor or the comparison go blind, this
    // stops failing it and "every page agrees" stops meaning anything.
    const tool = tools.find((candidate) => candidate.slug === "text-to-pdf")!;
    const shipped =
      `Accepts ${tool.accept.join(", ")} · Max ` +
      `${JOB_LIMITS.maxFileBytes / MB} MB per file`;
    expect(sizeClaimsMb(shipped)).toEqual([100]);
    expect(toolFileCeilingMb(tool)).toBe(2);
    expect(sizeClaimsMb(shipped).some((claim) => claim !== 2)).toBe(true);
    // And the replacement is not merely different — it is the gate's number.
    expect(sizeClaimsMb(stagingHint(tool))).toEqual([2]);
  });

  it("positive control: the FAQ answer shipped until 2026-08-22 is caught", () => {
    // `Up to ${MAX_FILE_MB} MB per file.` — one global constant, answered for
    // whichever tool asked. Correct for the 24 worker-tier pages that reached
    // it, and 50x wrong for the first in-browser tool that would have.
    const shipped = `Up to ${JOB_LIMITS.maxFileBytes / MB} MB per file.`;
    for (const slug of ["text-to-pdf", "markdown-to-pdf", "jpg-to-pdf"]) {
      const tool = tools.find((candidate) => candidate.slug === slug)!;
      const ceiling = toolFileCeilingMb(tool)!;
      expect(
        sizeClaimsMb(shipped).every((claim) => claim === ceiling),
        `${slug}'s ceiling is ${ceiling} MB; the old global answer would pass`,
      ).toBe(false);
    }
  });
});
