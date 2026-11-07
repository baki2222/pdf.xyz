import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import {
  ORPHAN_UPLOAD_ERASURE,
  RETENTION_WINDOWS,
} from "@/lib/retention-windows";
import { LEGAL_CONTACT, LEGAL_ENTITY, SECURITY_UPDATED } from "@/lib/legal";
import { STORAGE_PROVIDER } from "@/lib/privacy/processors";
import { PASSWORD_QUEUE_LIFETIME } from "@/lib/privacy/job-queue";
import { CSP_SENTENCE } from "@/lib/privacy/site-security";

/**
 * /security — how files are protected, in one page a visitor deciding whether
 * to upload can read (audit platform#9, 2026-11-07). The footer's "Security
 * practices" link went to a homepage anchor, and /security was a 404.
 *
 * It restates no figure: each window, the storage provider, the password
 * lifetime and the site's protections are read from the module that owns
 * them, the same ones /privacy reads. The malware claim points at /status,
 * which renders the live worker's answer — the claim is an observation of
 * production, not a construction (see the note in `legal-pages.test.ts`).
 * `legal-pages.test.ts` holds this page to the policy guards (no hand-written
 * duration, no overclaim); `security/security-page.test.ts` pins each fact to
 * its constant.
 */
const { outputLink: outputWindow } = RETENTION_WINDOWS;

const link = "text-accent underline underline-offset-4";
const strong = "text-fg font-semibold";

export const metadata: Metadata = buildMetadata({
  title: "Security practices",
  description:
    "How pdf.xyz protects your files: many tools never upload them, and server tools use an encrypted connection, check uploads for malware and delete them when the job ends.",
  path: "/security",
});

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security practices"
      updated={SECURITY_UPDATED}
      summary={
        <>
          <strong className={strong}>The short version.</strong> The safest file
          is one that never leaves your device, so many of our tools run
          entirely in your browser. When a tool needs our server, your file
          travels over an encrypted connection, is scanned for malware, and is
          deleted when the job ends. Every tool page says which kind it is
          before you choose a file.
        </>
      }
    >
      <LegalSection id="in-browser" heading="Tools that run in your browser">
        <p>
          These tools read your file on your own device, with code the page has
          already loaded. Nothing about the file — its contents, its name or its
          size — reaches our servers, and closing the tab discards it. The one
          exception is analytics, and only if you allow it: Google Analytics is
          then told which tool you used and a coarse size band of the result,
          never the file, its name or its exact size.{" "}
          <Link href="/status" className={link}>
            The status page
          </Link>{" "}
          lists every tool that works this way.
        </p>
      </LegalSection>

      <LegalSection id="on-our-server" heading="Tools that use our server">
        <p>
          Some work cannot be done in a browser: recognising text in a scan,
          converting office formats, and anything that uses an AI model. For
          these, your file is uploaded over an encrypted connection straight to
          our storage provider, {STORAGE_PROVIDER}, and is scanned for malware
          before any processor touches it;{" "}
          <Link href="/status" className={link}>
            the status page
          </Link>{" "}
          shows whether scanning is running right now.
        </p>
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className={strong}>Your upload is deleted</strong> as soon
            as its job ends, whether it succeeded or failed. An upload that
            never reaches the end of a job is erased by {ORPHAN_UPLOAD_ERASURE}.
          </li>
          <li>
            <strong className={strong}>The result&apos;s download link</strong>{" "}
            stops working after {outputWindow}.
          </li>
          <li>
            <strong className={strong}>No one reads your documents.</strong> No
            person at pdf.xyz opens them in the ordinary course of running the
            service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="passwords" heading="Passwords you type">
        <p>
          The tools that add or remove a PDF password send the password you type
          with the job. {PASSWORD_QUEUE_LIFETIME} While the job runs, our server
          hands the password to the encryption tool through a temporary file in
          the job&apos;s own folder, which is erased when the job ends. It is
          never written to a log, an error message or a result. If a password is
          one you use elsewhere, change it, or use it only for the document.
        </p>
      </LegalSection>

      <LegalSection id="site" heading="The website itself">
        <p>
          Traffic between your browser and this site is encrypted in transit.{" "}
          {CSP_SENTENCE} There are no accounts, so there is no password database
          to break into.
        </p>
      </LegalSection>

      <LegalSection id="limits" heading="What we do not promise">
        <p>
          No service can promise perfect security, and we do not. The largest
          reduction in risk is the design itself: for a tool that runs in your
          browser there is nothing on our servers to breach, because the file
          never left your device. The full account of what is collected, who
          handles it and for how long is in the{" "}
          <Link href="/privacy" className={link}>
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="report" heading="Reporting a security problem">
        <p>
          pdf.xyz is operated by{" "}
          <strong className={strong}>{LEGAL_ENTITY.name}</strong>. If you find a
          vulnerability, or think a file was handled in a way this page does not
          describe, write to{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className={link}>
            {LEGAL_CONTACT}
          </a>{" "}
          with what you saw and how to reproduce it. Please do not test against
          other people&apos;s files or run load against the service.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
