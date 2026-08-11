// @vitest-environment node
/**
 * Drift guard between what the marketing copy invites and what the product can
 * actually sign anyone into.
 *
 * The homepage's "No account to start" pillar promised "Sign in only when you
 * want to save workspaces and presets" — a sign-in that does not exist, gating
 * saved workspaces and presets that do not exist either. The retention cards
 * were imprecise about something real; this described a product we do not
 * have. It sat one component from the pricing section the whole time
 * `pricing-honesty.test.ts` was being written, surviving because that guard's
 * markers (a price, a tier, SSO, an upgrade CTA) do not include identity
 * language.
 *
 * Same architecture as `pricing-honesty.test.ts`, different ground truth: this
 * repository has no user accounts. The precondition test proves the absence,
 * and the same rule applies — when auth genuinely lands, THAT test fails
 * first, and the right response is to delete or relax the copy rules, not to
 * weaken the copy.
 *
 * The ground truth is three signals together, not one, because a dependency
 * hint is weaker evidence for auth than it is for payment: nobody hand-rolls
 * Stripe, but people hand-roll sessions all the time. A hand-rolled login
 * changes no dependency — it ships a page and an API route. Anchoring on all
 * three (auth dependency, auth page route, auth API route) means a sign-in
 * page cannot ship while this precondition still reads "no auth". Ground truth
 * that is true only in the words it knows is this codebase's best-documented
 * defect.
 *
 * The forbidden list is three families, not the five proposed, because the
 * other two — "sign up" and "create an account" — were measured against the
 * tree and have live HONEST uses, every one a denial: "no sign-up to start"
 * (hero, about, CTA), "No sign-up required" (tool pages), "No sign-up" (the
 * OG image), "nothing to sign up for" and the question "Do I need to create
 * an account?" (FAQ). Telling an invitation from a denial takes negation
 * parsing, which fails in exactly the ways a vocabulary-bound guard fails —
 * so those families are not banned at all rather than banned with grammar,
 * and their coverage is an open owner decision. The three that ARE banned had
 * zero honest uses in the walk: you can only sign IN to an account that
 * exists.
 *
 * Known collision, accepted: this is a PDF-signing product, and signature
 * prose can legitimately produce the bigram — "headers to sign in addition to
 * host" is live in `s3-signer.ts`, outside this walk. No such sentence exists
 * in the copy walk today, and the honest reword when one wants to is to name
 * the object ("sign a PDF in seconds"), which reads better anyway.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  Ground truth: this repository has no user accounts.
 * ------------------------------------------------------------------ */

/** Auth packages whose presence in package.json would mean accounts landed.
 *  Anchored, not substring: "auth" as a substring is everywhere. */
const AUTH_DEPENDENCY_HINTS =
  /^(?:next-auth|better-auth|iron-session|auth0|lucia(?:-auth)?|passport(?:-[a-z0-9-]+)?|amazon-cognito-identity-js)$|^@(?:auth|clerk|auth0|workos-inc|kinde-oss)\/|^@supabase\/(?:auth-helpers|ssr)/i;

/** Page-route directory names whose presence under src/app would mean an
 *  account UI shipped — the signal a hand-rolled login cannot avoid. */
const AUTH_PAGE_ROUTE_HINTS =
  /^\(?(?:log-?in|sign-?in|sign-?up|register|registration|account|profile|auth|log-?out|sign-?out|sso|oauth|user)s?\)?$/i;

/** API route directory names whose presence under src/app/api would mean an
 *  auth backend shipped — the other half of a hand-rolled login. */
const AUTH_API_ROUTE_HINTS =
  /^\(?(?:auth|session|log-?in|log-?out|sign-?in|sign-?up|sign-?out|register|oauth|sso|user|account|me)s?\)?$/i;

/** Every way this repo could plausibly have accounts; empty while it cannot. */
function accountCapabilityEvidence(): string[] {
  const evidence: string[] = [];

  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const name of [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]) {
    if (AUTH_DEPENDENCY_HINTS.test(name)) evidence.push(`dependency: ${name}`);
  }

  const appDir = path.join(ROOT, "src", "app");
  const walk = (dir: string, inApi: boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const nowInApi = inApi || (dir === appDir && entry.name === "api");
      const hints = nowInApi ? AUTH_API_ROUTE_HINTS : AUTH_PAGE_ROUTE_HINTS;
      if (hints.test(entry.name)) {
        evidence.push(
          `${nowInApi ? "api route" : "page route"}: ${path.relative(ROOT, full)}`,
        );
      }
      walk(full, nowInApi);
    }
  };
  walk(appDir, false);

  return evidence;
}

/* ------------------------------------------------------------------ *
 *  The forbidden identity language, while the ground truth holds.
 * ------------------------------------------------------------------ */

/**
 * Banned outright, denials included: none of these had an honest use in the
 * walk when measured (2026-08-10), and honest copy has a move that needs none
 * of these words — "no account", which is also the stronger claim. If a
 * future honest sentence trips one, reword it or relax this rule
 * deliberately; do not teach the rule grammar.
 */
const FORBIDDEN = [
  { label: "a sign-in invitation", pattern: /\bsign[- ]?in\b/i },
  { label: "a log-in invitation", pattern: /\blog[- ]?in\b/i },
  {
    label: "a claim that the visitor has an account",
    pattern: /\byour account\b/i,
  },
] as const;

describe("marketing copy does not invite a sign-in the product does not have", () => {
  it("reads the copy files, so a move cannot quietly empty this suite", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(10);
  });

  it("the repository still has no user accounts (delete/relax the rules below when it does)", () => {
    // The anchor. When auth genuinely lands, this fails FIRST — and the
    // response is to revisit the FORBIDDEN list (sign-in copy becomes
    // legitimate), never to hedge the copy around a still-red guard.
    expect(
      accountCapabilityEvidence(),
      "account capability detected — sign-in copy may now be legitimate; revisit this guard deliberately",
    ).toEqual([]);
  });

  it.each(FORBIDDEN)("no page carries $label", ({ label, pattern }) => {
    const offenders: string[] = [];
    for (const file of copyFiles()) {
      // Flattened: a phrase search has a hole at every wrap point, and the
      // patterns below are multi-word. Proven 2026-08-11 — the banned
      // phrases sat in a walked file split across a line and this guard
      // passed. See `flattenForPhraseSearch`.
      const source = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      const match = pattern.exec(source);
      if (match) offenders.push(`${path.relative(ROOT, file)}: "${match[0]}"`);
    }
    expect(
      offenders,
      `these carry ${label}, on a product with no accounts:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
