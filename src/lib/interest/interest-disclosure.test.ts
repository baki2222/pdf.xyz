// @vitest-environment node
/**
 * The coupling guard for the interest counter's ruling: **page, button copy,
 * and counter land together or not at all.**
 *
 * The counter was approved on the condition that it is an act the user
 * knowingly performs, not a measurement taken of them — which holds only
 * while two disclosures exist: the `/privacy` §4 bullet (authored by the
 * owner, verbatim) and the plain-sight line under the Notify-me button. This
 * test makes the pairing structural: while the capability exists
 * (`src/app/api/interest/route.ts`), deleting or rewording either disclosure
 * fails the build. If the counter is ever removed, delete this test with it —
 * and the disclosures too, so the page never describes a mechanism that no
 * longer exists.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotifyMe } from "@/components/tools/notify-me";

/**
 * A sentence that says the press tells us "only the name" or "nothing about
 * you" WITHOUT saying it is the count that holds only that.
 *
 * Review, 2026-10-10: the acknowledgement said "We received only the tool's
 * name — nothing about you or your files" and the line under the button
 * "Pressing it sends us the tool's name — nothing about you", while /privacy
 * §4 said — truly — that the request reaches us like any other and so appears
 * in the ordinary logs (IP address, time, user-agent). What is true is
 * narrower: the COUNT holds only the name. Every spelling that shipped is in
 * the corpus below.
 */
const unscopedOnlyTheName = (text: string): string[] =>
  text
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|"|`/)
    .filter(
      (sentence) =>
        /\bnothing about you\b|\breceived only\b|\bsends us\b/i.test(
          sentence,
        ) && !/\bcount\b/i.test(sentence),
    );

const SHIPPED_UNSCOPED = [
  " We received only the tool's name — nothing about you or your files.",
  "Pressing it sends us the tool&apos;s name — nothing about you.",
  " Only the tool's name was sent; nothing about you or your files.",
];

/** The line under the button, as the server renders it before any press. */
const renderedButtonLine = () =>
  renderToStaticMarkup(
    createElement(NotifyMe, {
      toolName: "Chat with PDF",
      toolSlug: "chat-with-pdf",
      checking: false,
    }),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, "src", "app", "api", "interest", "route.ts");

describe("the interest counter never exists without its disclosures", () => {
  it("the capability this guard is scoped to exists (else delete the guard too)", () => {
    expect(existsSync(ROUTE)).toBe(true);
  });

  it("/privacy carries the owner's disclosure bullet, verbatim anchors intact", () => {
    // Whitespace collapsed: a phrase search over JSX source has a hole at
    // every line wrap, and the 2026-10-10 rewrite of the bullet wrapped
    // "the tool's name" across two lines — same words, read as missing.
    const privacy = readFileSync(
      path.join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    // The heading — "you can choose" is the load-bearing phrase: the defence is
    // that it is an act, not a measurement.
    expect(privacy).toContain("One thing you can choose to send us.");
    // The answer to the reader's real question ("does the page do this on its
    // own?") must be in the bullet, not inferred.
    expect(privacy).toContain("Pressing nothing sends nothing.");
    // The scope of what is sent, in the page's own words.
    expect(privacy).toContain("the tool&apos;s name, and nothing else");
  });

  it("the button says what pressing it sends, in plain sight", () => {
    const button = readFileSync(
      path.join(ROOT, "src", "components", "tools", "notify-me.tsx"),
      "utf8",
    );
    // INVERTED 2026-10-10 (review), history kept. This required the line
    // "Pressing it sends us the tool's name — nothing about you." — and so
    // pinned a claim /privacy §4 contradicts: the request reaches our logs
    // with the visitor's IP address and user-agent, like any request. The
    // line now scopes "only the name" to the count and names the logs.
    const line = renderedButtonLine();
    expect(line).toMatch(/\bcount holds only the tool's name\b/i);
    expect(line).toMatch(/\blogs\b/);
    expect(button).not.toContain(
      "Pressing it sends us the tool&apos;s name — nothing about you.",
    );
    // And the beacon carries the slug alone — the one-dimension rule.
    expect(button).toContain("JSON.stringify({ slug: tool.slug })");
  });

  it("positive control: every unscoped 'only the name' line that shipped is caught", () => {
    for (const line of SHIPPED_UNSCOPED)
      expect(unscopedOnlyTheName(line), line).toHaveLength(1);
    // And spared: the same claim, scoped to the count.
    expect(
      unscopedOnlyTheName(
        "We counted only the tool's name; the count holds nothing about you or your files.",
      ),
    ).toEqual([]);
  });

  it("neither line says 'only the name' or 'nothing about you' without the count", () => {
    // Every string the component can show — the line under the button AND
    // the acknowledgement after the press — read from the source, comments
    // out; plus the line as the server renders it.
    const button = readFileSync(
      path.join(ROOT, "src", "components", "tools", "notify-me.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, "");
    // Health: the source still holds an acknowledgement and a line to read.
    expect(button).toMatch(/one more ask for/);
    // \s+, not a space: the line wraps in the source (a phrase search has a
    // hole at every wrap — this one fell into it on its first run).
    expect(button).toMatch(/Google\s+Analytics\s+counts\s+the\s+press/);
    expect(unscopedOnlyTheName(button)).toEqual([]);
    expect(unscopedOnlyTheName(renderedButtonLine())).toEqual([]);
  });

  /*
   * THE OTHER HALF OF THE PRESS, missing from both disclosures until
   * 2026-10-10 (the legal-pages sweep, row 2). The same click that sends the
   * beacon calls `track({ name: "gated_tool_interest", … })`, and for a
   * visitor who allowed analytics that event goes to Google Analytics with
   * its `_ga` client id. The bullet said "No identifier, no time, nothing
   * about you or your device", true of OUR count and silent about Google's.
   * The anchors above stay — what we receive is still the name alone — and
   * these require the second recipient to be named wherever the press is
   * described. Derived: the guard reads the button for the `track` call, so
   * removing the event retires the requirement instead of leaving it stale.
   */
  it("while the press is tracked, both disclosures say analytics counts it too", () => {
    const button = readFileSync(
      path.join(ROOT, "src", "components", "tools", "notify-me.tsx"),
      "utf8",
    );
    const tracked = /track\(\{\s*name:\s*"gated_tool_interest"/.test(button);
    // Positive control on the derivation: the event exists today.
    expect(tracked).toBe(true);
    if (!tracked) return;
    const privacy = readFileSync(
      path.join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    );
    const bullet = privacy.slice(
      privacy.indexOf("One thing you can choose to send us."),
      privacy.indexOf(
        "</li>",
        privacy.indexOf("One thing you can choose to send us."),
      ),
    );
    expect(bullet).toMatch(/Google\s+Analytics/);
    // The button's own line, under the button, before the press — read as
    // rendered since 2026-10-10: it was a slice of the source from
    // "Pressing it sends us", which the line no longer says, and a missing
    // anchor slices from the END of the file (indexOf -1).
    expect(renderedButtonLine()).toMatch(/Google\s+Analytics/);
  });

  it("the analytics claim the disclosure sits beside is still present", () => {
    // The pairing this pins was RE-DECIDED on 2026-08-25, exactly the way the
    // previous comment demanded — loudly, when this test fired on the edit.
    // Until then the neighbour bullet read "No product analytics leave your
    // device." and the interest beacon drew its contrast from that absolute.
    // Consent-gated Google Analytics replaced the absolute, and the contrast
    // survives inverted: the analytics bullet describes the one channel that
    // needs consent, and the interest beacon remains the one channel that
    // does not — because it is user-initiated, first-party, and carries a
    // single public dimension (the tool slug). If the headline below changes
    // again, both halves of that contrast need re-reading, not just this
    // string.
    const privacy = readFileSync(
      path.join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    );
    expect(privacy).toContain("Product analytics — only after you say yes.");
  });
});
