import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getToolBySlug } from "@/lib/tools";
import { supportedToolSlugs } from "@/lib/pdf/registry";
import {
  CAPABILITY_DESCRIPTORS,
  type ToolCapability,
} from "@/lib/jobs";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
import { buildMetadata } from "@/lib/seo";
import {
  SystemStatus,
  type LocalToolRef,
} from "@/components/status/system-status";
import { AvailabilityGlyph } from "@/components/status/status-ui";

export const metadata: Metadata = buildMetadata({
  title: "System status",
  description:
    "What pdf.xyz can do right now: which tools run entirely in your browser (and never upload files) versus whether an optional secure worker is enabled in this environment.",
  path: "/status",
});

/** Client-safe list of the tools that have a real in-browser runner today. */
const localTools: LocalToolRef[] = supportedToolSlugs
  .map((slug) => {
    const tool = getToolBySlug(slug);
    return tool ? { slug, name: tool.name } : null;
  })
  .filter((entry): entry is LocalToolRef => entry !== null);

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
            <Activity className="size-3.5 text-emerald-400" aria-hidden />
            Live status
          </Pill>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
            System status
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">
            pdf.xyz is a privacy-first, browser-first platform. This page shows
            exactly what runs where in this environment — checked live, with no
            over-promising. It never reports on your files, only on capabilities.
          </p>
        </div>

        <SystemStatus localTools={localTools} />

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            What runs where
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITY_ORDER.map((id) => {
              const descriptor = CAPABILITY_DESCRIPTORS[id];
              return (
                <div
                  key={id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-surface-2 p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">
                      {descriptor.label}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                      <AvailabilityGlyph available={!descriptor.uploadsFiles} />
                      {descriptor.uploadsFiles
                        ? "Files uploaded (encrypted, auto-deleted)"
                        : "Files never leave your device"}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-400">
                    {descriptor.summary}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Secure-worker, hybrid, and AI tools show an honest, implementation-ready
            preview until their backend is enabled — pdf.xyz never fakes processing
            in the browser. See the{" "}
            <span className="text-slate-400">worker architecture and security docs</span>{" "}
            for how uploads, scanning, isolation, and auto-delete work.
          </p>
        </section>
      </Container>
    </div>
  );
}
