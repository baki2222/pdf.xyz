"use client";

import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { reportClientError } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import { useUploadDisclosure } from "./upload-disclosure";

/**
 * A small, reusable React error boundary that reports render-time crashes to the
 * privacy-safe telemetry reporter and shows a localized, retryable fallback —
 * without tearing down the whole route the way the App Router `error.tsx` net
 * does. Wrap it around a heavy client surface (e.g. the in-browser tool runner)
 * so one component's failure keeps the surrounding page — its title, SEO copy,
 * and navigation — intact.
 *
 * Only crash telemetry (coarse name/message/stack, all redacted) is sent, and
 * only when telemetry is configured; otherwise reporting is a no-op.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fixed triage label for the catch site, e.g. "tool-runner". Not user data. */
  boundary?: string;
  /** Optional custom fallback; receives a `retry` to re-attempt the subtree. */
  fallback?: (props: { retry: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(
    error: unknown,
    info: { componentStack?: string | null },
  ): void {
    reportClientError(error, "boundary", {
      boundary: this.props.boundary,
      extra: info?.componentStack
        ? { componentStack: info.componentStack }
        : undefined,
    });
  }

  private readonly retry = (): void => this.setState({ hasError: false });

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ retry: this.retry });
    return <DefaultBoundaryFallback retry={this.retry} />;
  }
}

/**
 * The default in-place fallback: an accessible, retryable notice card.
 *
 * Thirteen of the fourteen boundaries on `/tools/[slug]` wrap a secure-worker
 * panel that uploads, so the upload line is asked for rather than asserted —
 * see `useUploadDisclosure`.
 */
function DefaultBoundaryFallback({ retry }: { retry: () => void }) {
  const disclosure = useUploadDisclosure();

  return (
    <div
      role="alert"
      className="border-line bg-wash flex flex-col items-center gap-4 rounded-[4px] border px-6 py-12 text-center"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-fg text-base font-semibold">
          This tool hit an unexpected snag
        </p>
        <p className="text-muted mx-auto max-w-sm text-sm leading-relaxed">
          {disclosure ? `${disclosure} ` : ""}You can try again, or reload the
          page.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={retry}>
        <RotateCcw className="size-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}
