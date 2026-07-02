// @vitest-environment node
/**
 * The ClamAV wire protocol is pure, so these tests pin request framing and reply
 * classification exactly — with no socket, no daemon, and no network — and prove the
 * classifier returns ONLY a kind (never the signature name or reply text), which is
 * what keeps a detection from ever leaking into a log.
 */
import { describe, expect, it } from "vitest";
import {
  buildInstreamRequest,
  isPong,
  parseInstreamReply,
  CLAMAV_PING_REQUEST,
  CLAMAV_VERSION_REQUEST,
} from "./clamav-protocol";

/** Decode bytes to a latin1 string for structural assertions. */
function text(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Read a big-endian uint32 length prefix. */
function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

describe("buildInstreamRequest", () => {
  it("frames a small payload as command + one length-prefixed chunk + zero terminator", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const req = buildInstreamRequest(payload);
    // Command is the NUL-terminated zINSTREAM.
    expect(text(req.subarray(0, 10))).toBe("zINSTREAM\0");
    // One length prefix = payload length, big-endian.
    expect(readU32(req, 10)).toBe(5);
    expect([...req.subarray(14, 19)]).toEqual([1, 2, 3, 4, 5]);
    // Zero-length terminating chunk.
    expect([...req.subarray(19, 23)]).toEqual([0, 0, 0, 0]);
    expect(req.length).toBe(23);
  });

  it("splits a payload into multiple length-prefixed frames at the chunk size", () => {
    const payload = new Uint8Array([10, 11, 12, 13, 14, 15, 16]); // 7 bytes
    const req = buildInstreamRequest(payload, 3); // frames of 3 → 3,3,1
    let off = 10; // past zINSTREAM\0
    const frames: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const len = readU32(req, off);
      off += 4;
      frames.push([...req.subarray(off, off + len)]);
      off += len;
    }
    expect(frames).toEqual([[10, 11, 12], [13, 14, 15], [16]]);
    // Terminator follows.
    expect([...req.subarray(off, off + 4)]).toEqual([0, 0, 0, 0]);
  });

  it("frames an empty payload as command + just the zero terminator", () => {
    const req = buildInstreamRequest(new Uint8Array());
    expect(text(req.subarray(0, 10))).toBe("zINSTREAM\0");
    expect([...req.subarray(10, 14)]).toEqual([0, 0, 0, 0]);
    expect(req.length).toBe(14);
  });
});

describe("PING / VERSION commands", () => {
  it("are the NUL-terminated z-prefixed commands", () => {
    expect(text(CLAMAV_PING_REQUEST)).toBe("zPING\0");
    expect(text(CLAMAV_VERSION_REQUEST)).toBe("zVERSION\0");
  });
});

describe("parseInstreamReply", () => {
  it("classifies a clean reply", () => {
    expect(parseInstreamReply("stream: OK\0")).toBe("clean");
    expect(parseInstreamReply("stream: OK")).toBe("clean");
  });

  it("classifies an infected reply WITHOUT returning the signature", () => {
    const kind = parseInstreamReply("stream: Win.Test.EICAR_HDB-1 FOUND\0");
    expect(kind).toBe("infected");
    // The classifier is a string union — it structurally cannot carry the signature.
    expect(JSON.stringify(kind)).not.toContain("EICAR");
  });

  it("recognizes a stream size-limit error before the generic ERROR bucket", () => {
    expect(parseInstreamReply("INSTREAM size limit exceeded. ERROR\0")).toBe(
      "size-limit",
    );
  });

  it("classifies another daemon error as error", () => {
    expect(parseInstreamReply("clamd internal ERROR\0")).toBe("error");
  });

  it("classifies an unrecognized or empty reply as unparseable", () => {
    expect(parseInstreamReply("garbage bytes")).toBe("unparseable");
    expect(parseInstreamReply("")).toBe("unparseable");
    expect(parseInstreamReply(new Uint8Array([0]))).toBe("unparseable");
  });
});

describe("isPong", () => {
  it("is true only for an exact PONG (NUL/whitespace tolerant)", () => {
    expect(isPong("PONG\0")).toBe(true);
    expect(isPong("PONG")).toBe(true);
    expect(isPong(" pong \0")).toBe(true);
    expect(isPong("PONGX")).toBe(false);
    expect(isPong("")).toBe(false);
  });
});
