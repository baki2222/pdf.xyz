"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportClientError } from "@/lib/telemetry";

/**
 * Route-segment error boundary. Catches render errors below the root layout,
 * reports them (privacy-safe, no-op unless telemetry is configured), and offers
 * a retry plus a way home. We deliberately show generic copy — never the raw
 * error message — so internal detail is not surfaced to the user; the opaque
 * `digest` is shown only as a support reference.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "route", { digest: error.digest });
  }, [error]);

  return (
    <div className="grid min-h-[70vh] place-items-center py-20">
      <Container className="flex flex-col items-center gap-8 text-center">
        <span className="bg-gradient-to-br from-white to-slate-500 bg-clip-text text-6xl font-bold tracking-tight text-transparent sm:text-7xl">
          Oops
        </span>
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Something went wrong
          </h1>
          <p className="max-w-md text-pretty text-base leading-relaxed text-slate-400">
            An unexpected error interrupted this page. Nothing was uploaded and
            your files stay on your device. Try again, or head back home.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button variant="primary" size="md" onClick={() => reset()}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
          <Link
            href="/"
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            Back to home
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        {error.digest && (
          <p className="text-xs text-slate-600">Reference: {error.digest}</p>
        )}
      </Container>
    </div>
  );
}
