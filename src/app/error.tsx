"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportClientError } from "@/lib/telemetry";
import { useUploadDisclosure } from "@/components/telemetry/upload-disclosure";

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
  const disclosure = useUploadDisclosure();

  useEffect(() => {
    reportClientError(error, "route", { digest: error.digest });
  }, [error]);

  return (
    <div className="grid min-h-[70vh] place-items-center py-20">
      {/*
       * Container's classes, written out rather than imported. This boundary
       * loads on every page, and Container was the one module only it and
       * the root layout (SiteHeader) imported: at 287 bytes it can never reach
       * webpack's 20,000-byte shared-chunk minimum, so every page downloaded
       * it twice (src/deploy/first-load-duplicates.test.ts). Keep these in
       * step with src/components/ui/container.tsx.
       */}
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-8 px-5 text-center sm:px-8">
        {/* The one display moment on the page gets the rubrication accent. */}
        <span className="font-display text-accent text-6xl font-medium tracking-tight sm:text-7xl">
          Oops
        </span>
        <div className="flex flex-col items-center gap-3">
          <h1 className="font-display text-fg text-2xl font-medium tracking-tight sm:text-3xl">
            Something went wrong
          </h1>
          <p className="text-muted max-w-md text-base leading-relaxed text-pretty">
            An unexpected error interrupted this page.{" "}
            {disclosure ? `${disclosure} ` : ""}Try again, or head back home.
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
          <p className="text-muted font-mono text-xs">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
