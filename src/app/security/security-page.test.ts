// @vitest-environment node
/**
 * /security states how files are protected, and every fact on it is read from
 * the code that owns it (audit platform#9, 2026-11-07: the footer's "Security
 * practices" link went to a homepage anchor and /security was a 404).
 *
 * The policy guards in `legal-pages.test.ts` hold this page too (no hand-written
 * duration, no overclaim, footer and sitemap). This file pins what the page
 * must SAY, each against the constant that owns it, so a change to the
 * constant changes the page rather than contradicting it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SecurityPage, { metadata } from "./page";
import PrivacyPage from "@/app/privacy/page";
import {
  ORPHAN_UPLOAD_ERASURE,
  RETENTION_WINDOWS,
} from "@/lib/retention-windows";
import { STORAGE_PROVIDER } from "@/lib/privacy/processors";
import { PASSWORD_QUEUE_LIFETIME } from "@/lib/privacy/job-queue";
import { CSP_SENTENCE } from "@/lib/privacy/site-security";
import { LEGAL_CONTACT, LEGAL_ENTITY, SECURITY_UPDATED } from "@/lib/legal";
import sitemap from "@/app/sitemap";
import { siteConfig } from "@/lib/site";

const html = renderToStaticMarkup(createElement(SecurityPage));
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const text = textOf(html);

describe("/security", () => {
  it("health: the render is the page, not an empty frame", () => {
    expect(text.length).toBeGreaterThan(2000);
    expect(html).toContain("<h1");
  });

  it("is titled for the footer link that leads to it, and is canonical at /security", () => {
    expect(String(metadata.title)).toMatch(/^Security practices/);
    expect(metadata.alternates?.canonical).toMatch(/\/security$/);
  });

  it("states the retention windows the code enforces", () => {
    expect(text).toContain(RETENTION_WINDOWS.outputLink);
    expect(text).toContain(RETENTION_WINDOWS.inputStorageRule);
  });

  it("states an abandoned upload's storage rule as a lower bound, in /privacy's words", () => {
    // Review of 92b65cb0: "erased by a daily storage rule once it is 30 days
    // old" turned /privacy's "can stay ... 30 days or longer" into an implied
    // deadline. One sentence, shared, so the two pages cannot disagree.
    expect(ORPHAN_UPLOAD_ERASURE).toContain(
      `${RETENTION_WINDOWS.inputStorageRule} or longer`,
    );
    expect(text).toContain(ORPHAN_UPLOAD_ERASURE);
    expect(textOf(renderToStaticMarkup(createElement(PrivacyPage)))).toContain(
      ORPHAN_UPLOAD_ERASURE,
    );
  });

  it("names the storage provider, the password lifetime and the site's protections", () => {
    expect(text).toContain(STORAGE_PROVIDER);
    expect(text).toContain(PASSWORD_QUEUE_LIFETIME);
    expect(text).toContain(CSP_SENTENCE);
  });

  it("sends the malware claim to the live answer, and the full account to the policy", () => {
    expect(text).toMatch(/scanned for malware/);
    expect(html).toContain('href="/status"');
    expect(html).toContain('href="/privacy"');
  });

  it("says how to report a problem, and who runs the service", () => {
    expect(html).toContain(`mailto:${LEGAL_CONTACT}`);
    expect(text).toContain(LEGAL_ENTITY.name);
  });

  it("is in the sitemap the crawlers read, dated by the date it prints", () => {
    const entry = sitemap().find(
      (e) => e.url === new URL("/security", siteConfig.url).toString(),
    );
    expect(entry?.lastModified).toBe(SECURITY_UPDATED);
    expect(html).toContain(`dateTime="${SECURITY_UPDATED}"`);
  });
});
