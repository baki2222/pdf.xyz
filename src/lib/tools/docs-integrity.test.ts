// @vitest-environment node
/**
 * The docs census: identifiers the operator docs NAME must still exist.
 *
 * What it checks — env var names in our namespace, `pnpm` script names,
 * repo-rooted file paths, doc-to-doc links, backticked code identifiers, and
 * verify-markers — against the tree they describe. That is where the bulk of
 * doc rot lives: a renamed script, a moved file, a deleted variable, and the
 * doc keeps telling an operator to use it.
 *
 * WHAT IT CANNOT SEE, stated in the same breath: a sentence can become false
 * with every identifier in it intact. The instance that prompted this census
 * was exactly that — `docs/RATE_LIMITING.md` declared the R2 `Content-Length`
 * gap open for three days after `s3.ts` closed it; no symbol moved, no path
 * changed, the sentence simply stopped being true. This census checks that
 * the NOUNS still exist, not that the SENTENCES are still true. Its silence
 * is not a statement about the prose — presenting it as one would be the
 * "no claim in the words I know" failure with a new coat of paint.
 *
 * THE CORPUS IS THE LOAD-BEARING PART, and the first shipped version proved
 * it by failing: it walked TypeScript-and-config under src/scripts/e2e, and
 * its one finding — `PDFXYZ_CLEANUP_RAW_EXPORT`, "no code reads or names
 * this variable" — was a false positive, because the consumer is
 * `cleanup-evidence-notify.sh`, a SHELL SCRIPT under `docs/examples/`,
 * outside both the extension list and the roots. The message reported the
 * guard's reach as the world's state. Three rules came out of that:
 *   1. the corpus includes every file type a consumer can live in here
 *      (.sh, .yml/.yaml, .cron, Dockerfile*, .mjs/.cjs, .json, and the
 *      docs/examples tree itself — templates are consumers);
 *   2. every failure message names the ground truth it checked, so it makes
 *      a claim a reader can disprove instead of unfalsifiable praise;
 *   3. a corpus-proof test asserts the walk really reaches a shell script
 *      and a yaml, so a glob that silently stops matching collapses loudly
 *      instead of turning every finding into a false positive.
 * Markdown is never corpus: prose must not certify prose, and this census's
 * own file is excluded — its BASELINE names identifiers precisely BECAUSE
 * they are missing, and a ground truth containing the instrument's records
 * would certify them into existence (which happened: the finding vanished
 * the moment it was recorded).
 *
 * VERIFY-MARKERS — the narrow mechanism for the prose problem, per-claim and
 * opt-in. A doc may pin a claim to a greppable predicate with an adjacent
 * HTML comment:
 *
 *     <!-- gap-while-absent: /pattern/flags in relative/path -->
 *     <!-- true-while-present: /pattern/flags in relative/path -->
 *
 * gap-while-absent guards a claim of ABSENCE ("X is not implemented") and
 * fires when the pattern APPEARS; true-while-present guards a claim of
 * PRESENCE ("X is enforced") and fires when the pattern DISAPPEARS. The
 * marker firing means "re-read the claim above it", not "the claim is
 * false" — a deliberate comment can trip a pattern, and adjusting the
 * marker is part of the convention. Its honest limit: it covers only claims
 * an author chose to mark, with a predicate the author expected — it
 * supplements the census and never repairs the confession above.
 *
 * ACCEPTANCE TEST FOR A NEW MARKER (owner-adopted, 2026-08-10): every marker
 * is born with one mutate-fire-restore capture — make the predicate true
 * (or, for true-while-present, remove it) in the real target, run this
 * census, capture the marker's own failure message verbatim, restore the
 * target, and verify the restore with git. Foreground, one marker at a
 * time. A marker that has never been seen to fire is a marker nobody
 * should trust — and a marker that fires the day it is installed is a
 * diagnostic that the CLAIM is already false, not a guard: fix the doc
 * first (that firing caught a live instance before this convention's own
 * second target was ever marked).
 *
 * Detector calibration (first contact, 2026-08-10): docs write env and path
 * FAMILIES as `PDFXYZ_X_*` and `ops-bundle*` (a trailing `_`/`-` or a `*`
 * right after the token is a prefix claim — some member must exist, not the
 * literal); WORKER_ARCHITECTURE references modules extensionlessly
 * (`storage/s3` means `storage/s3.ts`); `pnpm` appears as an English noun in
 * prose ("pnpm is pinned"), so commands are only read from code spans; a
 * table introducing `PDFXYZ_..._FAIL_MODE` then abbreviates to `FAIL_MODE`,
 * so a SNAKE token that is the suffix of a real identifier passes.
 *
 * `BASELINE` records findings REPORTED and awaiting an owner scoping
 * decision — remove entries as they are fixed; never add one to ship a new
 * stale reference.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operatorDocs } from "./copy-surface";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  Ground truth: the tree the docs describe.
 * ------------------------------------------------------------------ */

const CODE_ROOTS = [
  "src",
  "scripts",
  "e2e",
  ".github",
  path.join("docs", "examples"),
];
const CODE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|sh|cron)$/;
const isCorpusFile = (name: string) =>
  CODE_FILE.test(name) || name.startsWith("Dockerfile");

/** The ground truth every failure message cites — derived from the real
 *  config above so the description cannot drift from the walk. */
const CORPUS_DESCRIPTION = `${CODE_ROOTS.join(", ")} and the repo root — files matching ${String(CODE_FILE)} or Dockerfile*`;

/** This census's own file. Excluded from the corpus: see the docblock. */
const SELF = path.join(ROOT, "src", "lib", "tools", "docs-integrity.test.ts");

interface Corpus {
  files: string[];
  /** Every identifier-shaped token in the corpus, for word-exact lookups. */
  tokens: Set<string>;
  tokenList: string[];
}

function codeCorpus(): Corpus {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isCorpusFile(entry.name) && full !== SELF) files.push(full);
    }
  };
  for (const root of CODE_ROOTS) {
    const dir = path.join(ROOT, root);
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  }
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && isCorpusFile(entry.name))
      files.push(path.join(ROOT, entry.name));
  }
  const tokens = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /[A-Za-z_$][\w$]*/g,
    )) {
      tokens.add(match[0]);
    }
  }
  return { files, tokens, tokenList: [...tokens] };
}

/* ------------------------------------------------------------------ *
 *  The detectors.
 * ------------------------------------------------------------------ */

/** pnpm's own subcommands — not scripts, never findings. */
const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "update",
  "up",
  "exec",
  "dlx",
  "create",
  "run",
  "test",
  "start",
  "dev",
  "build",
  "why",
  "list",
  "ls",
  "outdated",
  "audit",
  "prune",
  "store",
  "setup",
  "import",
  "rebuild",
  "link",
  "unlink",
  "pack",
  "publish",
  "patch",
  "config",
  "licenses",
  "env",
  "fetch",
  "root",
  "bin",
  "doctor",
  "approve-builds",
]);

/** Local bins a doc may invoke directly through pnpm. */
const LOCAL_BINS = new Set([
  "vitest",
  "playwright",
  "tsx",
  "tsc",
  "eslint",
  "next",
  "prettier",
]);

/** Vendor-console names docs legitimately cite that no code reads. */
const VENDOR_PREFIXES = ["UPSTASH_"];

/** The parts of a doc that hold commands and code, not prose: fenced blocks
 *  plus inline backtick spans. `pnpm` used as an English noun lives outside. */
function codeSpans(text: string): string {
  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  return [...fences, ...inline].join("\n");
}

/** A verify-marker's target: a file's text, a directory's corpus-file text
 *  concatenated, or null when the path names nothing. */
function markerTargetText(full: string): string | null {
  if (!existsSync(full)) return null;
  if (statSync(full).isFile()) return readFileSync(full, "utf8");
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const sub = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(sub);
      else if (isCorpusFile(entry.name) && sub !== SELF)
        chunks.push(readFileSync(sub, "utf8"));
    }
  };
  walk(full);
  return chunks.join("\n");
}

interface DocFinding {
  doc: string;
  kind: "env" | "script" | "path" | "link" | "symbol" | "marker";
  token: string;
  detail: string;
}

function censusFindings(): { findings: DocFinding[]; checked: number } {
  const corpus = codeCorpus();
  const corpusHas = (word: string) => corpus.tokens.has(word);

  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));

  const findings: DocFinding[] = [];
  let checked = 0;

  for (const docPath of operatorDocs()) {
    const doc = path.relative(ROOT, docPath).replace(/\\/g, "/");
    const text = readFileSync(docPath, "utf8");
    const push = (kind: DocFinding["kind"], token: string, detail: string) =>
      findings.push({ doc, kind, token, detail });

    // 1. Env vars in our namespace must be named somewhere in the corpus. A
    //    trailing underscore (docs write `PDFXYZ_X_*` for a family) is a
    //    prefix claim: some member must exist.
    for (const match of text.matchAll(/\bPDFXYZ_[A-Z0-9_]+\b/g)) {
      const token = match[0];
      checked += 1;
      const exists = token.endsWith("_")
        ? corpus.tokenList.some(
            (t) => t.startsWith(token) && t.length > token.length,
          )
        : corpusHas(token);
      if (!exists) {
        push(
          "env",
          token,
          token.endsWith("_")
            ? `no variable in this family is named by any file in the corpus (${CORPUS_DESCRIPTION})`
            : `not named by any file in the corpus (${CORPUS_DESCRIPTION})`,
        );
      }
    }

    // 2. `pnpm X` in a code span must be a script, a builtin, or a local bin.
    for (const match of codeSpans(text).matchAll(
      /\bpnpm (?:run )?([A-Za-z][\w:-]*)/g,
    )) {
      const name = match[1] ?? "";
      checked += 1;
      if (
        !scripts.has(name) &&
        !PNPM_BUILTINS.has(name) &&
        !LOCAL_BINS.has(name)
      ) {
        push(
          "script",
          `pnpm ${name}`,
          `not a package.json script, a pnpm builtin, or a known local bin (${[...LOCAL_BINS].join(", ")})`,
        );
      }
    }

    // 3. Repo-rooted paths must exist. A `*` after the token, or a trailing
    //    `-`/`_`, is a prefix claim (some entry must start with it); a
    //    dotless basename is a module reference (`storage/s3` ⇒ `s3.ts`).
    for (const match of text.matchAll(
      /(?:src|scripts|docs|e2e|public|\.github)\/[\w./\[\]-]+/g,
    )) {
      const raw = match[0];
      if (match.index === undefined) continue;
      const isGlob = text[match.index + raw.length] === "*";
      const token = raw.replace(/[.,;:]+$/, "").replace(/:\d+(?:-\d+)?$/, "");
      if (token.includes("...") || token.includes("*")) continue;
      checked += 1;
      const full = path.join(ROOT, token);
      if (isGlob || /[-_]$/.test(token)) {
        const dir = path.dirname(full);
        const prefix = path.basename(full);
        const hasMember =
          existsSync(dir) &&
          readdirSync(dir).some((entry) => entry.startsWith(prefix));
        if (!hasMember) {
          push(
            "path",
            `${token}*`,
            "no directory entry with this prefix exists (checked from the repo root)",
          );
        }
        continue;
      }
      const resolves =
        existsSync(full) ||
        (!path.basename(full).includes(".") &&
          (existsSync(`${full}.ts`) || existsSync(`${full}.tsx`)));
      if (!resolves) {
        push(
          "path",
          token,
          "nothing exists at this path from the repo root (module resolution tried .ts/.tsx)",
        );
      }
    }

    // 4. Relative markdown links must resolve (external and anchor links skipped).
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? "";
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      checked += 1;
      const file = target.split("#")[0] ?? "";
      if (file && !existsSync(path.resolve(path.dirname(docPath), file))) {
        push("link", target, `no file at this target relative to ${doc}`);
      }
    }

    // 5. Backticked identifiers must exist in the corpus. A SNAKE token also
    //    passes as the SUFFIX of a real identifier (`FAIL_MODE` right after
    //    a table introduces `PDFXYZ_..._FAIL_MODE`).
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
      const span = match[1] ?? "";
      let name: string | null = null;
      let allowSuffix = false;
      if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(span)) {
        if (span.startsWith("PDFXYZ_")) continue; // detector 1's job
        if (VENDOR_PREFIXES.some((prefix) => span.startsWith(prefix))) continue;
        name = span;
        allowSuffix = true;
      } else if (/^[A-Za-z_$][\w$]*\(\)$/.test(span)) {
        name = span.slice(0, -2);
      } else if (/^[a-z][a-zA-Z0-9]*$/.test(span) && /[a-z][A-Z]/.test(span)) {
        name = span;
      }
      if (!name) continue;
      checked += 1;
      const wanted = name;
      const exists =
        corpusHas(wanted) ||
        (allowSuffix && corpus.tokenList.some((t) => t.endsWith(`_${wanted}`)));
      if (!exists) {
        push(
          "symbol",
          span,
          `no file in the corpus (${CORPUS_DESCRIPTION}) mentions this identifier`,
        );
      }
    }

    // 6. Verify-markers: a claim pinned to a greppable predicate. A marker
    //    watching a missing path is itself a finding — a tripwire pointing
    //    at nothing guards nothing.
    for (const match of text.matchAll(
      /<!--\s*(gap-while-absent|true-while-present):\s*\/(.+?)\/([a-z]*)\s+in\s+([^\s>]+)\s*-->/g,
    )) {
      const kind = match[1];
      const body = match[2];
      const flags = match[3] ?? "";
      const target = match[4];
      if (!kind || !body || !target) continue;
      checked += 1;
      const targetText = markerTargetText(path.join(ROOT, target));
      if (targetText === null) {
        push(
          "marker",
          `${kind} in ${target}`,
          "the marker's target path does not exist — it guards nothing",
        );
        continue;
      }
      const hit = new RegExp(body, flags).test(targetText);
      if (kind === "gap-while-absent" && hit) {
        push(
          "marker",
          `/${body}/${flags} in ${target}`,
          "the guarded absence has appeared — re-read the claim above this marker and update the doc",
        );
      } else if (kind === "true-while-present" && !hit) {
        push(
          "marker",
          `/${body}/${flags} in ${target}`,
          "the claimed presence has disappeared — the sentence above this marker may have gone false",
        );
      }
    }
  }

  return { findings, checked };
}

const findingKey = (f: { doc: string; token: string }) =>
  `${f.doc} :: ${f.token}`;

/**
 * Empty. The single first-contact entry (`PDFXYZ_CLEANUP_RAW_EXPORT`) was a
 * FALSE POSITIVE of the narrow corpus — `cleanup-evidence-notify.sh` reads
 * it — and was removed when the corpus learned shell (owner ruling,
 * 2026-08-10). Entries here are REPORTED findings awaiting scoping; remove
 * them as fixes land, and never add one to ship a new stale reference.
 */
const BASELINE: { doc: string; token: string }[] = [];

describe("the operator docs name identifiers that exist", () => {
  it("reads the docs and actually parses identifiers from them", () => {
    // An input the census cannot read must be loud, never a quiet pass: if a
    // regex change stops matching anything, `checked` collapses before any
    // finding does (the contrast-audit lesson — wrong by not reading).
    const { checked } = censusFindings();
    expect(operatorDocs().length).toBeGreaterThanOrEqual(8);
    expect(checked).toBeGreaterThanOrEqual(40);
  });

  it("the corpus really reaches beyond TypeScript (a glob that stops matching collapses here)", () => {
    // The load-bearing part, proven fixture-free: the first corpus missed a
    // shell-script consumer and turned its one finding into a false
    // positive. If these ever fail, every finding is suspect — fix the walk
    // before reading any report.
    const { files } = codeCorpus();
    expect(files.some((f) => f.endsWith(".sh"))).toBe(true);
    expect(files.some((f) => /\.ya?ml$/.test(f))).toBe(true);
    expect(files.some((f) => f.includes(path.join("docs", "examples")))).toBe(
      true,
    );
  });

  it("every named identifier exists, or is in the reported baseline", () => {
    const known = new Set(BASELINE.map(findingKey));
    const fresh = censusFindings().findings.filter(
      (f) => !known.has(findingKey(f)),
    );
    expect(
      fresh,
      `these doc references failed their existence check (each message names the ground truth it checked):\n  ${fresh
        .map((f) => `${f.doc}: [${f.kind}] "${f.token}" — ${f.detail}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("the baseline only shrinks (stale entries are removed as fixes land)", () => {
    const current = new Set(censusFindings().findings.map(findingKey));
    const stale = BASELINE.map(findingKey).filter((k) => !current.has(k));
    expect(
      stale,
      `these baseline entries no longer occur — remove them so the debt is visible:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
