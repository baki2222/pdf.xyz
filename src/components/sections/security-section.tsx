import { Cpu, Eye, Lock, ShieldCheck, Timer, Trash2 } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const pillars = [
  {
    icon: Cpu,
    title: "In-browser by default",
    body: "Most tools run with WebAssembly on your own device. Your files are never uploaded to process them.",
  },
  {
    icon: Lock,
    title: "Encrypted when it leaves",
    body: "The few heavy or AI tasks that need a server use TLS in transit and encrypted, isolated workers.",
  },
  {
    icon: Trash2,
    title: "Auto-deleted, always",
    body: "Anything sent to a worker is permanently erased minutes after your job finishes. Nothing is retained.",
  },
  {
    icon: Eye,
    title: "No training on your data",
    body: "AI tools run on secure infrastructure and your content is never used to train any model.",
  },
  {
    icon: Timer,
    title: "No account to start",
    body: "Open a tool and go. Sign in only when you want to save workspaces and presets.",
  },
  {
    icon: ShieldCheck,
    title: "Private by architecture",
    body: "Our privacy promise is enforced by how the product is built — not by a policy you have to trust.",
  },
];

export function SecuritySection() {
  return (
    <section id="privacy" className="scroll-mt-24 py-20 sm:py-28">
      <span id="security" className="sr-only" />
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Privacy & security"
          title="Your documents never become our data"
          description="Privacy isn't a setting on pdf.xyz — it's the architecture. Here's exactly what happens to your files."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-2 p-6"
            >
              <span className="grid size-11 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
