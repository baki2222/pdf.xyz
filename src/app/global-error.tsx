"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry";
import { useUploadDisclosure } from "@/components/telemetry/upload-disclosure";

/**
 * Root error boundary. This only renders when the root layout itself fails, so
 * it must supply its own `<html>`/`<body>` and cannot rely on the app's global
 * stylesheet (the layout that imports it is bypassed). Styles are therefore
 * inlined so this last-resort page always renders. It reports the crash through
 * the privacy-safe reporter (no-op unless telemetry is configured).
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
          background: "#060611",
          color: "#e2e8f0",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              margin: "0 0 0.75rem",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: 1.6,
              color: "#94a3b8",
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
              borderRadius: "9999px",
              border: "none",
              padding: "0.6rem 1.25rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "#ffffff",
              background: "linear-gradient(90deg, #8b5cf6, #6366f1, #3b82f6)",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "#475569",
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
