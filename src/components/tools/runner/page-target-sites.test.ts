// @vitest-environment node
/**
 * Which drop zones a file dropped ANYWHERE on a page lands in.
 *
 * A `Dropzone` is the page's drop target only when it opts in
 * (`pageTarget`): opt-in, because the zones that must NOT take the page's
 * drops are the ones inside an open editor — Sign PDF's signature image,
 * Overlay PDF's overlay — where the page's drops belong to the editor's
 * "replace" target, and a default-on zone mounted there later would take
 * them (the registry's last registration wins). The cost of opt-in is the
 * opposite mistake: a tool's primary zone that forgets, so a near-miss on
 * that tool's page opens the ticket dialog instead of the tool. This holds
 * both: every zone DISCOVERED in the source opts in, except the reasoned
 * secondary zones, and each of those still exists and still does not.
 *
 * And the page keeps a target once the zone is GONE. A primary zone that is
 * the other branch of a condition (`file ? <chip/> : <Dropzone … />`) leaves
 * its page with no target the moment the condition flips — WAS all 13
 * worker panels: with a file chosen, a second PDF dropped on Protect PDF
 * went to the ticket dialog, which never offers the page's own tool (WP-07
 * review). Every such zone's source must register what replaced it: the
 * chip, through `ChosenFileTarget` (with the zone's own `accept` and
 * `refuse`), or an editor of its own (`EditorBox`, the single-PDF runner's
 * "replace"; WAS a `usePageTarget(` call there, until the target left the
 * page's first load for a module that comes with the file — WP-07
 * re-review).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();

/** Zones inside an open editor, which take only drops made ON them. */
const SECONDARY: Record<string, string> = {
  // In sign-runner.tsx until 2026-10-24, when Sign PDF moved onto the
  // shared editor and its signature panel.
  "src/components/tools/runner/editor/signature-panel.tsx":
    "the signature-image zone, shown in the signature panel when the source is Upload: the page's drops replace the PDF being signed",
  "src/components/tools/runner/overlay-runner.tsx":
    "the overlay-PDF zone, shown in the editor until an overlay is chosen: the page's drops replace the base PDF",
  "src/components/tools/runner/watermark-runner.tsx":
    "the watermark-image zone, shown in the editor when the type is Image: the page's drops replace the PDF being watermarked",
};

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(rel);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
        ? [rel]
        : [];
    },
  );
}

/** Each `<Dropzone … />` in a source: whether it opts in, and whether it is a branch. */
function zonesIn(
  source: string,
): { optsIn: boolean; branch: boolean; text: string }[] {
  return [
    ...withoutComments(source).matchAll(
      /(\)\s*:\s*\(\s*)?<Dropzone\b[\s\S]*?\/>/g,
    ),
  ].map((m) => ({
    optsIn: /\bpageTarget(?!\s*=\s*\{\s*false\s*\})(?=[\s/=])/.test(m[0]),
    // The `: (` alternative of a condition: there only while it is false.
    branch: m[1] !== undefined,
    text: m[0],
  }));
}

/** A prop's source as written: `name="…"`, or `name={…}` with one level of nested braces. */
function prop(element: string, name: string): string | null {
  const m = new RegExp(
    `\\b${name}=("[^"]*"|\\{(?:[^{}]|\\{[^{}]*\\})*\\})`,
  ).exec(element);
  return m ? m[1]! : null;
}

/**
 * The opening tag that starts at `at`: up to the first `>` outside braces
 * and quotes — an arrow function in a prop (`(file) => …`) has its own.
 */
function openingTag(code: string, at: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = at; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return code.slice(at, i + 1);
  }
  throw new Error(`unterminated tag at ${at}`);
}

/** What takes the page's drops once a zone is gone, in the same source. */
function replacements(source: string): string[] {
  const code = withoutComments(source);
  return [
    ...[...code.matchAll(/<ChosenFileTarget\b/g)].map((m) =>
      openingTag(code, m.index),
    ),
    ...[...code.matchAll(/<EditorBox\b/g)].map(() => "EditorBox"),
  ];
}

const found = ["src/components", "src/app"]
  .flatMap(sources)
  .map((file) => ({
    file,
    zones: zonesIn(readFileSync(path.join(ROOT, file), "utf8")),
  }))
  .filter(({ zones }) => zones.length > 0);

describe("the page's drops land in a tool's primary zone, never in a secondary one", () => {
  it("health check: the zones are discovered from the source", () => {
    const count = found.reduce((n, f) => n + f.zones.length, 0);
    // 23 on 2026-10-10: 13 worker panels, 8 runners (merge has two), and the
    // two secondary zones.
    expect(count).toBeGreaterThanOrEqual(20);
    expect(count).toBeLessThanOrEqual(60);
  });

  it("positive control: the detector reads each shape", () => {
    const optIn = (src: string) =>
      zonesIn(src).map(({ optsIn }) => ({ optsIn }));
    expect(optIn(`<Dropzone\n  pageTarget\n  onFiles={f}\n/>`)).toEqual([
      { optsIn: true },
    ]);
    expect(optIn(`<Dropzone pageTarget={true} onFiles={f} />`)).toEqual([
      { optsIn: true },
    ]);
    expect(optIn(`<Dropzone pageTarget={false} onFiles={f} />`)).toEqual([
      { optsIn: false },
    ]);
    expect(optIn(`<Dropzone onFiles={f} compact />`)).toEqual([
      { optsIn: false },
    ]);
  });

  it("positive control: branches, props and replacements are read", () => {
    const read = (src: string) =>
      zonesIn(src).map(({ optsIn, branch }) => ({ optsIn, branch }));
    expect(
      read(
        `{file ? (\n  <Chip />\n) : (\n  <Dropzone pageTarget onFiles={f} />`,
      ),
    ).toEqual([{ optsIn: true, branch: true }]);
    expect(read(`<div>\n  <Dropzone pageTarget onFiles={f} />`)).toEqual([
      { optsIn: true, branch: false },
    ]);
    expect(
      prop(`<X accept="application/pdf" refuse={refuse} />`, "accept"),
    ).toBe(`"application/pdf"`);
    expect(
      prop(`<X refuse={(file) => pickRefusal(tool, file)} />`, "refuse"),
    ).toBe(`{(file) => pickRefusal(tool, file)}`);
    const chip = `<ChosenFileTarget\n  file={file}\n  refuse={(file) => pickRefusal(tool, file)}\n  onReplace={(files) => {\n    setFile(files[0] ?? null);\n  }}\n>\n  <div />`;
    expect(replacements(chip)).toEqual([
      chip.slice(0, chip.indexOf("\n>") + 2),
    ]);
    expect(prop(replacements(chip)[0]!, "refuse")).toBe(
      `{(file) => pickRefusal(tool, file)}`,
    );
    expect(replacements(`// <ChosenFileTarget file={file}>`)).toEqual([]);
    expect(replacements(`<EditorBox editor={editorRef} />`)).toEqual([
      "EditorBox",
    ]);
    expect(replacements(`// <EditorBox editor={editorRef} />`)).toEqual([]);
  });

  it("every primary zone opts in", () => {
    const missing = found
      .filter(({ file }) => !(file in SECONDARY))
      .filter(({ zones }) => zones.some((z) => !z.optsIn))
      .map(({ file }) => file);
    expect(
      missing,
      "a tool's primary drop zone does not take the page's drops — pass `pageTarget`, or record it in SECONDARY with the reason it must not",
    ).toEqual([]);
  });

  it("a primary zone that is a branch leaves a target behind it, taking what the zone took", () => {
    const branches = found.flatMap(({ file, zones }) =>
      file in SECONDARY
        ? []
        : zones
            .filter((z) => z.optsIn && z.branch)
            .map((zone) => ({ file, zone })),
    );
    // Health: 13 worker panels and the single-PDF runner on 2026-10-10.
    expect(branches.length).toBeGreaterThanOrEqual(14);
    expect(branches.length).toBeLessThanOrEqual(40);
    const orphaned: string[] = [];
    const mismatched: string[] = [];
    let chips = 0;
    for (const { file, zone } of branches) {
      const after = replacements(readFileSync(path.join(ROOT, file), "utf8"));
      if (after.length === 0) orphaned.push(file);
      for (const chip of after.filter((a) => a.startsWith("<"))) {
        chips++;
        for (const name of ["accept", "refuse"]) {
          const mine = prop(chip, name);
          const zones = prop(zone.text, name);
          if (mine === null || mine !== zones)
            mismatched.push(
              `${file}: ${name} ${mine} where the zone has ${zones}`,
            );
        }
      }
    }
    expect(
      orphaned,
      "a primary zone that is one branch of a condition, and nothing takes the page's drops once it is gone — wrap what replaces it in ChosenFileTarget",
    ).toEqual([]);
    expect(mismatched).toEqual([]);
    // Health: the comparison ran, once per worker panel.
    expect(chips).toBeGreaterThanOrEqual(13);
  });

  it("every secondary zone stays out of the page's drops, and is still there", () => {
    for (const [file, why] of Object.entries(SECONDARY)) {
      const entry = found.find((f) => f.file === file);
      expect(
        entry,
        `${file} no longer renders a zone — delete its entry`,
      ).toBeTruthy();
      expect(
        entry!.zones.every((z) => !z.optsIn),
        `${file}: ${why}`,
      ).toBe(true);
    }
  });
});
