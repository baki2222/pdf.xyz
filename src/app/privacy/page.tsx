import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { RETENTION_WINDOWS } from "@/lib/retention-windows";
import { tools } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import {
  HIGHEST_DIGITAL_CONSENT_AGE,
  LEGAL_CONTACT,
  LEGAL_ENTITY,
  LEGAL_UPDATED,
  MINIMUM_AGE,
} from "@/lib/legal";
import { AnalyticsChoices } from "@/components/analytics/analytics-choices";
import { BROWSER_STORAGE, HANDOFF_LIFETIME } from "@/lib/browser-storage";
import { PASSWORD_QUEUE_LIFETIME } from "@/lib/jobs/pdf-security";
import {
  AI_PROVIDER,
  AI_PROVIDER_RETENTION,
  CLOUDFLARE,
  PROCESSORS,
  STORAGE_PROVIDER,
} from "@/lib/privacy/processors";
import {
  ANALYTICS_EVENTS,
  PAGE_VIEW_DESCRIPTION,
} from "@/lib/privacy/analytics-events";
import { ASKED_FOR } from "@/lib/privacy/asked-for";
import {
  JOB_RECORD_EXPIRY_NOTE,
  JOB_RECORD_JOURNAL_NOTE,
  TYPED_INPUT_QUEUE_LIFETIME,
} from "@/lib/privacy/job-queue";
import {
  INTEREST_RATE_LIMIT_NOTE,
  RATE_LIMIT_DISCLOSURE,
} from "@/lib/privacy/rate-limits";
import { PER_CLIENT_KEYING_DISCLOSED } from "@/lib/privacy/keying";
import { CSP_SENTENCE } from "@/lib/privacy/site-security";

/**
 * The windows this page states, each read from the code that enforces it —
 * see `src/lib/retention-windows.ts` for which clock is whose, and why an
 * upload's life is bounded by the storage rule and not by the input TTL.
 */
const {
  outputLink: outputWindow,
  inputStorageRule,
  outputStorageRule,
  jobRecord: jobRecordWindow,
} = RETENTION_WINDOWS;

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description: `What pdf.xyz does with your files. Most tools never upload anything; the rest process on a worker that deletes the upload when the job ends and stops serving the result after ${outputWindow}. No accounts, no advertising, no sale of personal data.`,
  path: "/privacy",
});

/**
 * Every number and claim on this page is derived from the code that implements
 * it, not written alongside it.
 *
 * The counts come from the catalogue's `processing` field, and the retention
 * windows from `RETENTION_WINDOWS`, which reads each one from the code that
 * enforces it — the API, the lifecycle generator, the queue. A
 * policy is the highest-stakes place in a product to state something that is not
 * true, and this repository has twice shipped a promise it did not keep: a
 * pipeline description claiming every file was malware-scanned when no scanner
 * existed, and a homepage claiming layout-preserving translation the engine
 * explicitly disclaims. Deriving the figures means a change to the behaviour
 * changes this page, instead of silently contradicting it.
 *
 * The counts moved to the shared `processingSplit` on 2026-08-22. They were
 * already derived and already correct; what they were not was the SAME
 * derivation the homepage ran. This page reduced the catalogue itself and
 * counted `client` (29) against `server + ai + hybrid` (21); the homepage
 * counted `client + hybrid` (30) at its own call site. Two partitions, both
 * true, and a reader who saw both was told 30 tools run in-browser and 21
 * upload — 51 of 50. Deriving is necessary and not sufficient: it has to be
 * the same derivation, or the surfaces drift while every one of them can show
 * its work.
 *
 * The NAMES moved to `src/lib/privacy` on 2026-10-10, for the same reason. A
 * sweep of this page against the code found it naming four unnamed
 * categories where the code integrates Google, OpenAI and Cloudflare R2,
 * listing two analytics facts where the schema sends sixteen fields, saying
 * nobody is asked for a name or email beside a tool that asks for ten of
 * each, and promising a "strict" CSP and a scanner guard the code does not
 * have. Each section now renders the registry its subject lives in, and
 * `privacy-truth.test.tsx` derives the subjects from the code and holds the
 * rendered page to them.
 */
const split = processingSplit();
const inBrowser = split.neverUploads.length;
const onWorker = split.mayUpload.length;
/** The browser-first tools, counted so the sentence below can name them. */
const browserFirst = split.browserFirst.length;
/** The tools that take something typed, counted from the list §2 renders. */
const askingTools = ASKED_FOR.flatMap((entry) => entry.tools).length;

const strong = "text-fg font-semibold";
const link = "text-accent underline underline-offset-4";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={LEGAL_UPDATED}
      summary={
        <>
          <strong className={strong}>The short version.</strong> {inBrowser} of
          our {tools.length} tools do their work entirely inside your browser —
          those files are never uploaded, so we never receive them. The
          remaining {onWorker} can send your file to a processing worker, which
          deletes it when the job ends and stops serving the result after{" "}
          {outputWindow}. There are no accounts, no advertising, and no sale or
          sharing of personal information. Each tool&apos;s page says which kind
          it is before you upload anything.
        </>
      }
    >
      <LegalSection id="who-we-are" heading="1. Who we are">
        <p>
          pdf.xyz is operated by{" "}
          <strong className={strong}>{LEGAL_ENTITY.name}</strong>, a limited
          liability company registered in {`${LEGAL_ENTITY.jurisdiction} `}
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
        </p>
        <address className="text-muted not-italic">
          {LEGAL_ENTITY.address.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
        <p>
          For anything in this policy, including requests about your data, write
          to{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className={link}>
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
          <strong className={strong}>
            Tools that run in your browser ({inBrowser} of {tools.length}).
          </strong>{" "}
          The file is opened and processed by code running on your own device.
          It is not sent to us, and we could not read it if we wanted to.
          Closing the tab discards it. Nothing about the file — its contents,
          its name or its size — reaches our servers. The one exception is
          analytics, and only if you allow it: Google Analytics is then told
          which tool you used and a coarse size band of the result, never the
          file, its name or its exact size (section 4 describes what it
          receives). Passing a file from one page to a tool keeps it in your
          browser for a short while: {HANDOFF_LIFETIME}
        </p>
        <p>
          <strong className={strong}>
            Tools that use a processing worker ({onWorker} of {tools.length}).
          </strong>{" "}
          Some work cannot be done in a browser — optical character recognition,
          office-format conversion, and anything using an AI model. For these,
          your file is uploaded over an encrypted connection straight to our
          storage provider, {STORAGE_PROVIDER}, scanned for malware, processed
          on our processing server, and then removed on this timetable:
        </p>
        {/* "Scanned for malware" is true of production, observed at the wire
            (the live worker status reported scan.active = true on 2026-10-10),
            and /status renders that live answer. It is NOT guaranteed by the
            code: PDFXYZ_WORKER_REQUIRE_SCAN is opt-in and strict mode does not
            imply it, so this page no longer says a scanner-less deployment
            "refuses to start" (legal-pages.test.ts bans the sentence;
            privacy-truth.test.tsx ties it to evaluateGuardrails). */}
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className={strong}>
              The uploaded file is actively deleted
            </strong>{" "}
            as soon as the job reaches an end — success or failure. If a job
            hits a temporary error and is retried, the file is kept for that
            retry rather than re-uploaded. An upload that never reaches a
            job&apos;s end — you closed the tab, or the job was refused or
            cancelled after the file arrived — has nothing to delete it
            actively. It is erased instead by a storage rule that runs on a
            daily cycle and removes uploads after they are {inputStorageRule}{" "}
            old, so such a file can stay in storage for {inputStorageRule} or
            longer.
          </li>
          <li>
            <strong className={strong}>
              The result stops being downloadable after {outputWindow}.
            </strong>{" "}
            After that the link returns an error and nobody can retrieve it,
            including us. The stored copy is erased by the same daily storage
            rule, some time after it is {outputStorageRule} old — so the bytes
            outlive the link until then, unreadable but present. We would rather
            say that than round it to a number that sounds better.
          </li>
          <li>
            <strong className={strong}>
              A record of the job — including your file&apos;s name — is kept
              for about {jobRecordWindow}
            </strong>{" "}
            so the system can report status, avoid duplicating work, and retry
            safely. It does not contain your document&apos;s contents.{" "}
            {JOB_RECORD_JOURNAL_NOTE}
          </li>
          <li>
            We train no models, on this or anything else. What the AI provider
            may do with the text it receives is set out in{" "}
            <a href="#ai" className={link}>
              section 3
            </a>
            .
          </li>
        </ul>
        {/* The reconciliation sentence, and the reason the two groups above do
            not simply add up wherever else you meet them. It renders only while
            a browser-first tool exists, and both the count and the names come
            from the catalogue, so retiring the hybrid tool removes the sentence
            instead of leaving a dangling "0 of these". Below the timetable,
            never between it and the colon that promises it (review,
            2026-10-10: at 390 px a reader met twelve lines of counting caveat
            before the deletion schedule; privacy-truth pins the order). */}
        {browserFirst > 0 && (
          <p>
            <strong className={strong}>
              {/* One expression, for the reason recorded in retention-windows.ts:
                  split across a JSX line break the space is eaten and the page
                  renders "1of 21". And phrased about the GROUP rather than the
                  tool, so the sentence stays grammatical whatever its size. */}
              {`Counted here, but browser-first (${browserFirst} of ${onWorker}).`}
            </strong>{" "}
            This group — {split.browserFirst.map((t) => t.name).join(", ")} —
            runs in your browser first and uploads only when the local attempt
            cannot finish the job. Because an upload <em>can</em> happen, it is
            counted with the worker tools above rather than with the {inBrowser}{" "}
            that never upload. That is why a count of tools with an in-browser
            mode is larger than the count that never send anything — same
            catalogue, two different questions.
          </p>
        )}
        <p>
          Every tool page states which of these two applies <em>before</em> you
          choose a file, and{" "}
          <Link href="/status" className={link}>
            the status page
          </Link>{" "}
          lists the tools that run entirely in your browser.
        </p>
        <p>
          Every upload is scanned for malware before any processor touches it,
          and{" "}
          <Link href="/status" className={link}>
            the status page
          </Link>{" "}
          shows whether scanning is running right now. We do not read your
          documents, and no person at pdf.xyz opens them in the ordinary course
          of running the service.
        </p>
        <p>
          <strong className={strong}>One case worth naming.</strong> If you use
          the tools that add or remove a PDF password, the password you type is
          part of the instructions sent to the worker. {PASSWORD_QUEUE_LIFETIME}{" "}
          While the job runs, the worker hands the password to the encryption
          tool through a temporary file in the job&apos;s own folder, which is
          erased when the job ends. It is never written to a log, an error
          message or a result. Still: if a password is one you use elsewhere,
          change it, or use it only for the document.
        </p>
        <p>
          <strong className={strong}>What some tools ask you for.</strong>{" "}
          {`${askingTools} of the worker and AI tools also take something you type, which travels with the job. ${TYPED_INPUT_QUEUE_LIFETIME} This is all of it:`}
        </p>
        {/* The queue's rule is said once, above; each item says only what
            differs, after its tools in bold — the shape of the timetable.
            Nothing after this list links to /status, which lists tools by
            where they run, not by what they ask for (privacy-truth). */}
        <ul className="ml-5 flex list-disc flex-col gap-2">
          {ASKED_FOR.map((entry) => (
            <li key={entry.tools.join("+")}>
              <strong className={strong}>{entry.lead}</strong> {entry.text}
            </li>
          ))}
        </ul>
      </LegalSection>

      <LegalSection id="ai" heading="3. Tools that use an AI model">
        <p>
          Our AI tools — summarising, translating, answering questions about a
          document, and structured extraction — work from the{" "}
          <strong className={strong}>text</strong> of your PDF. The worker
          extracts that text and sends it to our AI provider, {AI_PROVIDER.name}
          , together with anything you typed into the tool (section 2 lists what
          each one takes), to produce the answer. The PDF file itself is not
          sent to {AI_PROVIDER.name}.
        </p>
        <p>
          Two details we would rather state than have you discover. Only text
          the PDF already contains as text is sent — we do not run character
          recognition to manufacture text from a scan, and a scanned document is
          refused rather than silently half-processed. And for{" "}
          <strong className={strong}>Chat with PDF</strong>, each question is a
          new job: the document&apos;s text is sent again every time, together
          with your question and the conversation so far.
        </p>
        <p>
          {AI_PROVIDER.name} may keep what it receives for up to{" "}
          {AI_PROVIDER_RETENTION} to monitor for abuse, under its own terms. The
          settings in our {AI_PROVIDER.name} account that would let it use this
          data to improve its models are switched off. We cannot control what a
          provider does beyond that, so if a document is sensitive enough that
          this matters, use one of the in-browser tools instead, or do not use
          the AI tools for it.
        </p>
      </LegalSection>

      <LegalSection id="what-we-collect" heading="4. What else we collect">
        <p>Beyond file processing, the data we handle is deliberately small.</p>
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className={strong}>Ordinary server logs.</strong> Every
            request to this site passes through {CLOUDFLARE}, in front of our
            servers, and most also reach our own servers; both record what a web
            request carries — IP address, time, the page or endpoint requested,
            browser user-agent. Our storage provider records the same for
            uploads, which your browser sends to it directly. We use these
            records to run and secure the service and to detect abuse. How long
            they are kept depends on {CLOUDFLARE}&apos;s retention and our
            servers&apos; log settings; this policy does not yet promise a fixed
            period.
          </li>
          <li>
            <strong className={strong}>Rate limits.</strong>{" "}
            {RATE_LIMIT_DISCLOSURE}
          </li>
          <li>
            <strong className={strong}>A job identifier.</strong> Worker tools
            create a job with a random identifier so your browser can poll for
            the result. It is not linked to you.
          </li>
          {/* One bullet, four short answers, each with its lead in bold: it was
              a single 1,179-character paragraph (about 26 lines at 390 px),
              with what is sent and for how long buried in its middle and at
              its end. privacy-truth bounds every §4 block at 600 characters. */}
          <li className="flex flex-col gap-2">
            <p>
              <strong className={strong}>
                Product analytics — only after you say yes.
              </strong>{" "}
              We use Google Analytics to count visits and see which tools are
              used, and it is loaded only after you choose &ldquo;Allow
              analytics&rdquo; in the banner. Until then — and always, if you
              decline — no analytics code loads and nothing is sent to Google.
            </p>
            <p>
              <strong className={strong}>What Google receives</strong>, acting
              as our processor:
            </p>
            <ul className="ml-5 flex list-disc flex-col gap-1.5">
              <li>
                coarse browser and device information, and an approximate
                location derived from your IP address;
              </li>
              <li>the random identifier its cookie holds;</li>
              <li>for each page you view, {PAGE_VIEW_DESCRIPTION};</li>
              <li>
                the events listed below, each with the fields shown. Every event
                also carries the address of the page it happened on and, when
                there is one, of the previous page, both without their query
                strings;
              </li>
              <li>
                measurements Google Analytics makes on its own for each visit:
                that a visit started, whether it is your first visit, and how
                long a page was in use. Depending on its &ldquo;enhanced
                measurement&rdquo; setting in our Google Analytics property, it
                can also record scrolling, clicks on links that lead off this
                site (with the link&apos;s address), site searches and file
                downloads.
              </li>
            </ul>
            <p>
              <strong className={strong}>What it never sees.</strong> Your
              documents: file contents never pass through this channel at all,
              and the events our code sends are stripped of filenames, links and
              query strings before they are sent.
            </p>
            <p>
              <strong className={strong}>How long.</strong> How long Google
              keeps this data is set by the retention setting of our Google
              Analytics property. There is no advertising pixel and no
              error-tracking SDK, and you can change your decision at any time
              in the{" "}
              <a
                href="#cookies"
                className="text-fg underline underline-offset-2"
              >
                cookies section
              </a>{" "}
              below.
            </p>
          </li>
        </ul>
        {/* Rendered from the registry typed by the event schema itself
            (src/lib/privacy/analytics-events.ts): an event or field the code
            sends and this list omits is a compile error there, and
            privacy-truth.test.tsx reads both by AST and by text. */}
        <dl className="flex flex-col gap-4">
          {Object.entries(ANALYTICS_EVENTS).map(([event, copy]) => (
            <div
              key={event}
              className="border-line flex flex-col gap-1 border-l-2 pl-4"
            >
              <dt className="text-fg flex flex-wrap items-baseline gap-x-2 font-medium">
                <code className="text-sm">{event}</code>
                <span className="text-muted text-sm font-normal">
                  sent when {copy.when}
                </span>
              </dt>
              {Object.entries(copy.fields as Record<string, string>).map(
                ([field, meaning]) => (
                  <dd key={field}>
                    <code className="text-sm">{field}</code> — {meaning}
                  </dd>
                ),
              )}
            </div>
          ))}
        </dl>
        <ul className="ml-5 flex list-disc flex-col gap-2">
          <li>
            <strong className={strong}>
              One thing you can choose to send us.
            </strong>{" "}
            Some tools in our catalogue are not built yet. If you press
            &ldquo;Notify me&rdquo; on one, your browser sends us the
            tool&apos;s name, and nothing else, and we add one to a count so we
            know what to build next. The count holds no identifier, no time,
            nothing about you or your device; the request itself reaches us like
            any other, so it appears in the ordinary logs above.
            {INTEREST_RATE_LIMIT_NOTE} If you have allowed analytics, Google
            Analytics also counts the press, as the{" "}
            <code className="text-sm">gated_tool_interest</code> event above.
            Pressing nothing sends nothing.
          </li>
          <li>
            <strong className={strong}>
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
            <strong className={strong}>What you send us.</strong> If you email
            us, the message reaches us through {CLOUDFLARE} Email Routing, which
            forwards it to our mailbox, and we keep that correspondence so we
            can reply. This policy does not yet set a period after which it is
            deleted; you can ask us to delete it at any time (section 10).
          </li>
        </ul>
        <p>
          <strong className={strong}>There are no accounts.</strong> We do not
          ask who you are, and we hold no profile of you to lose. The only
          things a tool asks for besides your file are listed in section 2, and
          they are used only for that job.
        </p>
      </LegalSection>

      <LegalSection id="cookies" heading="5. Cookies and browser storage">
        <p>
          We use no advertising cookies and no cross-site trackers, and our own
          code sets no cookies. Google Analytics sets its measurement cookies
          (the <code>_ga</code> family) to tell returning browsers apart, and
          only after you allow analytics in the consent banner. They last for
          Google&apos;s default lifetime, which we do not change, and
          withdrawing your consent here deletes them. Decline — or never answer
          — and no analytics cookie is ever set. {CLOUDFLARE}, which sits in
          front of the site, may set cookies of its own that it needs to protect
          the site, for example to tell people from automated traffic; we do not
          use them for analytics or advertising.
        </p>
        <p>
          Your consent decision itself is kept in your browser&rsquo;s local
          storage, so we ask once instead of on every visit. You can change it
          here:
        </p>
        <AnalyticsChoices />
        <p>
          A few features keep information in your own browser so they work
          across pages and reloads. This is everything this site keeps there —
          clearing this site&rsquo;s data in your browser removes all of it,
          along with your analytics decision:
        </p>
        {/* Rendered from the registry the code is held to: every store a
            storage call uses is listed, and every listed store is used
            (browser-storage.test.ts). */}
        <dl className="flex flex-col gap-4">
          {BROWSER_STORAGE.map((store) => (
            <div
              key={store.key}
              className="border-line flex flex-col gap-1 border-l-2 pl-4"
            >
              <dt className="text-fg flex flex-wrap items-baseline gap-x-2 font-medium">
                <code className="text-sm">
                  {store.perTool ? `${store.key}<tool>` : store.key}
                </code>
                <span className="text-muted text-sm font-normal">
                  {store.area}
                </span>
              </dt>
              <dd>{store.holds}</dd>
              <dd className="text-muted">{store.lasts}</dd>
            </div>
          ))}
        </dl>
      </LegalSection>

      <LegalSection id="why" heading="6. Why we are allowed to do this">
        <p>
          Under UK and EU data protection law, each use of data above rests on
          one of these lawful bases:
        </p>
        <ul className="ml-5 flex list-disc flex-col gap-1.5">
          <li>
            <strong className={strong}>Performance of a contract</strong> —
            processing the files you give a tool, and what you type into it (a
            password, a web address, a question, signers&apos; names and email
            addresses), because that is the service you asked for.
          </li>
          <li>
            <strong className={strong}>Legitimate interests</strong> — the
            server logs and rate limits that keep the service available, secure
            and free of abuse; page-performance and error reports, if switched
            on; the &ldquo;Notify me&rdquo; count; replying to email you send
            us; and, for the people named as signers in a signature request,
            preparing the request you asked for. We have considered your rights
            in reaching that balance:{" "}
            {PER_CLIENT_KEYING_DISCLOSED
              ? "the logs hold IP addresses, the rate limiter keeps only a salted hash of one, and none of these signals holds document contents."
              : "the logs hold IP addresses but no document contents, and the rate limiter holds no identifier at all."}
          </li>
          <li>
            <strong className={strong}>Consent</strong> — Google Analytics runs
            only after you opt in, and you can withdraw that consent at any time
            in the cookies section above; withdrawing is as easy as giving it.
          </li>
          <li>
            <strong className={strong}>Legal obligation</strong> — answering a
            request to exercise your rights, and disclosing information where
            the law requires it.
          </li>
        </ul>
        <p>
          No law or contract requires you to give us personal data. A tool needs
          only what it works on — a file, and for some tools a password, a web
          address or signers&apos; details; without them that tool cannot run,
          and nothing else changes.
        </p>
        <p>
          We make no decisions about you by automated means, including
          profiling, that have legal or similarly significant effects on you.
        </p>
      </LegalSection>

      <LegalSection id="sharing" heading="7. Who else is involved">
        <p>
          We do not sell personal information, and we do not share it for
          cross-context behavioural advertising. These companies process data on
          our instructions:
        </p>
        <ul className="ml-5 flex list-disc flex-col gap-2">
          {PROCESSORS.map((processor) => (
            <li key={processor.id}>
              <strong className={strong}>{processor.name}</strong> (based in{" "}
              {processor.basedIn}). {processor.does}
            </li>
          ))}
          <li>
            The email service that hosts our mailbox, which holds the email you
            send us.
          </li>
        </ul>
        <p>
          The malware scanner and the job queue are software we run ourselves,
          on the servers above. A website you ask Webpage to PDF to convert
          receives a request from our processing server, as any visitor&apos;s
          request would be; it is not working for us. We may also disclose
          information where the law requires it, or to protect the rights and
          safety of our users and the service.
        </p>
      </LegalSection>

      <LegalSection id="transfers" heading="8. Where data goes">
        <p>
          {LEGAL_ENTITY.name} is established in the United States, as are most
          of the companies in section 7, and our web server is in the United
          States. If you are in the UK or the EEA, using this service means your
          data is processed outside your country — that is not a corner case
          here, it is the normal path.
        </p>
        <p>
          Where personal data leaves the UK or EEA, we rely on the safeguards
          our providers offer, typically the UK International Data Transfer
          Agreement or the EU Standard Contractual Clauses. You can ask us at{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className={link}>
            {LEGAL_CONTACT}
          </a>{" "}
          which safeguard covers a given company, and for a copy of it. The
          practical reduction in exposure is the same one that runs through this
          whole policy: for most of our tools nothing is transferred at all,
          because the file never leaves your device.
        </p>
      </LegalSection>

      <LegalSection id="security" heading="9. Security">
        <p>
          Traffic between your browser and this site is encrypted in transit.
          Uploaded files are held by our storage provider, {STORAGE_PROVIDER},
          and are scanned for malware before any processor touches them; the
          status page shows whether scanning is running right now.{" "}
          {CSP_SENTENCE} We remove uploads and results on the timetable in
          section 2 rather than keeping them.
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
          <a href={`mailto:${LEGAL_CONTACT}`} className={link}>
            {LEGAL_CONTACT}
          </a>
          . We will not treat you differently for asking.
        </p>
        <p>
          Please be aware of a practical limit. We hold no accounts, and nothing
          about a document you processed outlives the timetable in section 2:
          the upload is deleted when its job ends (or by the daily storage rule
          if it never ran), the result stops being downloadable after{" "}
          {outputWindow} and its stored copy follows by the same rule, and the
          job record — the filename included — expires after about{" "}
          {`${jobRecordWindow}, ${JOB_RECORD_EXPIRY_NOTE}`}. So a request about
          a document you processed is usually a request about data that no
          longer exists. We are also often unable to connect a request to a
          specific past request without information that would identify you more
          than we currently do — we will not create a record of you in order to
          answer.
        </p>
        <p>
          If you are in the UK or EEA and you think we have handled your data
          badly, you may complain to your national supervisory authority. In the
          UK that is the Information Commissioner&apos;s Office.
        </p>
      </LegalSection>

      <LegalSection id="children" heading="11. Children">
        <p>
          This service is not directed to children under {MINIMUM_AGE}, the
          minimum age in our terms, and we do not knowingly collect personal
          information from them. Some countries set a higher age — up to{" "}
          {HIGHEST_DIGITAL_CONSENT_AGE} — below which a parent must agree before
          you can consent to things like analytics. If that applies to you,
          decline analytics when the site asks (&ldquo;No thanks&rdquo;), or ask
          a parent first. If you believe a child has provided us with personal
          information, contact us and we will delete it.
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
          <a href={`mailto:${LEGAL_CONTACT}`} className={link}>
            {LEGAL_CONTACT}
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
