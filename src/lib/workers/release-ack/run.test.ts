import { describe, expect, it } from "vitest";
import { runReleaseAck } from "./run";
import { makeArgs, makeProvider, publishablePack, blockedPack, tamperedPack, NOW } from "./fixtures";

describe("runReleaseAck", () => {
  it("acknowledges a publishable pack accepted → exit 0", async () => {
    const run = await runReleaseAck(makeArgs({ decision: "accepted" }), makeProvider(publishablePack()));
    expect(run.exitCode).toBe(0);
    expect(run.result.ack.verdict).toBe("acknowledged");
    expect(run.result.generatedAt).toBe(NOW);
    const parsed = JSON.parse(run.output);
    expect(parsed.schema).toBe("pdfxyz.release-ack/1");
  });

  it("rejects a blocked pack → exit 4", async () => {
    const run = await runReleaseAck(makeArgs({ decision: "accepted" }), makeProvider(blockedPack()));
    expect(run.exitCode).toBe(4);
    expect(run.result.ack.verdict).toBe("rejected");
  });

  it("a tampered pack is invalid → exit 4", async () => {
    const run = await runReleaseAck(makeArgs({ decision: "accepted" }), makeProvider(tamperedPack()));
    expect(run.exitCode).toBe(4);
    expect(run.result.ack.verdict).toBe("invalid");
  });

  it("an unreadable pack (read throws) is invalid, never a vacuous pass", async () => {
    const provider = {
      now: () => NOW,
      readFile: async () => {
        throw new Error("enoent");
      },
      readStdin: async () => "",
    };
    const run = await runReleaseAck(makeArgs({ decision: "accepted" }), provider);
    expect(run.result.ack.verdict).toBe("invalid");
    expect(run.result.source.state).toBe("unreadable");
  });

  it("reads the pack from stdin when the path is `-`", async () => {
    const provider = makeProvider(undefined, JSON.stringify(publishablePack()));
    const run = await runReleaseAck(makeArgs({ decision: "accepted", publishPackPath: "-" }), provider);
    expect(run.result.ack.verdict).toBe("acknowledged");
  });

  it("renders text when requested", async () => {
    const run = await runReleaseAck(makeArgs({ decision: "accepted", format: "text" }), makeProvider(publishablePack()));
    expect(run.output).toContain("release evidence handoff acknowledgement receipt");
  });
});
