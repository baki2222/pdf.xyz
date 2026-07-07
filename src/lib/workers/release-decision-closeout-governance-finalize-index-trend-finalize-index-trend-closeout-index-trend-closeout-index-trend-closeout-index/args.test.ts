import { describe, expect, it } from "vitest";
import {
  parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs as parse,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs,
} from "./args";
import { DEFAULT_MAX_CLOSEOUTS, MAX_MAX_CLOSEOUTS } from "./types";

function ok(argv: string[]): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs {
  const r = parse(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs", () => {
  it("requires exactly one input mode", () => {
    expect(parse([])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--stdin"])).toMatchObject({ ok: false });
  });

  it("accepts repeated --file / --closeout (order preserved) and --stdin", () => {
    expect(ok(["--file=a", "--closeout=b", "--file=c"]).closeoutPaths).toEqual(["a", "b", "c"]);
    expect(ok(["--stdin"]).stdin).toBe(true);
    expect(ok(["--stdin"]).closeoutPaths).toBeUndefined();
  });

  it("defaults: json, pretty, max-closeouts=26, thresholds 0, no strict-open", () => {
    const a = ok(["--file=a"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.maxCloseouts).toBe(DEFAULT_MAX_CLOSEOUTS);
    expect(a.maxOpen).toBe(0);
    expect(a.maxIncomplete).toBe(0);
    expect(a.strictOpen).toBe(false);
  });

  it("--text selects the text format; conflicting formats are rejected", () => {
    expect(ok(["--file=a", "--text"]).format).toBe("text");
    expect(parse(["--file=a", "--json", "--text"])).toMatchObject({ ok: false });
  });

  it("--max-closeouts rejects < 1 / non-integers and clamps to the hard max", () => {
    expect(parse(["--file=a", "--max-closeouts=0"])).toMatchObject({ ok: false });
    expect(parse(["--file=a", "--max-closeouts=x"])).toMatchObject({ ok: false });
    expect(ok(["--file=a", "--max-closeouts=5"]).maxCloseouts).toBe(5);
    expect(ok(["--file=a", `--max-closeouts=${MAX_MAX_CLOSEOUTS + 50}`]).maxCloseouts).toBe(MAX_MAX_CLOSEOUTS);
  });

  it("--max-open / --max-incomplete accept non-negative integers, reject negatives", () => {
    expect(ok(["--file=a", "--max-open=2", "--max-incomplete=3"])).toMatchObject({ maxOpen: 2, maxIncomplete: 3 });
    expect(parse(["--file=a", "--max-open=-1"])).toMatchObject({ ok: false });
  });

  it("--strict-open is a boolean flag; the removed --require-latest-closed is now an unknown option", () => {
    expect(ok(["--file=a", "--strict-open"]).strictOpen).toBe(true);
    expect(parse(["--file=a", "--require-latest-closed"])).toMatchObject({ ok: false });
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
