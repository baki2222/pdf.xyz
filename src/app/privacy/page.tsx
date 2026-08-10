import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { tools } from "@/lib/tools";
import { LEGAL_CONTACT, LEGAL_ENTITY, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "What pdf.xyz does with your files. Most tools never upload anything; the rest process on a worker that deletes the upload when the job ends and stops serving the result after an hour. No accounts, no advertising, no sale of personal data.",
  path: "/privacy",
});

/**
 * Every number and claim on this page is derived from the code that implements
 * it, not written alongside it.
 *
 * The counts come from the catalogue's `processing` field, and the retention
 * windows from `DEFAULT_RETENTION` — the same constants the API enforces. A
 * policy is the highest-stakes place in a product to state something that is not
 * true, and this repository has twice shipped a promise it did not keep: a
 * pipeline description claiming every file was malware-scanned when no scanner
 * existed, and a homepage claiming layout-preserving translation the engine
 * explicitly disclaims. Deriving the figures means a change to the behaviour
 * changes this page, instead of silently contradicting it.
 */
const counts = tools.reduce<Record<string, number>>((acc, tool) => {
  acc[tool.processing] = (acc[tool.processing] ?? 0) + 1;
  return acc;
}, {});

const inBrowser = counts.client ?? 0;
const onWorker = (counts.server ?? 0) + (counts.ai ?? 0) + (counts.hybrid ?? 0);

/**
 * Number and unit as ONE expression.
 *
 * Split across a JSX boundary — `{minutes} minutes` — the leading space is
 * eaten when the expression and the word fall either side of a line break, and
 * the page renders "60minutes". It reads as carelessness, which is the one
 * quality a policy cannot afford.
 */
const inputWindow = `${DEFAULT_RETENTION.inputTtlMinutes} minutes`;
const outputWindow = `${DEFAULT_RETENTION.outputTtlMinutes} minutes`;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={LEGAL_UPDATED}
      summary={
        <>
          <strong className="font-semibold text-white">
            The short version.
          </strong>{" "}
          {inBrowser} of our {tools.length} tools do their work entirely inside
          your browser — those files are never uploaded, so we never receive
          them. The remaining {onWorker} send your file to a processing worker,
          which deletes it when the job ends and stops serving the result after{" "}
          {outputWindow}. There are no accounts, no advertising, and no sale or
          sharing of personal information. Each tool&apos;s page says which kind
          it is before you upload anything.
        </>
      }
    >
      <LegalSection id="who-we-are" heading="1. Who we are">
        <p>
          pdf.xyz is operated by{" "}
          <strong className="font-semibold text-white">
            {LEGAL_ENTITY.name}
          </strong>
          , a limited liability company registered in{" "}
          {`${LEGAL_ENTITY.jurisdiction} `}(&ldquo;we&rdquo;, &ldquo;us&rdquo;).
        </p>
        <address className="text-slate-400 not-italic">
          {LEGAL_ENTITY.address.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
        <p>
          For anything in this policy, including requests about your data, write
          to{" "}
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="text-violet-300 underline underline-offset-4"
          >
            {LEGAL_CONTACT}
          </a>
          . It is a monitored address, not a formality.
        </p>
        <p>
          Where this policy uses terms from the UK and EU General Data
          Protection Regulation, {LEGAL_ENTITY.name} is the <em>controller</em>{" "}
          for the limited personal data described below.
        </p>
      </LegalSection>

      <LegalSection id="files" heading="2. Your files">
        <p>This is the part most people are asking about, so it comes first.</p>
        <p>
          <strong className="font-semibold text-white">
            Tools that run in your browser ({inBrowser} of {tools.length}).
          </strong>{" "}
          The file is opened and processed by code running on your own device.
          It is not sent to us, and we could not read it if we wanted to.
          Closing the tab discards it. Nothing about the file&apos;s contents,
          name, or size reaches our servers.
        </p>
        <p>
          <strong className="font-semibold text-white">
            Tools that use a processing worker ({onWorker} of {tools.length}).
          </strong>{" "}
          Some work cannot be done in a browser — optical character recognition,
          office-format conversion, and anything using an AI model. For these,
          your file is uploaded over an encrypted connection to storage we
          control, scanned for malware, processed, and then removed on this
          timetable:
        </p>
        {/*
          This says "scanned for malware" plainly, and may do so, because the claim
          no longer depends on configuration. PDFXYZ_WORKER_REQUIRE_SCAN arms a
          guardrail that REFUSES TO RUN when no scanner is configured, so a
          deployment serving this page necessarily has one. That is why the
          static page can assert it: not because a scanner happens to be wired,
          but because a scanner-less deployment does not exist.

          It briefly said "may be scanned … see /status" instead. That was true
          and weaker than reality, and the right fix was not better wording — it
          was making the bad state unreachable. If the guardrail is ever
          disarmed, this sentence goes back to being configuration-dependent and
          must change with it.

          Where the guard lives: `worker:release-gate` runs `ops-check`, which
          exits 4 when scanning is required but not active, so a promotion
          cannot carry this claim past a dead scanner. See legal-pages.test.ts.
        */}
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className="font-semibold text-white">
              The uploaded file is actively deleted
            </strong>{" "}
            as soon as the job reaches an end — success or failure — and in any
            case within {inputWindow}. If a job hits a temporary error and is
            retried, the file is kept for that retry rather than re-uploaded.
          </li>
          <li>
            <strong className="font-semibold text-white">
              The result stops being downloadable after {outputWindow}.
            </strong>{" "}
            After that the link returns an error and nobody can retrieve it,
            including us. The stored copy is then erased by a storage rule that
            runs on a daily cycle, so the bytes typically survive a few hours
            longer than the link does. We would rather say that than round it to
            a number that sounds better.
          </li>
          <li>
            <strong className="font-semibold text-white">
              A record of the job — including your file&apos;s name — is kept
              for about 24 hours
            </strong>{" "}
            so the system can report status, avoid duplicating work, and retry
            safely. It does not contain your document&apos;s contents.
          </li>
          <li>
            Nothing here is used to train any model — not ours, and not a
            provider&apos;s.
          </li>
        </ul>
        <p>
          We do not read your documents, and no person at pdf.xyz opens them in
          the ordinary course of running the service.
        </p>
        <p>
          <strong className="font-semibold text-white">
            One case worth naming.
          </strong>{" "}
          If you use the tools that add or remove a PDF password, the password
          you type is part of the instruction sent to the worker, and it sits in
          that job record for the same ~24 hours. It is never written to a log,
          an error message, a filename, or a result. Still: if a password is one
          you use elsewhere, change it, or use it only for the document.
        </p>
        <p>
          Every tool page states which of these two applies <em>before</em> you
          choose a file, and{" "}
          <Link
            href="/status"
            className="text-violet-300 underline underline-offset-4"
          >
            the status page
          </Link>{" "}
          lists them all.
        </p>
      </LegalSection>

      <LegalSection id="ai" heading="3. Tools that use an AI model">
        <p>
          Our AI tools — summarising, translating, answering questions about a
          document, and structured extraction — work from the{" "}
          <strong className="font-semibold text-white">text</strong> of your
          PDF. The worker extracts that text and sends it to a third-party AI
          provider to produce the answer. The PDF file itself is not sent to the
          provider.
        </p>
        <p>
          Two details we would rather state than have you discover. Only text
          the PDF already contains as text is sent — we do not run character
          recognition to manufacture text from a scan, and a scanned document is
          refused rather than silently half-processed. And for{" "}
          <strong className="font-semibold text-white">Chat with PDF</strong>,
          the document&apos;s text is held briefly in the provider&apos;s cache
          between your questions, so a follow-up does not resend the whole
          document; that cache lasts minutes, not days.
        </p>
        <p>
          We use providers under agreements that prohibit training on data sent
          through the API. We cannot control what a provider does beyond those
          terms, so if a document is sensitive enough that this matters, use one
          of the in-browser tools instead, or do not use the AI tools for it.
        </p>
      </LegalSection>

      <LegalSection id="what-we-collect" heading="4. What else we collect">
        <p>Beyond file processing, the data we handle is deliberately small.</p>
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className="font-semibold text-white">
              Ordinary server logs.
            </strong>{" "}
            Our hosting and storage providers record the technical details every
            web request produces — IP address, time, the page or endpoint
            requested, browser user-agent. These are used to operate and secure
            the service, including to detect abuse, and are retained for a short
            period by those providers.
          </li>
          <li>
            <strong className="font-semibold text-white">
              A job identifier.
            </strong>{" "}
            Worker tools create a job with a random identifier so your browser
            can poll for the result. It is not linked to you.
          </li>
          <li>
            <strong className="font-semibold text-white">
              No product analytics leave your device.
            </strong>{" "}
            The site counts things like which tools get used, and that counting
            goes nowhere: in the shipped build it is wired to a sink that
            discards it. There is no analytics vendor, no advertising pixel, and
            no error-tracking SDK anywhere in the site. The whole dependency
            list is ten packages, none of them a tracker.
          </li>
          <li>
            <strong className="font-semibold text-white">
              One thing you can choose to send us.
            </strong>{" "}
            Some tools in our catalogue are not built yet. If you press
            &ldquo;Notify me&rdquo; on one, that tells us which tool you wanted
            — the tool&apos;s name, and nothing else. No identifier, no time,
            nothing about you or your device. We add one to a count so we know
            what to build next. Pressing nothing sends nothing.
          </li>
          <li>
            <strong className="font-semibold text-white">
              Page-performance and error reports, only if we switch them on.
            </strong>{" "}
            There is one optional channel for load-speed measurements and crash
            reports. It is off unless a reporting destination is configured, and
            when it is off the code that would send anything is not loaded at
            all. When on, values are stripped before sending — filenames, file
            links, and query strings are removed rather than trusted to be
            harmless.
          </li>
          <li>
            <strong className="font-semibold text-white">
              What you send us.
            </strong>{" "}
            If you email us, we keep that correspondence so we can reply.
          </li>
        </ul>
        <p>
          <strong className="font-semibold text-white">
            There are no accounts.
          </strong>{" "}
          We do not ask for a name, an email address, or a password to use the
          tools, so we hold no profile of you to lose.
        </p>
      </LegalSection>

      <LegalSection id="cookies" heading="5. Cookies and browser storage">
        <p>
          We use no advertising cookies, no analytics cookies, and no cross-site
          trackers, which is why you are not being asked to dismiss a consent
          banner.
        </p>
        <p>
          Some tools keep information inside your browser so a feature can work
          — for example, holding files you added to the workspace so you can
          carry them to another tool. That data stays on your device and is not
          transmitted to us. Clearing your browser storage for this site removes
          it.
        </p>
      </LegalSection>

      <LegalSection id="why" heading="6. Why we are allowed to do this">
        <p>Under UK and EU data protection law we rely on two lawful bases:</p>
        <ul className="ml-5 flex list-disc flex-col gap-1.5">
          <li>
            <strong className="font-semibold text-white">
              Performance of a contract
            </strong>{" "}
            — processing the file you asked us to process is the service you
            requested.
          </li>
          <li>
            <strong className="font-semibold text-white">
              Legitimate interests
            </strong>{" "}
            — keeping the service available, secure, and free of abuse, and
            understanding aggregate performance. We have considered your rights
            in reaching that balance, which is why these signals carry no
            identifiers and no document contents.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="sharing" heading="7. Who else is involved">
        <p>
          We do not sell personal information, and we do not share it for
          cross-context behavioural advertising. We use a small number of
          service providers who process data on our instructions:
        </p>
        <ul className="ml-5 flex list-disc flex-col gap-1.5">
          <li>
            a hosting and content-delivery provider for the website itself;
          </li>
          <li>
            an object-storage provider that holds uploaded files and results for
            the short windows described above;
          </li>
          <li>
            infrastructure we operate for processing, including malware
            scanning;
          </li>
          <li>
            AI model providers, which receive extracted document <em>text</em>{" "}
            when you use an AI tool.
          </li>
        </ul>
        <p>
          We may also disclose information where the law requires it, or to
          protect the rights and safety of our users and the service.
        </p>
      </LegalSection>

      <LegalSection id="transfers" heading="8. Where data goes">
        <p>
          {LEGAL_ENTITY.name} is established in the United States, and our
          providers operate internationally. If you are in the UK or the EEA,
          using this service means your data is processed outside your country —
          that is not a corner case here, it is the normal path.
        </p>
        <p>
          Where personal data leaves the UK or EEA, we rely on the safeguards
          our providers offer, typically the UK International Data Transfer
          Agreement or the EU Standard Contractual Clauses. The practical
          reduction in exposure is the same one that runs through this whole
          policy: for most of our tools nothing is transferred at all, because
          the file never leaves your device.
        </p>
      </LegalSection>

      <LegalSection id="security" heading="9. Security">
        <p>
          Traffic to and from this site is encrypted in transit. Uploaded files
          are stored on infrastructure we control and are scanned for malware
          before any processor touches them — a deployment with no scanner
          refuses to start, so this is not a setting that can quietly lapse. The
          site sets a strict Content Security Policy and related protections
          against common web attacks. We remove uploads and results on the
          timetable in section 2 rather than keeping them.
        </p>
        <p>
          No service can promise perfect security, and we do not. What we can
          say is that the largest single reduction in risk is the design itself:
          for the majority of our tools there is nothing on our servers to
          breach, because the file never left your device.
        </p>
      </LegalSection>

      <LegalSection id="rights" heading="10. Your rights">
        <p>
          Depending on where you live, you may have the right to access,
          correct, delete, or receive a copy of your personal data, to object to
          or restrict processing, and — in California — to know what is
          collected and to opt out of sale or sharing. We do not sell or share
          personal information, so there is nothing to opt out of.
        </p>
        <p>
          To exercise any right, email{" "}
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="text-violet-300 underline underline-offset-4"
          >
            {LEGAL_CONTACT}
          </a>
          . We will not treat you differently for asking.
        </p>
        <p>
          Please be aware of a practical limit: because we hold no accounts and
          delete files within an hour, a request about a document you processed
          is usually a request about data that no longer exists. We are also
          often unable to connect a request to a specific past request without
          information that would identify you more than we currently do — we
          will not create a record of you in order to answer.
        </p>
        <p>
          If you are in the UK or EEA and you think we have handled your data
          badly, you may complain to your national supervisory authority. In the
          UK that is the Information Commissioner&apos;s Office.
        </p>
      </LegalSection>

      <LegalSection id="children" heading="11. Children">
        <p>
          This service is not directed to children under 13, and we do not
          knowingly collect personal information from them. If you believe a
          child has provided us with personal information, contact us and we
          will delete it.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="12. Changes to this policy">
        <p>
          If we change how we handle data, we will update this page and the
          &ldquo;last updated&rdquo; date above. Where a change materially
          reduces the protections described here, we will say so prominently
          rather than quietly editing the text.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="13. Contact">
        <p>
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="text-violet-300 underline underline-offset-4"
          >
            {LEGAL_CONTACT}
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
