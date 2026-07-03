/**
 * Pure, node-free **git provenance reducer** for the release evidence artifact (Phase 47).
 *
 * The CLI entry gathers a few raw git facts behind its spawn seam (the abbreviated commit hash, the
 * checked-out ref name, and whether the working tree is dirty) and hands them here as an untrusted
 * {@link RawGitFacts}. This module is the trust boundary that turns those raw strings into the
 * bounded {@link ReleaseGitProvenance} the artifact records — and it is deliberately paranoid:
 *
 *  - **No raw ref name, ever.** A branch name can be arbitrary text (an operator can name a branch
 *    anything, including something secret-shaped). It is consumed ONLY to compute a bounded
 *    {@link RefClass} and is then discarded — never copied into the output.
 *  - **No remote URL, ever.** A remote URL can embed a host or a credential; the CLI does not even
 *    read it, and this module never accepts one.
 *  - **Bounded commit hash only.** The abbreviated hash is accepted only if it matches the strict
 *    `[0-9a-f]{7,40}` shape (a git object id), and is then capped to 12 chars; anything else — a
 *    path, a URL, a token, an error message the seam mistakenly passed through — reduces to `null`.
 *  - **Honest unknowns.** An absent/undetermined fact is `unknown`/`null`, never a fabricated
 *    `clean` or a guessed class.
 *
 * Every rule is a pure function of its input, so the hostile-input tests can drive it directly.
 */

import {
  type GitCleanliness,
  type RefClass,
  type ReleaseGitProvenance,
} from "./types";

/**
 * The raw git facts the CLI's spawn seam gathers. All fields are UNTRUSTED and may be absent
 * (`undefined`) when the corresponding git command failed or was suppressed. NONE of these raw
 * strings appears in the output; they are reduced to bounded enums here.
 */
export interface RawGitFacts {
  /** The abbreviated commit hash (`git rev-parse --short=12 HEAD`), or `undefined` if unavailable. */
  readonly commit?: string;
  /** The checked-out ref name (`git rev-parse --abbrev-ref HEAD`), or `undefined`. Consumed, never stored. */
  readonly ref?: string;
  /** Whether the working tree had uncommitted changes, or `undefined` if it could not be determined. */
  readonly dirty?: boolean;
  /** True when the checked-out ref is a detached HEAD (git reports `HEAD` as the abbrev ref). */
  readonly detached?: boolean;
}

/** The strict shape of an abbreviated git object id — lowercase hex, 7–40 chars. */
const COMMIT_HASH = /^[0-9a-f]{7,40}$/;

/** Cap the recorded hash to a short, bounded prefix even if a longer one was passed. */
const MAX_COMMIT_LEN = 12;

/**
 * A mainline ref: `main` or `master`, optionally under an `origin/` (or any single-segment remote)
 * prefix, as `git rev-parse --abbrev-ref` can report `origin/main` for a tracked checkout.
 */
const DEFAULT_REF = /^(?:[A-Za-z0-9._-]+\/)?(?:main|master)$/;

/**
 * A release ref: a `release/*` or `hotfix/*` branch, or a `vX.Y[.Z]`-shaped tag/branch. Matched
 * loosely (a leading remote prefix allowed) but only against a bounded, well-known shape — the raw
 * text is never emitted, only the resulting {@link RefClass}.
 */
const RELEASE_REF = /^(?:[A-Za-z0-9._-]+\/)?(?:release|hotfix)\/.+$|^v\d+(?:\.\d+){1,2}(?:[.-].+)?$/;

/**
 * Classify an untrusted ref name into a bounded {@link RefClass}. The input string is used ONLY to
 * pick the class and is never returned. A detached HEAD (or a literal `HEAD`) is `detached`; an
 * empty/absent ref is `unknown`.
 */
export function classifyRef(ref: string | undefined, detached: boolean | undefined): RefClass {
  if (detached === true) return "detached";
  if (typeof ref !== "string") return "unknown";
  const trimmed = ref.trim();
  if (trimmed.length === 0) return "unknown";
  // Git reports a detached HEAD's abbrev-ref as the literal "HEAD".
  if (trimmed === "HEAD") return "detached";
  if (DEFAULT_REF.test(trimmed)) return "default";
  if (RELEASE_REF.test(trimmed)) return "release";
  return "topic";
}

/**
 * Validate + bound an untrusted abbreviated commit hash. Returns a lowercase-hex string of at most
 * {@link MAX_COMMIT_LEN} chars if the input is a well-formed git object id, else `null` (so a path,
 * URL, token, or error message can never be recorded as a "commit").
 */
export function boundCommit(commit: string | undefined): string | null {
  if (typeof commit !== "string") return null;
  const trimmed = commit.trim().toLowerCase();
  if (!COMMIT_HASH.test(trimmed)) return null;
  return trimmed.slice(0, MAX_COMMIT_LEN);
}

/** Reduce the untrusted dirty flag to a bounded {@link GitCleanliness}. */
export function cleanlinessFrom(dirty: boolean | undefined): GitCleanliness {
  if (dirty === true) return "dirty";
  if (dirty === false) return "clean";
  return "unknown";
}

/**
 * Reduce untrusted raw git facts to the bounded {@link ReleaseGitProvenance}. Passing `null`/
 * `undefined` (VCS suppressed with `--no-vcs`, or no facts gathered) yields a fully-`unknown`
 * provenance — the honest "no provenance recorded" state, never a fabricated clean/default.
 */
export function reduceGitProvenance(raw: RawGitFacts | null | undefined): ReleaseGitProvenance {
  const facts = raw ?? {};
  const commit = boundCommit(facts.commit);
  return {
    cleanliness: cleanlinessFrom(facts.dirty),
    refClass: classifyRef(facts.ref, facts.detached),
    commit,
    commitPresent: commit !== null,
  };
}

/** The bounded, fully-unknown provenance — used when VCS facts are suppressed or unavailable. */
export const UNKNOWN_GIT_PROVENANCE: ReleaseGitProvenance = {
  cleanliness: "unknown",
  refClass: "unknown",
  commit: null,
  commitPresent: false,
};
