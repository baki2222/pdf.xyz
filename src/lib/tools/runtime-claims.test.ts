// @vitest-environment node
/**
 * The product may say WHERE a tool runs. It may not name a technology the
 * tool does not run on.
 *
 * THE DEFECT. The homepage's security section said "Most tools run with
 * WebAssembly on your own device." The shared capability copy said "Runs
 * entirely on your device with WebAssembly and browser APIs", and so did the
 * tool-page FAQ, the status page and eighteen sentences across the Merge,
 * Split, JPG to PDF, Create Forms, Fill Forms and Sign guides. The in-browser
 * engines are pdf-lib, pdf.js, JSZip and fontkit: JavaScript. WebAssembly
 * appears only in pdf.js's JPEG2000/JBIG2 image decoders (`wasm-assets.ts`),
 * which no one of those tools depends on to do its job. The true claim, that
 * the file stays on the device, never needed the technology named.
 *
 * THE CORPUS is every string, template and JSX text in src, read with the
 * TypeScript parser so a comment explaining the decoders is not "copy". It is
 * found, not listed: the shared capability sentence lives in
 * `src/lib/jobs/capabilities.ts`, which no copy-surface walk reaches.
 *
 * The ban list has a corpus in both directions: every shipped sentence is
 * caught, and the pattern catches one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const BANNED = [{ name: "WebAssembly", pattern: /web\s*assembly/i }] as const;

/** Sentences as they shipped before this fix. */
const SHIPPED = [
  "Most tools run with WebAssembly on your own device. Those tools never upload your files.",
  "Runs entirely on your device with WebAssembly and browser APIs. Files are never uploaded.",
  "No. This tool runs entirely in your browser with WebAssembly and browser APIs — the file stays on your device from start to finish.",
  "It is built on WebAssembly and browser APIs, so your photos stay on your device",
];

const bannedIn = (text: string) =>
  BANNED.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

const SRC = path.join(process.cwd(), "src");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      )
        out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/** Every piece of text a reader can receive from `source`: strings, templates, JSX text. */
function readableTexts(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      out.push(
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          " ",
        ),
      );
    } else if (ts.isJsxText(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("the ban list and its corpus, in both directions", () => {
  it("every shipped sentence is caught", () => {
    for (const sentence of SHIPPED) expect(bannedIn(sentence)).not.toEqual([]);
  });
  it("every pattern catches a shipped sentence", () => {
    for (const { name, pattern } of BANNED)
      expect(
        SHIPPED.some((s) => pattern.test(s)),
        name,
      ).toBe(true);
  });
});

describe("no readable text in src names WebAssembly", () => {
  const files = sourceFiles();

  it("health: a plausible corpus that includes the files that shipped the claim", () => {
    expect(files.length).toBeGreaterThan(500);
    const rel = files.map((f) =>
      path.relative(SRC, f).split(path.sep).join("/"),
    );
    for (const f of [
      // WAS security-section.tsx, which shipped the claim; retired with the
      // privacy grid on 2026-10-21. Its successor on the home page:
      "components/sections/why-section.tsx",
      "lib/jobs/capabilities.ts",
      "lib/tools/tool-facts.ts",
      "components/status/system-status.tsx",
      "lib/guides/catalog.ts",
    ])
      expect(rel).toContain(f);
  });

  it("positive control: prose is read, a comment is not", () => {
    const texts = readableTexts(
      "x.tsx",
      [
        "// pdf.js decodes JPEG2000 with WebAssembly.",
        'const a = "Runs with WebAssembly and browser APIs.";',
        "const b = <p>Most tools run with WebAssembly on your device.</p>;",
      ].join("\n"),
    );
    expect(texts.flatMap(bannedIn)).toEqual(["WebAssembly", "WebAssembly"]);
  });

  it("finds none", () => {
    const offences: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/web\s*assembly/i.test(source)) continue;
      for (const text of readableTexts(file, source))
        if (bannedIn(text).length > 0)
          offences.push(
            `${path.relative(SRC, file)}: ${text.trim().slice(0, 80)}`,
          );
    }
    expect(offences).toEqual([]);
  });
});
