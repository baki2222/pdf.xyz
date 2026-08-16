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
 * The palette is the paper/ink system's, hand-inlined: warm paper and
 * near-black ink, flipping to warm charcoal in dark scheme — the same values
 * as `.theme-paper` in globals.css, which this page cannot import. Fonts stay
 * system (next/font is part of the layout this boundary replaces); Georgia is
 * the same serif fallback `--font-display` declares.
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
          background: "var(--ge-canvas, #f7f5f2)",
          color: "var(--ge-fg, #1c1917)",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          padding: "2rem",
        }}
      >
        <style>{`
          :root {
            color-scheme: light;
            --ge-canvas: #f7f5f2;
            --ge-fg: #1c1917;
            --ge-muted: #57534e;
            --ge-faint: #6e6862;
            --ge-invert: #1c1917;
            --ge-fg-invert: #f7f5f2;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              color-scheme: dark;
              --ge-canvas: #171412;
              --ge-fg: #ece7e1;
              --ge-muted: #b3aba2;
              --ge-faint: #9c948b;
              --ge-invert: #ece7e1;
              --ge-fg-invert: #171412;
            }
          }
        `}</style>
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1
            style={{
              fontFamily: 'Georgia, Cambria, "Times New Roman", serif',
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
              color: "var(--ge-muted, #57534e)",
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
              borderRadius: "3px",
              border: "none",
              padding: "0.6rem 1.25rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--ge-fg-invert, #f7f5f2)",
              background: "var(--ge-invert, #1c1917)",
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
                color: "var(--ge-faint, #6e6862)",
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
