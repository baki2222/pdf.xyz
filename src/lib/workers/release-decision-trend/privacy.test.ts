import { describe, expect, it } from "vitest";
import { NOW, makeArgs, makeProvider, makeTrend, stableWindow, watchWindow } from "./fixtures";
import { renderReleaseDecisionTrend } from "./render";
import { runReleaseDecisionTrend } from "./run";

/** Locator-shaped hostile tokens an ingested window might try to smuggle — none may reach the trend output. */
const HOSTILE = [
  "AKIAIOSFODNN7EXAMPLE",
  "s3://acme-releases/prod/build-4210.json",
  "https://evil.example.com/callback?token=abc",
  "/var/secrets/reviewer.pem",
  "reviewer@acme.example.com",
  "release-2026-07-04-hotfix",
  "Bearer sk-live-0123456789abcdef",
  "OCR: patient name John Q. Public, SSN 123-45-6789",
  "us-east-1",
  "wJ/alrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
];

/**
 * Clone a real window and stuff hostile strings into every non-load-bearing carrier (the window's own stamp, its
 * prose, its per-point / per-reason detail, its index detail, and a stray extra field). The trust boundary reconstructs
 * only bounded enums + integers, so none of these may survive into the trend.
 */
function hostileWindow(): Record<string, unknown> {
  const w = JSON.parse(JSON.stringify(stableWindow())) as Record<string, unknown> & {
    generatedAt: string;
    caveats: string[];
    guidance: string[];
    index: { detail: string };
    points: { detail: string }[];
    reasons: { detail: string }[];
  };
  w.generatedAt = `2000-01-01T00:00:00.000Z ${HOSTILE[0]}`;
  w.caveats = [...HOSTILE];
  w.guidance = [...HOSTILE];
  w.index.detail = HOSTILE.join(" ");
  for (const p of w.points) p.detail = HOSTILE.join(" ");
  for (const r of w.reasons) r.detail = HOSTILE.join(" ");
  (w as Record<string, unknown>).smuggled = { key: HOSTILE[1], note: HOSTILE[7] };
  return w;
}

/** Assert no hostile token appears anywhere in `text`. */
function expectNoLeak(text: string): void {
  for (const token of HOSTILE) {
    expect(text, `leaked: ${token}`).not.toContain(token);
  }
}

describe("release-decision-trend privacy — content-free by reconstruction", () => {
  it("never echoes an ingested window's stamp, prose, or smuggled fields (json + text)", () => {
    const result = makeTrend([hostileWindow(), watchWindow(), hostileWindow()]);
    expectNoLeak(renderReleaseDecisionTrend(result, "json"));
    expectNoLeak(renderReleaseDecisionTrend(result, "text"));
    // The trend carries its OWN stamp, not the ingested window's hostile one.
    expect(result.generatedAt).toBe(NOW);
    // The hostile windows still summarize cleanly as usable stable windows.
    expect(result.summary.windowsUsable).toBe(3);
  });

  it("never echoes a hostile input path or stdin payload on any run", async () => {
    // A hostile NDJSON line (a non-JSON string) is dropped to an unreadable window, never echoed.
    const stdin = `${JSON.stringify(stableWindow())}\n${HOSTILE.join(" ")}\n`;
    const run = await runReleaseDecisionTrend(makeArgs([], { stdin: true, windowPaths: undefined }), makeProvider([], stdin));
    expectNoLeak(run.output);
    expect(run.result.summary.windowsUnreadable).toBe(1);
  });

  it("carries no reviewer identity, path, bucket, url, or key even from a hostile window (whole-object scan)", () => {
    const result = makeTrend([hostileWindow()]);
    const blob = JSON.stringify(result);
    for (const token of ["AKIA", "s3://", "https://", "@acme", "Bearer", "/var/secrets", "SSN"]) {
      expect(blob, `leaked: ${token}`).not.toContain(token);
    }
  });
});
