import {
  Cpu,
  Download,
  FileDown,
  FileUp,
  ShieldCheck,
  Timer,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  capabilityForMode,
  describeCapability,
  DEFAULT_RETENTION,
  JOB_LIMITS,
  workerPipelineStages,
} from "@/lib/jobs";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { NotifyMe } from "./notify-me";

function StageIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "upload":
      return <UploadCloud className={className} aria-hidden />;
    // The structural preflight is the same kind of step — a gate that rejects a file
    // before any processor sees it — so it carries the same shield.
    case "scan":
    case "preflight":
      return <ShieldCheck className={className} aria-hidden />;
    case "process":
      return <Cpu className={className} aria-hidden />;
    case "download":
      return <Download className={className} aria-hidden />;
    case "delete":
      return <Trash2 className={className} aria-hidden />;
    default:
      return <Cpu className={className} aria-hidden />;
  }
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * Implementation-ready preview for tools that will run on a secure worker (or
 * an AI worker / hybrid fallback). It honestly states that the backend is not
 * yet enabled, then shows exactly what the future flow will be — encrypted
 * upload → checks → processing → download → auto-delete — plus the
 * expected inputs, outputs, retention, and limits. Nothing is uploaded or
 * processed here. Live in-browser tools never render this.
 */
export function WorkerPreview({ tool }: { tool: Tool }) {
  const capability = capabilityForMode(tool.processing);
  const descriptor = describeCapability(capability);
  const retention = DEFAULT_RETENTION;

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Cpu className="size-3" aria-hidden />
              {descriptor.label} preview
            </span>
            <span
              className="text-warn inline-flex items-center gap-1.5 text-[11px] font-medium"
              title="No worker backend is configured in this environment."
            >
              <span className="bg-warn size-1.5 rounded-full" aria-hidden />
              Not yet enabled
            </span>
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on a {descriptor.label.toLowerCase()}
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            {descriptor.summary} We&apos;d rather show you the real flow than
            fake it in the browser — here&apos;s exactly what will happen to
            your file.
          </p>
        </div>

        <ol className="flex flex-col gap-1">
          {workerPipelineStages(null, tool).map((stage, i, all) => (
            <li key={stage.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                  <StageIcon id={stage.id} className="size-4" />
                </span>
                {i < all.length - 1 && (
                  <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                )}
              </div>
              <div className="flex flex-col gap-0.5 pb-3">
                <span className="text-fg text-sm font-medium">
                  {i + 1}. {stage.title}
                </span>
                <span className="text-muted text-xs leading-relaxed">
                  {stage.description}
                </span>
              </div>
            </li>
          ))}
        </ol>

        <div className="bg-panel border-line divide-y divide-white/5 rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={FileUp}
            label="Inputs"
            value={tool.accept.join(", ")}
          />
          <SpecRow
            icon={FileDown}
            label="Outputs"
            value={tool.outputs.join(", ")}
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Inputs wiped after processing · outputs ${retention.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limits"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · up to ${JOB_LIMITS.maxInputFiles} files`}
          />
        </div>

        <div className="flex flex-col gap-3">
          <NotifyMe
            toolName={tool.name}
            toolSlug={tool.slug}
            checking={false}
          />
          <p className="text-muted text-xs leading-relaxed">
            No account required. When this ships, files are encrypted in transit
            and at rest, processed on a separate processing server, and deleted
            automatically — see our{" "}
            <span className="text-muted">worker architecture</span> and security
            docs.
          </p>
        </div>
      </div>
    </div>
  );
}
