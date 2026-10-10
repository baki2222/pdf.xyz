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
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();

/** Zones inside an open editor, which take only drops made ON them. */
const SECONDARY: Record<string, string> = {
  "src/components/tools/runner/sign-runner.tsx":
    "the signature-image zone, shown in the editor when the source is Upload: the page's drops replace the PDF being signed",
  "src/components/tools/runner/overlay-runner.tsx":
    "the overlay-PDF zone, shown in the editor until an overlay is chosen: the page's drops replace the base PDF",
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

/** Each `<Dropzone … />` in a source, and whether it opts in. */
function zonesIn(source: string): { optsIn: boolean }[] {
  return [...withoutComments(source).matchAll(/<Dropzone\b[\s\S]*?\/>/g)].map(
    (m) => ({
      optsIn: /\bpageTarget(?!\s*=\s*\{\s*false\s*\})(?=[\s/=])/.test(m[0]),
    }),
  );
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
    expect(zonesIn(`<Dropzone\n  pageTarget\n  onFiles={f}\n/>`)).toEqual([
      { optsIn: true },
    ]);
    expect(zonesIn(`<Dropzone pageTarget={true} onFiles={f} />`)).toEqual([
      { optsIn: true },
    ]);
    expect(zonesIn(`<Dropzone pageTarget={false} onFiles={f} />`)).toEqual([
      { optsIn: false },
    ]);
    expect(zonesIn(`<Dropzone onFiles={f} compact />`)).toEqual([
      { optsIn: false },
    ]);
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
