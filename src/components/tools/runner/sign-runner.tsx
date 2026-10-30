"use client";

import { ShieldAlert } from "lucide-react";
import { signatureOutputName } from "@/lib/pdf/signature";
import { PrivacyLine } from "./stamp-controls";
import { EditorRunner } from "./editor/editor-session";

/**
 * Sign PDF — the shared editor (`./editor/`), opened on its Sign tool with
 * the signature panel showing: draw, type or pick a picture of a signature,
 * then click where it goes on the page, as many times and on as many pages
 * as needed.
 *
 * HISTORY. Until 2026-10-24 this was a form of its own: one signature per
 * run, pinned to one of nine anchor points with Size and Margin sliders, on
 * one page, no preview of the page. The page's title and its search copy are
 * still its own; the placement, the multi-page signing and the saved
 * signatures are the editor's.
 */
export function SignRunner() {
  return (
    <EditorRunner
      slug="sign-pdf"
      toolName="Sign PDF"
      hint="One PDF · signed locally in your browser"
      initialTool="signature"
      firstStep={
        <>
          <span className="font-semibold">Place signature:</span> create your
          signature — draw it, type it or pick a picture of it — then tap or
          click the page where it goes. Drag it into place and resize it from a
          corner. <span className="font-semibold">Date</span>,{" "}
          <span className="font-semibold">Initials</span>,{" "}
          <span className="font-semibold">Name</span> and{" "}
          <span className="font-semibold">Check</span> in the Add group place
          today&apos;s date, your initials, your name or a check mark the same
          way.
        </>
      }
      emptyReason="Place your signature, or a date, initials, name or check, on a page first."
      resultTitle="PDF signed"
      downloadLabel="Download signed PDF"
      outputName={signatureOutputName}
      footer={<SignFooter />}
    />
  );
}

function SignFooter() {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-warn/40 bg-warn/10 text-fg rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
        <ShieldAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Electronic signature — this places a visual signature onto your PDF.
          It is not a digital-certificate or cryptographic signature: it uses no
          PKI and is not tamper-evident. For legally-binding, verifiable
          e-signatures use a certificate-based signing service.
        </span>
      </div>
      <PrivacyLine>
        Signing happens on your device — your PDF never leaves the browser.
      </PrivacyLine>
    </div>
  );
}
