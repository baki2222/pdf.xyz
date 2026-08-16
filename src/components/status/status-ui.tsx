import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Reusable, presentational status/error/assurance primitives shared by the tool
 * runners and the /status page. These are deliberately RSC-safe (no hooks, no
 * client state): they render from props alone, so a server component can drop in
 * a static status card and a client component can wire the same `RecoverableError`
 * to a retry handler. All copy stays honest and privacy-forward — nothing here
 * implies work happens anywhere other than where it actually does.
 */

/* ------------------------------------------------------------------ *
 *  Operational status badge
 * ------------------------------------------------------------------ */

export type StatusTone = "ok" | "warn" | "danger" | "info" | "muted";

/**
 * Token-based since 2026-08-16: this badge renders on the redesigned paper
 * tool pages (every worker panel imports it) AND on the legacy-dark /status
 * route, and the theme scope resolves the same classes correctly in both.
 * The old hardcoded dark tints put text-slate-400 on white panels — the six
 * failures the both-scheme contrast audit caught the day the tool pages
 * flipped to paper.
 */
const TONE_STYLES: Record<StatusTone, { pill: string; dot: string }> = {
  ok: {
    pill: "border-ok/40 bg-ok/10 text-ok",
    dot: "bg-ok",
  },
  warn: {
    pill: "border-warn/40 bg-warn/10 text-warn",
    dot: "bg-warn",
  },
  // A hard, blocking failure (e.g. an operations `blocked` health class). Distinct
  // from `warn` so a pager can tell "fix eventually" from "cannot run at all".
  danger: {
    pill: "border-err/40 bg-err/10 text-err",
    dot: "bg-err",
  },
  info: {
    pill: "border-info/40 bg-info/10 text-info",
    dot: "bg-info",
  },
  muted: {
    pill: "border-line bg-wash text-muted",
    dot: "bg-faint",
  },
};

/**
 * A compact, presence-only operational status pill: a colored dot plus a short
 * label. Used for "Available" / "Not enabled" / "Local-dev worker" states.
 */
export function StatusBadge({
  tone,
  label,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  label: string;
  /** Softly pulse the dot to signal a live/active state. */
  pulse?: boolean;
  className?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        styles.pill,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          styles.dot,
          pulse && "animate-pulse",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 *  Recoverable error
 * ------------------------------------------------------------------ */

/**
 * An error panel that always offers a way forward. Beyond a title and a
 * human-readable message it can render an optional coarse `detail` line and a
 * primary recovery action (e.g. "Try again", "Choose another file"). Use this
 * instead of a bare message so a failure never dead-ends the user.
 *
 * `onRetry`/`retryLabel` render an outline recovery button; `secondary` renders
 * an extra ghost action beside it. The component is presentational — callers own
 * what recovery does.
 */
export function RecoverableError({
  title,
  message,
  detail,
  onRetry,
  retryLabel = "Try again",
  secondary,
  className,
}: {
  title: string;
  message: ReactNode;
  /** Coarse, non-sensitive extra context (e.g. an error category). */
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  secondary?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-red-300"
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-red-50">{title}</p>
          <p className="text-red-100/90">{message}</p>
          {detail && <p className="text-xs text-red-200/70">{detail}</p>}
        </div>
      </div>
      {(onRetry || secondary) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {retryLabel}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Privacy / security assurance
 * ------------------------------------------------------------------ */

export type AssuranceTone = "privacy" | "info" | "muted";

const ASSURANCE_STYLES: Record<AssuranceTone, { box: string; icon: string }> = {
  privacy: {
    box: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100",
    icon: "text-emerald-300",
  },
  info: {
    box: "border-blue-400/25 bg-blue-400/[0.06] text-blue-100",
    icon: "text-blue-300",
  },
  muted: {
    box: "border-white/10 bg-white/[0.03] text-slate-300",
    icon: "text-slate-400",
  },
};

/**
 * A reassurance line — a shield icon plus a short, honest privacy/security
 * statement. Reused wherever the product needs to remind the user that files
 * stay on their device (or explain exactly what a secure-worker step will do).
 */
export function AssuranceNote({
  children,
  tone = "privacy",
  className,
}: {
  children: ReactNode;
  tone?: AssuranceTone;
  className?: string;
}) {
  const styles = ASSURANCE_STYLES[tone];
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs leading-relaxed",
        styles.box,
        className,
      )}
    >
      <ShieldCheck
        className={cn("mt-0.5 size-4 shrink-0", styles.icon)}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 *  Capability row (used by the /status page)
 * ------------------------------------------------------------------ */

/** A small check/neutral glyph pair for "does this run here / upload files". */
export function AvailabilityGlyph({ available }: { available: boolean }) {
  return available ? (
    <CheckCircle2 className="size-4 text-emerald-300" aria-hidden />
  ) : (
    <MinusCircle className="size-4 text-slate-400" aria-hidden />
  );
}

/** A titled info card wrapper used to group status content on the page. */
export function StatusCard({
  title,
  badge,
  children,
  icon: Icon = Info,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  icon?: typeof Info;
}) {
  return (
    <div className="bg-surface-2 flex flex-col gap-4 rounded-2xl border border-white/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
          <Icon className="size-4 text-slate-400" aria-hidden />
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </div>
  );
}
