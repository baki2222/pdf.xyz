import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { processingSplit } from "@/lib/tools/processing-split";
import { supportedToolSlugs } from "@/lib/pdf/registry";
import { CAPABILITY_DESCRIPTORS, type ToolCapability } from "@/lib/jobs";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
import { buildMetadata } from "@/lib/seo";
import {
  SystemStatus,
  type LocalToolRef,
} from "@/components/status/system-status";
import { WorkerOperationsDashboard } from "@/components/status/operations-dashboard";
import { AvailabilityGlyph } from "@/components/status/status-ui";

export const metadata: Metadata = buildMetadata({
  title: "System status",
  description:
    "What pdf.xyz can do right now: which tools run entirely in your browser (and never upload files) versus whether an optional secure worker is enabled in this environment.",
  path: "/status",
});

/**
 * Tools that run ENTIRELY in the browser — `processing: "client"`, not merely
 * "has an in-browser runner".
 *
 * The distinction is load-bearing because this list sits under the sentence
 * "your files never leave the browser". `compress-pdf` is `hybrid`: it really
 * does have a local lossless path, so it passed the has-a-runner test, and it
 * also has a secure-worker path that uploads — which the same page says a few
 * hundred pixels further down. A tool whose files CAN leave the browser cannot
 * appear under a promise that they never do.
 *
 * The `processing !== "client"` test that used to encode that rule is now
 * `processingSplit().neverUploads`, the same group `/privacy` and the homepage
 * count. The rule was right and privately held: reclassifying a tool moved
 * this page and left the others where they were, which is exactly how the
 * homepage came to advertise 30 in-browser tools against this page's 29.
 *
 * INTERSECTED, not equal, and deliberately so. This page reports on THIS
 * environment, so it counts the never-upload tools that actually ship a
 * runner; `/privacy` counts the catalogue. They agree today (all
 * {@link supportedToolSlugs} minus the hybrid tool) and they are allowed to
 * disagree if a runner is withdrawn — a live-status page saying fewer is
 * honest, saying more is not. `processing-split.test.ts` asserts the subset
 * direction rather than equality for that reason.
 */
const localTools: LocalToolRef[] = processingSplit()
  .neverUploads.filter((tool) => supportedToolSlugs.includes(tool.slug))
  .map((tool) => ({ slug: tool.slug, name: tool.name }));

/** Order the capability explainer from most-private to most-powerful. */
const CAPABILITY_ORDER: ToolCapability[] = [
  "in-browser",
  "hybrid",
  "secure-worker",
  "ai",
];

export default function StatusPage() {
  return (
    <div className="py-14 sm:py-20">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-4">
          <Pill>
            <Activity className="text-ok size-3.5" aria-hidden />
            Live status
          </Pill>
          <h1 className="font-display text-fg text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            System status
          </h1>
          <p className="text-muted max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            pdf.xyz is a privacy-first, browser-first platform. This page shows
            exactly what runs where in this environment — checked live, with no
            over-promising. It never reports on your files, only on
            capabilities.
          </p>
        </div>

        <SystemStatus localTools={localTools} />

        <div className="bg-line h-px w-full" role="presentation" />

        {/* The operator counterpart to the capability summary above: the same worker
            stack, projected into SLO health classes and a single next action. */}
        <WorkerOperationsDashboard />

        <div className="bg-line h-px w-full" role="presentation" />

        <section className="flex flex-col gap-4">
          <h2 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What runs where
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITY_ORDER.map((id) => {
              const descriptor = CAPABILITY_DESCRIPTORS[id];
              return (
                <div
                  key={id}
                  className="bg-panel border-line flex flex-col gap-2 rounded-[4px] border p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg text-sm font-semibold">
                      {descriptor.label}
                    </span>
                    <span className="text-muted inline-flex items-center gap-1.5 text-xs">
                      <AvailabilityGlyph available={!descriptor.uploadsFiles} />
                      {descriptor.uploadsFiles
                        ? "Files uploaded (encrypted, auto-deleted)"
                        : "Files never leave your device"}
                    </span>
                  </div>
                  <p className="text-muted text-sm leading-relaxed">
                    {descriptor.summary}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-muted text-xs leading-relaxed">
            {/* Was: "show an honest, implementation-ready preview until their
                backend is enabled" — false for all 21. Every server and AI slug
                has a dedicated worker panel and the one hybrid tool renders the
                interactive workbench, so a reader was told a live page was
                inert. The true part is the one worth keeping: nothing is faked
                locally. */}
            Secure-worker, hybrid, and AI tools upload your file to an encrypted
            worker and tell you so before you run them — pdf.xyz never fakes
            processing in the browser. See the{" "}
            <span className="text-muted">
              worker architecture and security docs
            </span>{" "}
            for how uploads, scanning, isolation, and auto-delete work.
          </p>
        </section>
      </Container>
    </div>
  );
}
