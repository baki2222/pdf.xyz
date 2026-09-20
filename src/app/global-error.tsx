"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry";
import { useUploadDisclosure } from "@/components/telemetry/upload-disclosure";

/**
 * Root error boundary. This only renders when the root layout itself fails, so
 * it must supply its own `<html>`/`<body>` and cannot rely on the app's global
 * stylesheet (the layout that imports it is bypassed). Styles are therefore
 * self-contained so this last-resort page always renders. It reports the crash
 * through the privacy-safe reporter (no-op unless telemetry is configured).
 *
 * The palette is the prepress system's, hand-inlined: cool paper and graphite
 * ink, flipping to near-black in dark scheme — the same values as
 * `.theme-paper` in globals.css, which this page cannot import. Fonts stay
 * system, because next/font is part of the layout this boundary replaces.
 *
 * THIS FILE IS A COPY, AND A COPY GOES STALE SILENTLY. It cannot import the
 * stylesheet, so every value below is a duplicate of one in globals.css with
 * nothing tying the two together — and on 2026-09-20 that is exactly what
 * happened: the cream/serif palette shipped here survived the redesign
 * untouched, leaving the root error boundary as the only surface still
 * painting the retired design, under a docblock that claimed it matched.
 * When a `--sf-*` value changes in globals.css, change it here in the same
 * commit and re-read this paragraph.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const disclosure = useUploadDisclosure();

  useEffect(() => {
    reportClientError(error, "global", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "var(--ge-canvas, #f4f6f8)",
          color: "var(--ge-fg, #10151a)",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          padding: "2rem",
        }}
      >
        <style>{`
          :root {
            color-scheme: light;
            --ge-canvas: #f4f6f8;
            --ge-fg: #10151a;
            --ge-muted: #454e57;
            --ge-faint: #59636e;
            --ge-invert: #10151a;
            --ge-fg-invert: #f4f7f9;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              color-scheme: dark;
              --ge-canvas: #0c1014;
              --ge-fg: #e8edf1;
              --ge-muted: #a8b3bd;
              --ge-faint: #909ba6;
              --ge-invert: #e8edf1;
              --ge-fg-invert: #0c1014;
            }
          }
        `}</style>
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1
            style={{
              fontFamily:
                'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
              fontSize: "1.5rem",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              margin: "0 0 0.75rem",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: 1.6,
              color: "var(--ge-muted, #454e57)",
              margin: "0 0 1.5rem",
            }}
          >
            The app hit an unexpected error.{disclosure ? ` ${disclosure}` : ""}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              borderRadius: "6px",
              border: "none",
              padding: "0.6rem 1.25rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--ge-fg-invert, #f4f7f9)",
              background: "var(--ge-invert, #10151a)",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                fontFamily:
                  'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                color: "var(--ge-faint, #59636e)",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
