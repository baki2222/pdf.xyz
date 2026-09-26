// @vitest-environment node
/**
 * Repo-wide invariant: tracked text files are stored with LF line endings.
 *
 * Why this exists: a commit written from a Windows tool converted the whole of
 * `.env.worker.example` from LF to CRLF (0 CRs in the base blob, 128 after).
 * The change it needed was two comment lines; the diff was 254 lines and blame
 * was gone. Worse, operators copy that file to the Linux worker as `.env`, and
 * `set -a; . ./.env` then gives every value a trailing `\r` —
 * `PDFXYZ_STORAGE_PROVIDER="s3\r"` — so the daemon reports its providers as
 * malformed or unset. Nothing looked: the repo has no `.gitattributes` and
 * `core.autocrlf` is off, so git stores whatever bytes the tool wrote.
 *
 * WHAT IS READ: git's own classification of the INDEX (`git ls-files --eol`,
 * the `i/` column) — the bytes a clone receives, not this checkout's working
 * tree, which an autocrlf machine may legitimately rewrite. The subjects are
 * every tracked file git considers text; nothing is named.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Tracked files stored with CRLF before this guard existed. The set must EQUAL
 * what the index holds, so converting one to LF fails here until its entry is
 * removed — an exemption that can only shrink. `.gitignore` is read by git,
 * which tolerates CRLF; no shell sources it.
 */
const KNOWN_CRLF = new Set([".gitignore"]);

interface EolEntry {
  index: string;
  path: string;
}

/** Parse `git ls-files --eol -z`: `i/<eol> w/<eol> attr/<attr>\t<path>` per entry. */
function parseEol(output: string): EolEntry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const index = entry.slice(0, tab).split(/\s+/)[0] ?? "";
      return { index, path: entry.slice(tab + 1) };
    });
}

function trackedEol(): EolEntry[] {
  return parseEol(
    execFileSync("git", ["ls-files", "--eol", "-z"], { encoding: "utf8" }),
  );
}

describe("tracked text files are stored with LF", () => {
  it("reads the real index, so an empty listing cannot vacuous-pass", () => {
    const entries = trackedEol();
    expect(entries.length).toBeGreaterThan(1000);
    // Every entry parsed into a known index classification.
    const kinds = new Set(entries.map((e) => e.index));
    expect(
      [...kinds].every((k) => /^i\/(lf|crlf|mixed|none|-text|)$/.test(k)),
      [...kinds].join(","),
    ).toBe(true);
    expect(entries.filter((e) => e.index === "i/lf").length).toBeGreaterThan(
      1000,
    );
  });

  it("positive control: the parser sees a CRLF entry as CRLF", () => {
    const parsed = parseEol(
      "i/crlf  w/crlf  attr/                 \t.env.worker.example\0i/lf    w/lf    attr/                 \ta b.ts\0",
    );
    expect(parsed).toEqual([
      { index: "i/crlf", path: ".env.worker.example" },
      { index: "i/lf", path: "a b.ts" },
    ]);
  });

  it("no tracked text file holds a CR line ending, except the shrinking known set", () => {
    const crlf = trackedEol()
      .filter((e) => e.index === "i/crlf" || e.index === "i/mixed")
      .map((e) => `${e.index} ${e.path}`)
      .sort();
    expect(
      crlf,
      "these tracked files are stored with CRLF. Convert them to LF (`sed -i 's/\\r$//' <file>`), " +
        "or, if an entry of KNOWN_CRLF is now LF, remove it from the set",
    ).toEqual([...KNOWN_CRLF].map((p) => `i/crlf ${p}`).sort());
  });
});
