// @vitest-environment node
/**
 * The Node scanner resolver: it must wire the REAL ClamAV scanner (over an injected
 * transport, so no socket is opened) exactly when a usable clamd endpoint is
 * configured, and the honest no-op in every other state — while never leaking the
 * endpoint value into the reported capability.
 */
import { describe, expect, it } from "vitest";
import { resolveWorkerScanner } from "./node";
import { fakeScanner } from "./fake";
import { scanInfected, type MalwareScanInput } from "./types";
import type { ClamavTransport } from "./clamav";

const empty: MalwareScanInput = { tool: "t", inputs: [] };
const pdf: MalwareScanInput = {
  tool: "compress-pdf",
  inputs: [
    { fileId: "f", filename: "d.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) },
  ],
};

/** A transport that always returns one fixed reply — no socket. */
function fixedTransport(reply: string): ClamavTransport {
  const b = new Uint8Array(reply.length);
  for (let i = 0; i < reply.length; i++) b[i] = reply.charCodeAt(i);
  return { async roundtrip() { return b; } };
}

describe("resolveWorkerScanner", () => {
  it("wires the honest no-op when nothing is configured", async () => {
    const scanner = resolveWorkerScanner({});
    expect(scanner.capability().active).toBe(false);
    expect(scanner.capability().provider).toBe("not-configured");
    expect((await scanner.scan(empty)).verdict).toBe("skipped");
  });

  it("wires the no-op (disabled) when explicitly turned off", async () => {
    const scanner = resolveWorkerScanner({ PDFXYZ_MALWARE_SCANNER: "disabled" });
    expect(scanner.capability().provider).toBe("disabled");
    expect((await scanner.scan(empty)).verdict).toBe("skipped");
  });

  it("wires the no-op (unavailable) for a selected-but-misconfigured scanner", async () => {
    const scanner = resolveWorkerScanner({ PDFXYZ_MALWARE_SCANNER: "clamav://" });
    expect(scanner.capability().active).toBe(false);
    expect(scanner.capability().provider).toBe("unavailable");
    expect((await scanner.scan(empty)).verdict).toBe("skipped");
  });

  it("wires the REAL clamav scanner over an injected transport when configured", async () => {
    const scanner = resolveWorkerScanner(
      { PDFXYZ_MALWARE_SCANNER: "clamav://clamd.internal:3310" },
      { transport: fixedTransport("stream: OK\0") },
    );
    expect(scanner.capability().active).toBe(true);
    expect(scanner.capability().provider).toBe("clamav");
    expect((await scanner.scan(pdf)).verdict).toBe("clean");
    // The endpoint value never appears in the reported capability.
    expect(JSON.stringify(scanner.capability())).not.toContain("clamd.internal");
    expect(JSON.stringify(scanner.capability())).not.toContain("PDFXYZ_");
  });

  it("honors required: an unreachable required scan is an error, an optional one skips", async () => {
    const failing: ClamavTransport = {
      async roundtrip() {
        throw new Error("boom");
      },
    };
    const required = resolveWorkerScanner(
      {
        PDFXYZ_MALWARE_SCANNER: "clamav://clamd.internal:3310",
        PDFXYZ_WORKER_REQUIRE_SCAN: "true",
      },
      { transport: failing },
    );
    expect((await required.scan(pdf)).verdict).toBe("error");

    const optional = resolveWorkerScanner(
      { PDFXYZ_MALWARE_SCANNER: "clamav://clamd.internal:3310" },
      { transport: failing },
    );
    expect((await optional.scan(pdf)).verdict).toBe("skipped");
  });

  it("wires a unix-socket endpoint the same way (over an injected transport)", async () => {
    const scanner = resolveWorkerScanner(
      { PDFXYZ_MALWARE_SCANNER: "clamav+unix:///var/run/clamav/clamd.ctl" },
      { transport: fixedTransport("stream: OK\0") },
    );
    expect(scanner.capability().provider).toBe("clamav");
    expect((await scanner.scan(pdf)).verdict).toBe("clean");
  });

  it("uses an injected scanner verbatim (the test seam)", async () => {
    const scanner = resolveWorkerScanner(
      { PDFXYZ_MALWARE_SCANNER: "clamav://clamd.internal:3310" },
      { scanner: fakeScanner(scanInfected()) },
    );
    expect((await scanner.scan(pdf)).verdict).toBe("infected");
  });
});
