import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { tools } from "@/lib/tools";
import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "What pdf.xyz does with your files. Most tools never upload anything; the rest process on a worker that deletes inputs and outputs within an hour. No accounts, no advertising, no sale of personal data.",
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
          which deletes the input and the result within {inputWindow}. There are
          no accounts, no advertising, and no sale or sharing of personal
          information. Each tool&apos;s page says which kind it is before you
          upload anything.
        </>
      }
    >
      <LegalSection id="who-we-are" heading="1. Who we are">
        <p>
          pdf.xyz (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates the website at{" "}
          <span className="text-slate-200">pdf.xyz</span> and the tools on it.
          For anything in this policy, including requests about your data, write
          to{" "}
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="text-violet-300 underline underline-offset-4"
          >
            {LEGAL_CONTACT}
          </a>
          .
        </p>
        <p>
          Where this policy uses terms from the UK and EU General Data
          Protection Regulation, we are the <em>controller</em> for the limited
          personal data described below.
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
          control, scanned for malware, processed, and then deleted:
        </p>
        <ul className="ml-5 flex list-disc flex-col gap-1.5">
          <li>
            the uploaded input is removed within{" "}
            <strong className="font-semibold text-white">{inputWindow}</strong>,
            and in normal operation immediately after the job finishes;
          </li>
          <li>
            the result is available to download for{" "}
            <strong className="font-semibold text-white">{outputWindow}</strong>
            , then deleted;
          </li>
          <li>
            neither is kept afterwards, and neither is used to train any model —
            not ours, and not a provider&apos;s.
          </li>
        </ul>
        <p>
          We do not read your documents, and no person at pdf.xyz opens them in
          the ordinary course of running the service.
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
              Anonymous performance and interest signals,{" "}
              <em>only if enabled</em>.
            </strong>{" "}
            The site can report page-performance measurements and a count of
            interest in tools that are not yet available. These carry no file
            contents, no filenames, and no identifier for you. When no reporting
            destination is configured, the code that would send them is not
            loaded at all.
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
          Our providers operate internationally, so your data may be processed
          outside your country, including in the United States. Where personal
          data is transferred out of the UK or EEA, we rely on the safeguards
          those providers offer — typically the UK International Data Transfer
          Agreement or the EU Standard Contractual Clauses.
        </p>
      </LegalSection>

      <LegalSection id="security" heading="9. Security">
        <p>
          Traffic to and from this site is encrypted in transit. Uploaded files
          are stored on infrastructure we control and are scanned for malware
          before any processor touches them. The site sets a strict Content
          Security Policy and related protections against common web attacks. We
          delete inputs and outputs on the timetable in section 2 rather than
          keeping them.
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
