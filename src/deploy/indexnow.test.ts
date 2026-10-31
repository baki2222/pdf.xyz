// @vitest-environment node
/**
 * IndexNow: which URLs publish tells Bing about, with which key, and when.
 *
 * Three things go wrong here without failing anything else. A second key file
 * (or a key file whose body drifted from its name) makes IndexNow refuse every
 * submission with a 403 that reads like the engine's problem. A submit step
 * that runs BEFORE the deploy holds points Bing at pages that do not exist
 * yet. And a snapshot taken after the deploy diffs the new sitemap against
 * itself, so every run reports "nothing changed" — a green that is never
 * true. The pure functions are pinned below; the wiring is pinned on the
 * workflow's EXECUTABLE lines in step order; the served key file is pinned in
 * e2e/smoke.spec.ts, against the build.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedUrls,
  findIndexNowKey,
  freshSitemapUrl,
  indexNowPayload,
  sitemapEntries,
} from "../../scripts/indexnow-submit.mjs";

const ROOT = process.cwd();

function sitemap(entries: [string, string?][]): string {
  return `<urlset>${entries
    .map(
      ([loc, lastmod]) =>
        `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`,
    )
    .join("")}</urlset>`;
}

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "indexnow-"));
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(dir, name), body);
  return dir;
}

describe("the IndexNow key", () => {
  it("public/ serves exactly one key file, whose body is its own name", () => {
    const key = findIndexNowKey(path.join(ROOT, "public"));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(
      readFileSync(path.join(ROOT, "public", `${key}.txt`), "utf8").trim(),
    ).toBe(key);
  });

  it("refuses none, two, or a body that is not its name (controls)", () => {
    const a = "0123456789abcdef0123456789abcdef";
    const b = "fedcba9876543210fedcba9876543210";
    expect(() => findIndexNowKey(dirWith({ "dk.txt": "x" }))).toThrow(
      /found 0/,
    );
    expect(() =>
      findIndexNowKey(dirWith({ [`${a}.txt`]: a, [`${b}.txt`]: b })),
    ).toThrow(/found 2/);
    expect(() => findIndexNowKey(dirWith({ [`${a}.txt`]: b }))).toThrow(
      /found 0/,
    );
    expect(findIndexNowKey(dirWith({ [`${a}.txt`]: `${a}\n` }))).toBe(a);
  });
});

describe("which URLs are submitted", () => {
  const before = sitemap([
    ["https://pdf.xyz/", undefined],
    ["https://pdf.xyz/guides/a", "2026-10-01"],
    ["https://pdf.xyz/guides/b", "2026-10-01"],
  ]);

  it("new URLs, and URLs whose lastmod moved — not the unchanged ones", () => {
    const after = sitemap([
      ["https://pdf.xyz/", undefined],
      ["https://pdf.xyz/guides/a", "2026-10-31"],
      ["https://pdf.xyz/guides/b", "2026-10-01"],
      ["https://pdf.xyz/tools/new-tool", undefined],
    ]);
    expect(changedUrls(before, after)).toEqual([
      "https://pdf.xyz/guides/a",
      "https://pdf.xyz/tools/new-tool",
    ]);
  });

  it("a sitemap diffed against itself submits nothing", () => {
    expect(changedUrls(before, before)).toEqual([]);
  });

  it("reads the sitemap past the edge cache: a unique query string each time", () => {
    // The edge held /sitemap.xml at 110 URLs while the origin served 114
    // (2026-10-31). A cache key without a query is the edge's copy.
    const a = freshSitemapUrl("https://pdf.xyz", "1");
    const b = freshSitemapUrl("https://pdf.xyz", "2");
    expect(a).toMatch(/^https:\/\/pdf\.xyz\/sitemap\.xml\?./);
    expect(a).not.toBe(b);
    expect(freshSitemapUrl("https://pdf.xyz")).not.toBe(
      "https://pdf.xyz/sitemap.xml",
    );
  });

  it("reads every entry, with or without a lastmod", () => {
    expect([...sitemapEntries(before)]).toEqual([
      ["https://pdf.xyz/", ""],
      ["https://pdf.xyz/guides/a", "2026-10-01"],
      ["https://pdf.xyz/guides/b", "2026-10-01"],
    ]);
  });

  it("the payload names the key file at the host root, and refuses a foreign URL", () => {
    const key = "0123456789abcdef0123456789abcdef";
    expect(
      indexNowPayload("https://pdf.xyz", key, ["https://pdf.xyz/tools"]),
    ).toEqual({
      host: "pdf.xyz",
      key,
      keyLocation: `https://pdf.xyz/${key}.txt`,
      urlList: ["https://pdf.xyz/tools"],
    });
    expect(() =>
      indexNowPayload("https://pdf.xyz", key, ["https://example.com/"]),
    ).toThrow(/not on pdf\.xyz/);
  });
});

/** The workflow's steps in order, comments removed: a comment is not wiring. */
function steps(yaml: string): { name: string; body: string }[] {
  const executable = yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  return executable
    .split(/\n(?=\s{6}- name: )/)
    .slice(1)
    .map((chunk) => ({
      name: /- name: (.+)/.exec(chunk)![1]!.trim(),
      body: chunk,
    }));
}

describe("publish.yml wiring", () => {
  const all = steps(
    readFileSync(path.join(ROOT, ".github/workflows/publish.yml"), "utf8"),
  );
  const index = (test: (body: string) => boolean) =>
    all.findIndex((s) => test(s.body));

  it("snapshots the sitemap before the deploy and submits after the deploy holds", () => {
    // Health check: a split that found no steps would make every index -1.
    expect(
      all.length,
      "publish.yml parsed to implausibly few steps",
    ).toBeGreaterThan(8);

    // The snapshot must miss the edge cache too (a query string), or it is
    // whatever Cloudflare held — possibly the very copy the submit reads.
    const snapshot = index((b) =>
      /curl[^\n]*\/sitemap\.xml\?[^\n]*-o \/tmp\/sitemap-before\.xml/.test(b),
    );
    const deploy = index((b) => /COOLIFY_TOKEN/.test(b));
    const submit = index((b) =>
      /node scripts\/indexnow-submit\.mjs --before=\/tmp\/sitemap-before\.xml/.test(
        b,
      ),
    );
    expect(
      snapshot,
      "no step saves the pre-deploy sitemap",
    ).toBeGreaterThanOrEqual(0);
    expect(deploy, "no deploy step found").toBeGreaterThanOrEqual(0);
    expect(submit, "no step runs the IndexNow submit").toBeGreaterThanOrEqual(
      0,
    );
    expect(
      snapshot,
      "the snapshot must be read before the deploy",
    ).toBeLessThan(deploy);
    expect(
      submit,
      "submitting before the deploy holds points Bing at pages that are not live",
    ).toBeGreaterThan(deploy);
    // Both run on the same ref as the deploy, or the diff has nothing to compare.
    for (const i of [snapshot, submit])
      expect(all[i]!.body).toContain("if: github.ref == 'refs/heads/main'");
  });
});
