// @vitest-environment node
/**
 * The capability probes must be able to say NO.
 *
 * Their whole reason for existing is that a hand-written `true` would have read
 * `true` throughout the nine days the running worker image had no chunking in
 * it — because it would have been written in `main`, and `main` was never the
 * problem. A probe that cannot return `false` is that boolean with extra steps.
 *
 * So each is exercised in both directions, and the negative direction uses the
 * function's own inputs rather than a stub: a ceiling large enough that nothing
 * needs splitting, and a cap loose enough that nothing is withheld. If the
 * planner were replaced by something that always returned one chunk, or a cap
 * that never bound, these go red.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
import { provesChunkedTranslate, provesDeliveryCap } from "./capability";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import {
  ADVERTISED_WORKER_CAPABILITIES,
  type ProvenWorkerCapabilities,
} from "../observability/snapshot";
import { emptyCapabilities } from "../heartbeat/factory";

describe("provesChunkedTranslate", () => {
  it("is true on an image that can split a long document", () => {
    expect(provesChunkedTranslate()).toBe(true);
  });

  it("NEGATIVE CONTROL: false when nothing needs splitting", () => {
    // A ceiling that swallows the whole proof document means one chunk, so the
    // splitting was never demonstrated. The probe must not report a capability
    // it did not observe — which is the entire distinction it exists to make.
    expect(provesChunkedTranslate(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("NEGATIVE CONTROL: false when every page is oversize", () => {
    // A ceiling below one page: nothing is chunked, everything is oversize.
    // Conservation still holds, so a probe that only checked conservation
    // would report `true` here — which is why it checks both.
    expect(provesChunkedTranslate(1)).toBe(false);
  });
});

describe("provesDeliveryCap", () => {
  it("is true on an image that enforces and names the bound", () => {
    expect(provesDeliveryCap()).toBe(true);
  });

  it("NEGATIVE CONTROL: false when the cap cannot bind", () => {
    // Below one page nothing is deliverable at all, so the page bound is never
    // the thing that stopped it and `boundBy` is not "pages".
    expect(provesDeliveryCap(1)).toBe(false);
  });

  it("costs nothing observable: no provider, no document, no I/O", () => {
    // The probes run at every worker start-up. They are pure functions over a
    // synthetic array — this is the assertion that keeps them that way, because
    // a probe that grew a network call would be a start-up dependency nobody
    // asked for.
    const before = Date.now();
    for (let i = 0; i < 200; i += 1) {
      provesChunkedTranslate();
      provesDeliveryCap();
    }
    expect(Date.now() - before).toBeLessThan(2_000);
  });
});

describe("the advertised set and the wire contract agree", () => {
  it("every advertised capability is a field a worker can publish", () => {
    /**
     * `ADVERTISED_WORKER_CAPABILITIES` (what the snapshot asks about) and
     * `HeartbeatCapabilities` (what a worker can answer with) are two lists
     * that must name the same things. A capability advertised with no wire
     * field would be permanently unproven and read as a live defect forever; a
     * wire field nobody advertises is a value nothing consumes.
     */
    const wire = Object.keys(
      emptyCapabilities() as unknown as Record<string, unknown>,
    );
    expect(
      ADVERTISED_WORKER_CAPABILITIES.length,
      "nothing is advertised, so the subsystem asks nothing",
    ).toBeGreaterThanOrEqual(2);

    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      expect(
        wire,
        `${capability.key} is advertised but no worker can publish it, so it ` +
          "would read as missing on every healthy deployment forever",
      ).toContain(capability.key);
    }
  });

  it("the proven shape covers exactly the advertised keys", () => {
    // A compile-time relationship made checkable at runtime too: the type is
    // derived from the list, so this catches the list and the type drifting if
    // anyone ever hand-writes the type.
    const proven: ProvenWorkerCapabilities = {
      chunkedTranslate: true,
      deliveryCap: true,
    };
    expect(Object.keys(proven).sort()).toEqual(
      ADVERTISED_WORKER_CAPABILITIES.map((c) => c.key).sort(),
    );
  });

  it("the ceiling the probes use is the one the engine uses", () => {
    // The probe's default ceiling has to be the real one, or it proves the
    // planner works at some number the product never uses.
    expect(TRANSLATE_MAX_INPUT_CHARS).toBeGreaterThan(0);
    expect(provesChunkedTranslate(TRANSLATE_MAX_INPUT_CHARS)).toBe(true);
  });
});

describe("the daemon PROVES the capabilities, it does not declare them", () => {
  it("publishes a computed value for every advertised capability", () => {
    /**
     * The property this whole file exists for, checked where it can actually be
     * broken. `chunkedTranslate: true` would compile, pass every test above,
     * and restore the original defect exactly — a boolean written in `main`
     * reporting on an image that is not `main`. Nothing else in the repo would
     * notice, because from the reader's side a proven `true` and a typed `true`
     * are the same byte.
     *
     * So the check is on the SHAPE of the value the daemon publishes: a call,
     * never a literal. It cannot tell a good prover from a bad one — the
     * negative controls above do that — but it can tell a prover from a claim.
     */
    const file = "scripts/worker-daemon.ts";
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    const values = new Map<string, TS.Node>();
    const walk = (node: TS.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        ADVERTISED_WORKER_CAPABILITIES.some(
          (c) => c.key === node.name.getText(),
        )
      ) {
        values.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);

    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      const value = values.get(capability.key);
      expect(
        value,
        `${file} never publishes ${capability.key}, so the running image can ` +
          "never prove it and the subsystem reads it as missing forever",
      ).toBeDefined();
      expect(
        value !== undefined && ts.isCallExpression(value),
        `${file} publishes ${capability.key} as a literal instead of calling a ` +
          "prover. A boolean written here describes `main`, and `main` was " +
          "never the thing that was wrong — the running image was.",
      ).toBe(true);
    }
  });
});
