// @vitest-environment node
/**
 * The worker image installs the fonts Office to PDF draws documents in.
 *
 * WHAT WAS WRONG. Until 2026-09-27 the worker stage installed `libreoffice`
 * and `chromium` with `--no-install-recommends` and not one font package.
 * Debian lists Carlito, Liberation, Noto and the rest only as Recommends of
 * `libreoffice`, so they were skipped. Every Calibri or Cambria document came
 * out in a face with other metrics (lines rewrap, pages move) and every
 * Chinese, Japanese, Korean, Bengali, Hindi or Thai run had no glyphs at all,
 * while the catalog said "pixel-perfect PDF ... preserving layout, fonts, and
 * formatting". Nothing failed: the conversion succeeds either way, and
 * `artifacts.test.ts` asked only whether `libreoffice` was installed.
 *
 * WHAT THIS PINS. A relationship, not a list: every stage that installs a
 * document renderer installs every package `office-conversion/fonts.ts` names
 * (and that module maps every OCR language to a script at compile time), and
 * no `fonts-*` package nobody names. It reads the Dockerfile as text so it
 * fails before an image is built. It cannot see what LibreOffice actually
 * EMBEDS — `pnpm worker:prove-tools word-to-pdf` reads that from a real PDF.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import {
  OCR_LANGUAGE_SCRIPT,
  OFFICE_METRIC_CLONES,
  requiredWorkerFontPackages,
  SCRIPT_FONTS,
} from "@/lib/workers/office-conversion/fonts";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Packages whose job is to draw a document, and therefore need fonts. */
const RENDERERS = ["libreoffice", "chromium"] as const;

interface Stage {
  name: string;
  /** Instructions only: whole-line comments dropped, continuations joined. */
  instructions: string[];
}

function parseStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  let current: Stage | null = null;
  const logical = dockerfile
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\\\r?\n/g, " ")
    .split("\n");
  for (const line of logical) {
    const from = /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      current = { name: from[1] ?? "", instructions: [] };
      stages.push(current);
    } else if (current && line.trim()) current.instructions.push(line.trim());
  }
  return stages;
}

/** The exact package tokens a stage passes to `apt-get install`. */
function aptPackages(stage: Stage): string[] {
  const out: string[] = [];
  for (const line of stage.instructions) {
    if (!/^RUN\b/.test(line)) continue;
    for (const cmd of line.replace(/^RUN\s+/, "").split(/&&|;/)) {
      const m = /\bapt-get\s+install\b(.*)$/.exec(cmd);
      if (!m) continue;
      out.push(
        ...m[1]!
          .trim()
          .split(/\s+/)
          .filter((t) => t && !t.startsWith("-")),
      );
    }
  }
  return out;
}

/** What the font guard finds wrong with a Dockerfile. */
function fontProblems(dockerfile: string): {
  renderStages: string[];
  missing: string[];
  orphans: string[];
  cache: string[];
} {
  const required = requiredWorkerFontPackages();
  const renderStages = parseStages(dockerfile).filter((s) =>
    aptPackages(s).some((p) => (RENDERERS as readonly string[]).includes(p)),
  );
  const missing: string[] = [];
  const orphans: string[] = [];
  const cache: string[] = [];
  for (const stage of renderStages) {
    const installed = aptPackages(stage);
    for (const pkg of required)
      if (!installed.includes(pkg)) missing.push(`${stage.name}: ${pkg}`);
    for (const pkg of installed)
      if (pkg.startsWith("fonts-") && !required.includes(pkg))
        orphans.push(`${stage.name}: ${pkg}`);
    const run = stage.instructions.find((l) =>
      required.some((pkg) =>
        aptPackages({ ...stage, instructions: [l] }).includes(pkg),
      ),
    );
    // The cache is built in the layer that adds the fonts, by the tool that
    // package provides; otherwise every soffice process scans ~100 MB of
    // faces into a cache nobody can write (the worker user's home is fresh).
    if (!run || !/\bfc-cache\b/.test(run))
      cache.push(
        `${stage.name}: no fc-cache in the RUN that installs the fonts`,
      );
    if (!installed.includes("fontconfig"))
      cache.push(`${stage.name}: fc-cache needs the fontconfig package`);
  }
  return {
    renderStages: renderStages.map((s) => s.name),
    missing,
    orphans,
    cache,
  };
}

/** Every `target:` a build definition in the repository selects. */
function builtTargets(): Set<string> {
  const files = [
    "docker-compose.worker.yml",
    ...readdirSync(path.join(ROOT, ".github/workflows"))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `.github/workflows/${f}`),
  ];
  const targets = new Set<string>();
  for (const file of files)
    for (const m of read(file).matchAll(/^\s*target:\s*([\w.-]+)\s*$/gm))
      targets.add(m[1]!);
  return targets;
}

describe("worker image fonts — Office and HTML render in the fonts documents name", () => {
  const dockerfile = read("Dockerfile");
  const result = fontProblems(dockerfile);

  it("HEALTH: finds the renderer stage, and it is one a build actually ships", () => {
    expect(result.renderStages.length).toBeGreaterThan(0);
    const shipped = builtTargets();
    expect(shipped.size).toBeGreaterThan(0);
    for (const stage of result.renderStages) expect(shipped).toContain(stage);
    // The parse sees the whole install list, not a fragment of it.
    const stage = parseStages(dockerfile).find(
      (s) => s.name === result.renderStages[0],
    )!;
    expect(aptPackages(stage).length).toBeGreaterThan(20);
  });

  it("HEALTH: the requirement is derived, and not trivially small", () => {
    const required = requiredWorkerFontPackages();
    expect(required.length).toBeGreaterThanOrEqual(4);
    // Each package is required by something: a clone or a script.
    for (const pkg of required)
      expect(
        OFFICE_METRIC_CLONES.some((c) => c.debianPackage === pkg) ||
          Object.values(SCRIPT_FONTS).some((s) => s.debianPackage === pkg),
      ).toBe(true);
  });

  it("HEALTH: every script with a font is one an offered language writes, and every offered language has one", () => {
    // The Record type already refuses a language with no script; this closes
    // the other direction, and reads the RUNTIME list the UI offers rather
    // than the type, so a language added to `OCR_LANGUAGES` alone is seen.
    expect(OCR_LANGUAGE_CODES.length).toBeGreaterThan(10);
    for (const code of OCR_LANGUAGE_CODES)
      expect(SCRIPT_FONTS[OCR_LANGUAGE_SCRIPT[code]], code).toBeDefined();
    expect(new Set(Object.values(OCR_LANGUAGE_SCRIPT))).toEqual(
      new Set(Object.keys(SCRIPT_FONTS)),
    );
  });

  it("installs every font package the office engine relies on", () => {
    expect(result.missing).toEqual([]);
  });

  it("installs no font package that nothing relies on", () => {
    expect(result.orphans).toEqual([]);
  });

  it("builds the font cache in the layer that installs the fonts", () => {
    expect(result.cache).toEqual([]);
  });

  it("POSITIVE CONTROL: the worker stage as it shipped — no font packages — is caught", () => {
    const required = requiredWorkerFontPackages();
    const stripped = dockerfile
      .split("\n")
      .filter(
        (line) =>
          !required.some((pkg) => line.trim() === `${pkg} \\`) &&
          line.trim() !== "fontconfig \\" &&
          line.trim() !== "&& fc-cache -f \\",
      )
      .join("\n");
    expect(stripped).not.toBe(dockerfile);
    const control = fontProblems(stripped);
    expect(control.renderStages).toEqual(result.renderStages);
    expect(control.missing).toEqual(
      result.renderStages.flatMap((s) => required.map((pkg) => `${s}: ${pkg}`)),
    );
    expect(control.cache.length).toBeGreaterThan(0);
  });

  it("POSITIVE CONTROL: package names match exactly, not as prefixes", () => {
    // `fonts-liberation` (1.x) is not `fonts-liberation2`, and `fonts-noto-core`
    // is not `fonts-noto-cjk`: a substring test would pass both.
    const lookalike = `FROM debian AS worker
RUN apt-get install -y --no-install-recommends libreoffice fontconfig \\
      fonts-liberation fonts-noto fonts-crosextra-carlito-extra \\
 && fc-cache -f`;
    const control = fontProblems(lookalike);
    expect(control.missing).toEqual(
      requiredWorkerFontPackages().map((pkg) => `worker: ${pkg}`),
    );
    expect(control.orphans).toEqual([
      "worker: fonts-liberation",
      "worker: fonts-noto",
      "worker: fonts-crosextra-carlito-extra",
    ]);
  });
});
