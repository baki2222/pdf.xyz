import { describe, expect, it } from "vitest";
import {
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs as parse,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs,
} from "./args";
import { DEFAULT_MAX_FINALIZATIONS, MAX_MAX_FINALIZATIONS } from "./types";

function ok(argv: string[]): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs {
  const r = parse(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs", () => {
  it("requires exactly one input mode", () => {
    expect(parse([])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--stdin"])).toMatchObject({ ok: false });
  });

  it("accepts repeated --file / --finalization (order preserved) and --stdin", () => {
    expect(ok(["--file=a", "--finalization=b", "--file=c"]).finalizationPaths).toEqual(["a", "b", "c"]);
    expect(ok(["--stdin"]).stdin).toBe(true);
    expect(ok(["--stdin"]).finalizationPaths).toBeUndefined();
  });

  it("defaults: json, pretty, max-finalizations=26, thresholds 0, no require-latest / strict-open", () => {
    const a = ok(["--file=a"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.maxFinalizations).toBe(DEFAULT_MAX_FINALIZATIONS);
    expect(a.maxOpen).toBe(0);
    expect(a.maxIncomplete).toBe(0);
    expect(a.requireLatestFinalized).toBe(false);
    expect(a.strictOpen).toBe(false);
  });

  it("--text selects the text format; conflicting formats are rejected", () => {
    expect(ok(["--file=a", "--text"]).format).toBe("text");
    expect(parse(["--file=a", "--json", "--text"])).toMatchObject({ ok: false });
  });

  it("--max-finalizations rejects < 1 / non-integers and clamps to the hard max", () => {
    expect(parse(["--file=a", "--max-finalizations=0"])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--max-finalizations=x"])).toMatchObject({ ok: false });
    expect(ok(["--file=a", "--max-finalizations=5"]).maxFinalizations).toBe(5);
    expect(ok(["--file=a", `--max-finalizations=${MAX_MAX_FINALIZATIONS + 50}`]).maxFinalizations).toBe(
      MAX_MAX_FINALIZATIONS,
    );
  });

  it("--max-open / --max-incomplete accept non-negative integers, reject negatives", () => {
    expect(ok(["--file=a", "--max-open=2", "--max-incomplete=3"])).toMatchObject({ maxOpen: 2, maxIncomplete: 3 });
    expect(parse(["--file=a", "--max-open=-1"])).toMatchObject({ ok: false });
  });

  it("--require-latest-finalized and --strict-open are boolean flags", () => {
    const a = ok(["--file=a", "--require-latest-finalized", "--strict-open"]);
    expect(a.requireLatestFinalized).toBe(true);
    expect(a.strictOpen).toBe(true);
  });

  it("--output cannot be stdin, cannot duplicate, and is not echoed on error", () => {
    expect(parse(["--file=a", "--output=-"])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--output=x", "--output=y"])).toMatchObject({ ok: false });
    expect(ok(["--file=a", "--output=out.json"]).outputPath).toBe("out.json");
  });

  it("unknown flags and missing values are usage errors", () => {
    expect(parse(["--file=a", "--nope"])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--max-open"])).toMatchObject({ ok: false });
  });

  it("--help short-circuits to help", () => {
    expect(parse(["--help"])).toMatchObject({ ok: true, kind: "help" });
    expect(parse(["-h"])).toMatchObject({ ok: true, kind: "help" });
  });

  it("takes a value from the next token when not inline", () => {
    expect(ok(["--file", "a", "--max-open", "4"])).toMatchObject({ maxOpen: 4 });
  });
});
