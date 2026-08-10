// @vitest-environment node
/**
 * The ClamAV scanner over an INJECTED transport — so every branch (clean, infected,
 * unreachable, oversized, multi-input) is exercised with NO socket, daemon, or
 * network. The load-bearing assertions: `required` decides fail-vs-bypass, an
 * `infected` detection always blocks, and no signature/detail ever leaks.
 */
import { describe, expect, it } from "vitest";
import {
  ClamavTransportError,
  createClamavScanner,
  pingClamav,
  type ClamavScannerConfig,
  type ClamavTransport,
} from "./clamav";
import type { MalwareScanInput } from "./types";

/** Encode an ASCII reply to bytes (the daemon speaks ASCII status lines). */
function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

interface RecordedCall {
  request: Uint8Array;
  timeoutMs: number;
}

/** A transport that replays canned replies (or throws) per round-trip and records calls. */
function scriptedTransport(
  script: Array<Uint8Array | string | Error>,
): ClamavTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  return {
    calls,
    async roundtrip(request, opts) {
      calls.push({ request, timeoutMs: opts.timeoutMs });
      const next = script[i++] ?? "stream: OK\0";
      if (next instanceof Error) throw next;
      return typeof next === "string" ? bytes(next) : next;
    },
  };
}

const CONFIG: ClamavScannerConfig = {
  timeoutMs: 5_000,
  maxBytes: 1_000,
  required: true,
};

function input(...files: Uint8Array[]): MalwareScanInput {
  return {
    tool: "compress-pdf",
    inputs: files.map((b, n) => ({
      fileId: `f_${n}`,
      filename: `doc-${n}.pdf`,
      contentType: "application/pdf",
      bytes: b,
    })),
  };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe("createClamavScanner — verdicts", () => {
  it("streams the input as INSTREAM and returns clean on OK", async () => {
    const transport = scriptedTransport(["stream: OK\0"]);
    const scanner = createClamavScanner({ transport, config: CONFIG });
    const result = await scanner.scan(input(PDF));
    expect(result.verdict).toBe("clean");
    expect(result.scanned).toBe(true);
    // The request is a real INSTREAM frame carrying the bytes.
    const req = transport.calls[0]!.request;
    expect(String.fromCharCode(...req.subarray(0, 9))).toBe("zINSTREAM");
    expect(transport.calls[0]!.timeoutMs).toBe(5_000);
  });

  it("blocks an infected input and never surfaces the signature", async () => {
    const transport = scriptedTransport([
      "stream: Win.Test.EICAR_HDB-1 FOUND\0",
    ]);
    const scanner = createClamavScanner({ transport, config: CONFIG });
    const result = await scanner.scan(input(PDF));
    expect(result.verdict).toBe("infected");
    expect(result.scanned).toBe(true);
    expect(JSON.stringify(result)).not.toContain("EICAR");
    expect(JSON.stringify(result)).not.toContain("Win.Test");
  });

  it("infected ALWAYS blocks, even when scanning is optional", async () => {
    const transport = scriptedTransport(["stream: X FOUND\0"]);
    const scanner = createClamavScanner({
      transport,
      config: { ...CONFIG, required: false },
    });
    expect((await scanner.scan(input(PDF))).verdict).toBe("infected");
  });
});

describe("createClamavScanner — required vs optional degradation", () => {
  const cases: Array<{ label: string; script: Array<string | Error> }> = [
    { label: "unreachable", script: [new ClamavTransportError("unreachable")] },
    { label: "timeout", script: [new ClamavTransportError("timeout")] },
    { label: "daemon error", script: ["clamd internal ERROR\0"] },
    { label: "unparseable", script: ["nonsense reply"] },
  ];
  for (const { label, script } of cases) {
    it(`required: ${label} → retryable error`, async () => {
      const scanner = createClamavScanner({
        transport: scriptedTransport(script),
        config: { ...CONFIG, required: true },
      });
      const result = await scanner.scan(input(PDF));
      expect(result.verdict).toBe("error");
      expect(result.scanned).toBe(false);
    });
    it(`optional: ${label} → retryable error (an active scanner is never bypassed)`, async () => {
      // The old fold degraded this to `skipped` and the job processed
      // UNSCANNED during any clamd outage — while every user-facing surface
      // said every file is scanned before processing. Mode-independent now:
      // an outage queues work, it does not bypass the scanner.
      const scanner = createClamavScanner({
        transport: scriptedTransport(script),
        config: { ...CONFIG, required: false },
      });
      const result = await scanner.scan(input(PDF));
      expect(result.verdict).toBe("error");
      expect(result.scanned).toBe(false);
    });
  }

  it("required: a stream size-limit reply is terminal invalid", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport(["INSTREAM size limit exceeded. ERROR\0"]),
      config: { ...CONFIG, required: true },
    });
    expect((await scanner.scan(input(PDF))).verdict).toBe("invalid");
  });

  it("optional: a stream size-limit reply is terminal invalid too (mode-independent)", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport(["INSTREAM size limit exceeded. ERROR\0"]),
      config: { ...CONFIG, required: false },
    });
    expect((await scanner.scan(input(PDF))).verdict).toBe("invalid");
  });
});

describe("createClamavScanner — client-side size ceiling", () => {
  it("required: an over-limit input is invalid and is NEVER streamed", async () => {
    const transport = scriptedTransport(["stream: OK\0"]);
    const scanner = createClamavScanner({
      transport,
      config: { timeoutMs: 5_000, maxBytes: 3, required: true },
    });
    const result = await scanner.scan(input(new Uint8Array([1, 2, 3, 4])));
    expect(result.verdict).toBe("invalid");
    expect(transport.calls.length).toBe(0); // never connected
  });

  it("an ACTIVE scanner plus an over-ceiling input means the job is not processed — optional mode included", async () => {
    // The relationship this pins (owner ruling, 2026-08-10): scanner active +
    // input above the scan ceiling ⇒ refuse. The old fold said `skipped` here,
    // and a 26–100 MB upload was processed unscanned in production under copy
    // that says every file is scanned before any processor touches it.
    // `skipped` is honest only when nothing was there to do the scanning.
    const transport = scriptedTransport(["stream: OK\0"]);
    const scanner = createClamavScanner({
      transport,
      config: { timeoutMs: 5_000, maxBytes: 3, required: false },
    });
    expect(
      (await scanner.scan(input(new Uint8Array([1, 2, 3, 4])))).verdict,
    ).toBe("invalid");
    expect(transport.calls.length).toBe(0); // still never streamed
  });
});

describe("createClamavScanner — multi-input aggregation", () => {
  it("all clean → clean", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport(["stream: OK\0", "stream: OK\0"]),
      config: CONFIG,
    });
    expect((await scanner.scan(input(PDF, PDF))).verdict).toBe("clean");
  });

  it("any infected → infected (a detection wins over a clean sibling)", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport(["stream: OK\0", "stream: X FOUND\0"]),
      config: CONFIG,
    });
    expect((await scanner.scan(input(PDF, PDF))).verdict).toBe("infected");
  });

  it("required: a clean + an unscannable sibling → error (cannot vouch for all)", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport([
        "stream: OK\0",
        new ClamavTransportError("timeout"),
      ]),
      config: { ...CONFIG, required: true },
    });
    expect((await scanner.scan(input(PDF, PDF))).verdict).toBe("error");
  });

  it("optional: a clean + an unscannable sibling → error (cannot vouch for all, either mode)", async () => {
    const scanner = createClamavScanner({
      transport: scriptedTransport([
        "stream: OK\0",
        new ClamavTransportError("timeout"),
      ]),
      config: { ...CONFIG, required: false },
    });
    expect((await scanner.scan(input(PDF, PDF))).verdict).toBe("error");
  });
});

describe("createClamavScanner — capability", () => {
  it("reports an active clamav provider, content-free", () => {
    const cap = createClamavScanner({
      transport: scriptedTransport([]),
      config: CONFIG,
    }).capability();
    expect(cap.active).toBe(true);
    expect(cap.provider).toBe("clamav");
    expect(JSON.stringify(cap)).not.toMatch(
      /PDFXYZ_|3310|localhost|127\.0\.0\.1/,
    );
  });
});

describe("pingClamav", () => {
  it("is true on PONG and false on any transport failure", async () => {
    expect(await pingClamav(scriptedTransport(["PONG\0"]), 1_000)).toBe(true);
    expect(
      await pingClamav(
        scriptedTransport([new ClamavTransportError("unreachable")]),
        1_000,
      ),
    ).toBe(false);
    expect(await pingClamav(scriptedTransport(["WAT\0"]), 1_000)).toBe(false);
  });
});
