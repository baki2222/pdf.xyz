// @vitest-environment node
/**
 * The docs census: identifiers the operator docs NAME must still exist.
 *
 * What it checks — env var names in our namespace, `pnpm` script names,
 * repo-rooted file paths, doc-to-doc links, and backticked code identifiers —
 * against the tree they describe. That is where the bulk of doc rot lives:
 * a renamed script, a moved file, a deleted variable, and the doc keeps
 * telling an operator to use it.
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
 * Scope (cry-wolf doctrine — narrow and true beats broad and weakened):
 *  - env vars: `PDFXYZ_*` only. `UPSTASH_*` etc. name fields in a vendor's
 *    console, not variables this repo reads.
 *  - paths: repo-rooted under src/ scripts/ docs/ e2e/ public/ .github/ —
 *    a VPS path in a runbook (`/opt/...`, `/etc/systemd/...`) describes
 *    another machine and is invisible here.
 *  - symbols: backticked SCREAMING_SNAKE, `name()`-form, and camelCase with
 *    two humps or more. A single lowercase word in backticks (`redis`,
 *    `open`, `disabled`) is usually a VALUE or plain English, not a symbol.
 *  - ground truth is the raw text of the code tree (src, scripts, e2e,
 *    .github, root config files), comments included: "exists in the repo"
 *    is the claim being checked, nothing finer.
 *
 * Calibrated against the real docs on first contact, because a detector that
 * has never seen its corpus reports its own assumptions: docs write env and
 * path FAMILIES as `PDFXYZ_X_*` and `ops-bundle*` (a trailing `_`/`-` or a
 * `*` right after the token is a prefix claim — some member must exist, not
 * the literal); WORKER_ARCHITECTURE references modules extensionlessly
 * (`storage/s3` means `storage/s3.ts`); `pnpm` appears as an English noun in
 * prose ("pnpm is pinned"), so commands are only read from code spans; and a
 * table introducing `PDFXYZ_..._FAIL_MODE` then abbreviates to `FAIL_MODE`,
 * so a SNAKE token that is the suffix of a real identifier passes.
 *
 * `BASELINE` records what the census found on first contact (2026-08-10),
 * REPORTED and awaiting an owner scoping decision — remove entries as they
 * are fixed; never add one to ship a new stale reference.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operatorDocs } from "./copy-surface";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  Ground truth: the code tree the docs describe.
 * ------------------------------------------------------------------ */

const CODE_ROOTS = ["src", "scripts", "e2e", ".github"];
const CODE_FILE = /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml)$/;

/** This census's own file. Excluded from the corpus: its BASELINE names
 *  identifiers precisely BECAUSE they are missing, and a ground truth that
 *  includes the instrument's records would certify them into existence —
 *  the finding vanished the moment it was recorded. */
const SELF = path.join(ROOT, "src", "lib", "tools", "docs-integrity.test.ts");

/** Raw text of every code file, concatenated once for word-boundary lookups. */
function codeCorpus(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CODE_FILE.test(entry.name) && full !== SELF)
        chunks.push(readFileSync(full, "utf8"));
    }
  };
  for (const root of CODE_ROOTS) {
    const dir = path.join(ROOT, root);
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  }
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && (CODE_FILE.test(entry.name) || entry.name.startsWith("Dockerfile"))) {
      chunks.push(readFileSync(path.join(ROOT, entry.name), "utf8"));
    }
  }
  return chunks.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ *
 *  The detectors.
 * ------------------------------------------------------------------ */

/** pnpm's own subcommands — not scripts, never findings. */
const PNPM_BUILTINS = new Set([
  "install", "i", "add", "remove", "rm", "update", "up", "exec", "dlx",
  "create", "run", "test", "start", "dev", "build", "why", "list", "ls",
  "outdated", "audit", "prune", "store", "setup", "import", "rebuild",
  "link", "unlink", "pack", "publish", "patch", "config", "licenses",
  "env", "fetch", "root", "bin", "doctor", "approve-builds",
]);

/** Local bins a doc may invoke directly through pnpm. */
const LOCAL_BINS = new Set(["vitest", "playwright", "tsx", "tsc", "eslint", "next", "prettier"]);

/** Vendor-console names docs legitimately cite that no code reads. */
const VENDOR_PREFIXES = ["UPSTASH_"];

/** The parts of a doc that hold commands and code, not prose: fenced blocks
 *  plus inline backtick spans. `pnpm` used as an English noun lives outside. */
function codeSpans(text: string): string {
  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  return [...fences, ...inline].join("\n");
}

interface DocFinding {
  doc: string;
  kind: "env" | "script" | "path" | "link" | "symbol";
  token: string;
  detail: string;
}

function censusFindings(): { findings: DocFinding[]; checked: number } {
  const corpus = codeCorpus();
  const corpusHas = (word: string) =>
    new RegExp(`\\b${escapeRegExp(word)}\\b`).test(corpus);

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

    // 1. Env vars in our namespace must be read somewhere in the tree. A
    //    trailing underscore (docs write `PDFXYZ_X_*` for a family) is a
    //    prefix claim: some member must exist.
    for (const match of text.matchAll(/\bPDFXYZ_[A-Z0-9_]+\b/g)) {
      const token = match[0];
      checked += 1;
      const exists = token.endsWith("_")
        ? new RegExp(`\\b${escapeRegExp(token)}[A-Z0-9]`).test(corpus)
        : corpusHas(token);
      if (!exists) {
        push(
          "env",
          token,
          token.endsWith("_")
            ? "no variable in this family exists in the code"
            : "no code reads or names this variable",
        );
      }
    }

    // 2. `pnpm X` in a code span must be a script, a builtin, or a local bin.
    for (const match of codeSpans(text).matchAll(
      /\bpnpm (?:run )?([A-Za-z][\w:-]*)/g,
    )) {
      const name = match[1] ?? "";
      checked += 1;
      if (!scripts.has(name) && !PNPM_BUILTINS.has(name) && !LOCAL_BINS.has(name)) {
        push("script", `pnpm ${name}`, "package.json has no such script");
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
          push("path", `${token}*`, "no entry with this prefix exists");
        }
        continue;
      }
      const resolves =
        existsSync(full) ||
        (!path.basename(full).includes(".") &&
          (existsSync(`${full}.ts`) || existsSync(`${full}.tsx`)));
      if (!resolves) {
        push("path", token, "this path does not exist in the repo");
      }
    }

    // 4. Relative markdown links must resolve (external and anchor links skipped).
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? "";
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      checked += 1;
      const file = target.split("#")[0] ?? "";
      if (file && !existsSync(path.resolve(path.dirname(docPath), file))) {
        push("link", target, "the linked file does not exist");
      }
    }

    // 5. Backticked identifiers must exist in the code tree. A SNAKE token
    //    also passes as the SUFFIX of a real identifier (`FAIL_MODE` right
    //    after a table introduces `PDFXYZ_..._FAIL_MODE`).
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
      const exists =
        corpusHas(name) ||
        (allowSuffix && new RegExp(`\\w_${escapeRegExp(name)}\\b`).test(corpus));
      if (!exists) {
        push("symbol", span, "no code defines or mentions this identifier");
      }
    }
  }

  return { findings, checked };
}

const findingKey = (f: { doc: string; token: string }) => `${f.doc} :: ${f.token}`;

/**
 * First contact (2026-08-10): reported, awaiting owner scoping. Remove
 * entries as fixes land; the shrink test below makes a lingering entry loud.
 *
 * The one entry: DEPLOYMENT.md's cleanup example tells the operator to set
 * `PDFXYZ_CLEANUP_RAW_EXPORT`, and no code reads it — the variables that
 * exist are the `PDFXYZ_CLEANUP_EVIDENCE_*` family. An operator following
 * the worked example sets a variable nothing honors.
 */
const BASELINE: { doc: string; token: string }[] = [
  { doc: "docs/DEPLOYMENT.md", token: "PDFXYZ_CLEANUP_RAW_EXPORT" },
];

describe("the operator docs name identifiers that exist", () => {
  it("reads the docs and actually parses identifiers from them", () => {
    // An input the census cannot read must be loud, never a quiet pass: if a
    // regex change stops matching anything, `checked` collapses before any
    // finding does (the contrast-audit lesson — wrong by not reading).
    const { checked } = censusFindings();
    expect(operatorDocs().length).toBeGreaterThanOrEqual(8);
    expect(checked).toBeGreaterThanOrEqual(40);
  });

  it("every named identifier exists, or is in the reported baseline", () => {
    const known = new Set(BASELINE.map(findingKey));
    const fresh = censusFindings().findings.filter((f) => !known.has(findingKey(f)));
    expect(
      fresh,
      `these are named by a doc and exist nowhere in the tree it describes:\n  ${fresh
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
