import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "The terms for using pdf.xyz. You keep every right in your documents; we take only the narrow permission needed to run the tool you asked for, and nothing beyond it.",
  path: "/terms",
});

/** Human-readable file size cap, derived from the limit the API enforces. */
const maxFileSize = `${Math.round(JOB_LIMITS.maxFileBytes / (1024 * 1024))} MB`;

/**
 * Number and unit as ONE expression — split across a JSX line break the leading
 * space is eaten and the page renders "60minutes", which in a legal document
 * reads as carelessness. See the same note in the privacy page.
 */
const inputWindow = `${DEFAULT_RETENTION.inputTtlMinutes} minutes`;
const outputWindow = `${DEFAULT_RETENTION.outputTtlMinutes} minutes`;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated={LEGAL_UPDATED}
      summary={
        <>
          <strong className="font-semibold text-white">
            The short version.
          </strong>{" "}
          The tools are free and provided as they are. You keep every right in
          the documents you process — we take only the narrow, temporary
          permission needed to run the tool you asked for, and nothing beyond
          it. Do not upload anything you have no right to, and do not use the
          service to attack it. AI output can be wrong; check it before relying
          on it.
        </>
      }
    >
      <LegalSection id="agreement" heading="1. This agreement">
        <p>
          These terms apply when you use pdf.xyz. By using the service you
          accept them. If you do not, please do not use it.
        </p>
        <p>
          Our{" "}
          <Link
            href="/privacy"
            className="text-violet-300 underline underline-offset-4"
          >
            Privacy Policy
          </Link>{" "}
          explains what happens to your files and forms part of these terms.
        </p>
      </LegalSection>

      <LegalSection id="who" heading="2. Who may use it">
        <p>
          You must be at least 13 years old. If you are using pdf.xyz for an
          organisation, you confirm you are allowed to accept these terms on its
          behalf.
        </p>
      </LegalSection>

      <LegalSection id="your-content" heading="3. Your documents stay yours">
        <p>
          You keep all rights in every file you process here. Uploading a
          document gives us nothing beyond what is needed to do the job in front
          of us.
        </p>
        <p>
          Specifically, for the tools that upload, you grant us a{" "}
          <strong className="font-semibold text-white">
            non-exclusive, worldwide, royalty-free licence to store, transmit
            and process that file solely to produce the output you requested,
            and only for as long as the file exists on our systems
          </strong>{" "}
          — under our retention policy that is up to {inputWindow}. That licence
          ends when the file is deleted.
        </p>
        <p>
          It does not permit us to publish your document, show it to anyone,
          build a product from it, or use it — or anything derived from it — to
          train a machine-learning model. Most of our tools never upload at all;
          for those, this section has nothing to operate on.
        </p>
        <p>
          You are responsible for having the right to process what you upload.
          Do not upload material you do not own or have permission to use.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" heading="4. Acceptable use">
        <p>Do not use pdf.xyz to:</p>
        <ul className="ml-5 flex list-disc flex-col gap-1.5">
          <li>
            upload malware, or anything designed to damage a system that
            processes it;
          </li>
          <li>
            process material that is unlawful, or that infringes someone
            else&apos;s rights;
          </li>
          <li>
            remove protection from a document you are not authorised to unlock,
            or alter a document in order to deceive someone;
          </li>
          <li>
            attack, overload, probe, or attempt to gain unauthorised access to
            the service or its infrastructure;
          </li>
          <li>
            automate use at a scale that degrades the service for other people,
            or work around the limits described below;
          </li>
          <li>
            resell or rebrand the service as your own without our written
            agreement.
          </li>
        </ul>
        <p>
          We apply per-file size limits (currently {maxFileSize}) and
          request-rate limits, and we may refuse or stop a job that appears
          abusive.
        </p>
      </LegalSection>

      <LegalSection id="ai" heading="5. AI tools, and what they are worth">
        <p>
          Some tools use AI models to summarise, translate, answer questions
          about, or extract data from a document. These are useful and they are
          not reliable in the way a calculator is reliable.
        </p>
        <p>
          <strong className="font-semibold text-white">
            AI output can be incomplete or wrong even when it reads confidently.
          </strong>{" "}
          Check it against the original before relying on it, and do not treat
          it as legal, medical, financial, or other professional advice. Where a
          tool has known limits — a translation that produces text rather than a
          re-typeset PDF, or OCR whose confidence is low — we say so on the tool
          itself, and those statements are part of what you are agreeing to
          here.
        </p>
      </LegalSection>

      <LegalSection id="availability" heading="6. Availability">
        <p>
          The service is free and provided{" "}
          <strong className="font-semibold text-white">as is</strong>. We do not
          promise it will be available, uninterrupted, or error-free, and we may
          change, suspend, or withdraw any part of it.
        </p>
        <p>
          Results are deleted on a short timer — currently {outputWindow}.
          Download what you need when it is ready.{" "}
          <strong className="font-semibold text-white">
            Keep your own copy of anything that matters.
          </strong>{" "}
          We are not a storage service and we cannot recover a file once it is
          gone.
        </p>
      </LegalSection>

      <LegalSection id="ip" heading="7. Our material">
        <p>
          The site, its software, design, and content are ours or our
          licensors&apos;. These terms give you permission to use the service;
          they do not transfer any of that to you. You may not copy, reverse
          engineer, or create derivative works from the service except where the
          law says you may regardless of this restriction.
        </p>
      </LegalSection>

      <LegalSection id="warranties" heading="8. Warranties">
        <p>
          To the fullest extent the law allows, we exclude all implied
          warranties, including of merchantability, fitness for a particular
          purpose, and non-infringement.
        </p>
        <p>
          <strong className="font-semibold text-white">
            If you are a consumer,
          </strong>{" "}
          you have rights under the law of your country that cannot be excluded
          by an agreement like this one. Nothing here limits those rights, and
          where these terms conflict with them, your rights win.
        </p>
      </LegalSection>

      <LegalSection id="liability" heading="9. Liability">
        <p>
          To the fullest extent the law allows, we are not liable for indirect
          or consequential loss, or for lost profits, revenue, or data, arising
          from your use of the service.
        </p>
        <p>
          Nothing in these terms excludes or limits our liability for death or
          personal injury caused by negligence, for fraud or fraudulent
          misrepresentation, or for anything else that cannot lawfully be
          excluded.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" heading="10. Your responsibility">
        <p>
          If your use of the service breaks these terms or the law and that
          causes a claim against us, you agree to cover the reasonable costs of
          dealing with it. This does not apply to consumers acting outside a
          trade or profession.
        </p>
      </LegalSection>

      <LegalSection id="termination" heading="11. Stopping">
        <p>
          You can stop using pdf.xyz at any time; since there are no accounts,
          there is nothing to close. We may suspend or block access if these
          terms are being broken or if it is necessary to protect the service.
        </p>
      </LegalSection>

      <LegalSection id="changes" heading="12. Changes">
        <p>
          We may update these terms. The date above changes when we do, and
          continuing to use the service after that means you accept the new
          version. Where a change materially reduces your rights, we will say so
          rather than quietly editing the text.
        </p>
      </LegalSection>

      <LegalSection id="contact" heading="13. Contact">
        <p>
          Questions, legal notices, and complaints:{" "}
          <a
            href={`mailto:${LEGAL_CONTACT}`}
            className="text-violet-300 underline underline-offset-4"
          >
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
