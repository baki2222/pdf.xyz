// @vitest-environment node
/**
 * Drift guard between what the MARKETING copy sells and what the product can
 * actually take money for.
 *
 * The homepage carried a three-tier price list — a monthly price, an
 * "Upgrade" button, an enterprise tier with SSO/SAML — while the repository
 * contained no billing system, no accounts, and no way to pay. The Terms page
 * says, correctly, that the service is free. A named legal entity publishing
 * prices for a product that cannot charge is a consumer-protection problem,
 * not a marketing flourish — the #33/#44 defect class, landing on the one page
 * where it is worst.
 *
 * Same architecture as `marketing-honesty.test.ts`, with a different ground
 * truth. That guard anchors on an ENGINE's own disclaimer; this one anchors on
 * a capability the repository as a whole does not have: taking payment. The
 * precondition test below proves that absence the same way "the engine still
 * disclaims it" does — so when billing genuinely lands, THAT test fails first,
 * and the right response is to delete or relax the copy rule, not to weaken
 * the copy.
 *
 * Deliberately narrow. It does not judge marketing tone — it forbids the
 * concrete sell-language of a purchasable product: a literal price, a billing
 * cadence, an upgrade CTA, enterprise-auth claims, tier-selling pitches, and a
 * "most popular" tier badge. Every one of these existed in the pre-fix file,
 * so the guard was measured against the defect rather than assumed.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFiles, withoutComments } from "./copy-surface";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  Ground truth: this repository cannot take a payment.
 * ------------------------------------------------------------------ */

/** Payment providers whose presence in package.json would mean billing landed. */
const PAYMENT_DEPENDENCY_HINTS =
  /stripe|paddle|lemonsqueezy|lemon-squeezy|braintree|chargebee|paypal|razorpay|checkout/i;

/** Route-directory names whose presence under src/app would mean billing landed. */
const PAYMENT_ROUTE_HINTS = /^(checkout|billing|subscribe|payment|purchase)s?$/i;

/** Every way this repo could plausibly take money; empty while it cannot. */
function paymentCapabilityEvidence(): string[] {
  const evidence: string[] = [];

  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  for (const name of [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]) {
    if (PAYMENT_DEPENDENCY_HINTS.test(name)) evidence.push(`dependency: ${name}`);
  }

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (PAYMENT_ROUTE_HINTS.test(entry.name)) {
        evidence.push(`route: ${path.relative(ROOT, full)}`);
      }
      walk(full);
    }
  };
  walk(path.join(ROOT, "src", "app"));

  return evidence;
}

/* ------------------------------------------------------------------ *
 *  The forbidden sell-language, while the ground truth holds.
 * ------------------------------------------------------------------ */

/**
 * Each marker existed in the pre-fix pricing section (or FAQ), so this list was
 * measured against the real defect. `SSO`/`SAML` are word-bounded because
 * "PROCESSOR" contains the letters `SSO` — an unbounded scan cries wolf.
 */
const FORBIDDEN = [
  { label: "a literal price", pattern: /\$\s?\d/ },
  { label: "a billing cadence", pattern: /\bper (month|year)\b|\/\s?mo\b/i },
  { label: "an enterprise-auth claim", pattern: /\bSSO\b|\bSAML\b/ },
  { label: "an upgrade CTA", pattern: /\bupgrade to \w+/i },
  {
    label: "an upsell pitch",
    pattern: /\bupgrade\b[^.!?]*\b(scale|plan|tier|pro)\b/i,
  },
  {
    label: "a tier-selling pitch",
    pattern: /\b(Pro|Team|Premium|Business|Enterprise) (unlocks|includes|adds|plan|tier)\b/,
  },
  { label: "a most-popular tier badge", pattern: /\bmost popular\b/i },
] as const;

describe("marketing copy does not sell what the product cannot charge for", () => {
  it("reads the copy files, so a move cannot quietly empty this suite", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(10);
  });

  it("the repository still cannot take a payment (delete/relax the rule below when it can)", () => {
    // The anchor. When billing genuinely lands, this fails FIRST — and the
    // response is to revisit the FORBIDDEN list (prices become legitimate),
    // never to hedge the copy around a still-red guard.
    expect(
      paymentCapabilityEvidence(),
      "payment capability detected — pricing copy may now be legitimate; revisit this guard deliberately",
    ).toEqual([]);
  });

  it.each(FORBIDDEN)("no page carries $label", ({ label, pattern }) => {
    const offenders: string[] = [];
    for (const file of copyFiles()) {
      const source = withoutComments(readFileSync(file, "utf8"));
      const match = pattern.exec(source);
      if (match) offenders.push(`${path.relative(ROOT, file)}: "${match[0]}"`);
    }
    expect(
      offenders,
      `these carry ${label}, on a product that cannot take payment:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
