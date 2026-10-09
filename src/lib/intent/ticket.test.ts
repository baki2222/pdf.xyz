// @vitest-environment node
/**
 * The ticket's life: idle → checking → ready → launching, and back.
 *
 * The rule the view leans on: nothing is offered while the files are being
 * measured, unless the owner has waited long enough — so the first
 * suggestion is the one the facts justify. And a launch that did not leave
 * the page (cancelled, or its files could not be stored) returns the ticket
 * to where it was, with the failure said.
 */
import { describe, expect, it } from "vitest";
import { quickFacts, type FileFacts } from "./facts";
import {
  EMPTY_TICKET,
  isMeasured,
  MAX_TICKET_FILES,
  ticketFiles,
  ticketReducer,
  type TicketAction,
  type TicketState,
} from "./ticket";

const file = (name: string) =>
  new File([`%PDF-1.7 ${name}`], name, { type: "application/pdf" });
const run = (actions: TicketAction[], from: TicketState = EMPTY_TICKET) =>
  actions.reduce(ticketReducer, from);
const add = (names: string[], start = 0): TicketAction => ({
  type: "add",
  via: "pick",
  files: names.map((name, i) => ({ id: `f${start + i}`, file: file(name) })),
});
const quick = (id: string, name: string): FileFacts =>
  quickFacts({ name, size: 10, type: "application/pdf" }, id);
/** Facts as complete as the tab makes them: bytes read, probe done. */
const measured = (id: string, name: string): FileFacts => ({
  ...quick(id, name),
  bytes: "PDF",
  pdf: {
    state: "checked",
    probe: {
      read: "ok",
      lock: "none",
      pages: 2,
      formFields: 0,
      sample: ["text", "text"],
    },
  },
});

describe("arrival", () => {
  it("files move an idle ticket to checking, each without facts yet", () => {
    const s = run([add(["a.pdf", "b.pdf"])]);
    expect(s.phase).toBe("checking");
    expect(s.entries.map((e) => [e.id, e.file.name, e.facts])).toEqual([
      ["f0", "a.pdf", null],
      ["f1", "b.pdf", null],
    ]);
    expect(s.via).toBe("pick");
    expect(s.arrival).toBe(1);
  });

  it("an empty arrival changes nothing", () => {
    expect(run([{ type: "add", via: "drop", files: [] }])).toBe(EMPTY_TICKET);
  });

  it(`ranks at most ${MAX_TICKET_FILES} files and keeps the rest for the workspace`, () => {
    const names = Array.from(
      { length: MAX_TICKET_FILES + 3 },
      (_, i) => `p${i}.pdf`,
    );
    const s = run([add(names)]);
    expect(s.entries).toHaveLength(MAX_TICKET_FILES);
    expect(s.overflow.map((f) => f.name)).toEqual(
      names.slice(MAX_TICKET_FILES),
    );
    // Open in workspace carries every one of them, in the order they came.
    expect(ticketFiles(s).map((f) => f.name)).toEqual(names);
  });

  it("the site's sample is marked as such", () => {
    const s = run([
      {
        type: "add",
        via: "pick",
        files: [{ id: "s", file: file("pdfxyz-sample.pdf"), sample: true }],
      },
    ]);
    expect(s.entries[0]!.sample).toBe(true);
    expect(run([add(["a.pdf"])]).entries[0]!.sample).toBe(false);
  });
});

describe("checking → ready", () => {
  it("waits until every file is measured", () => {
    let s = run([add(["a.pdf", "b.pdf"])]);
    s = ticketReducer(s, { type: "facts", facts: quick("f0", "a.pdf") });
    expect(s.phase).toBe("checking");
    s = ticketReducer(s, { type: "facts", facts: measured("f0", "a.pdf") });
    expect(s.phase).toBe("checking");
    s = ticketReducer(s, { type: "facts", facts: measured("f1", "b.pdf") });
    expect(s.phase).toBe("ready");
    expect(s.settled).toBe(true);
  });

  it("or until the owner has waited long enough — for this arrival only", () => {
    let s = run([add(["a.pdf"])]);
    // A settle for an earlier arrival is stale.
    expect(ticketReducer(s, { type: "settle", arrival: 0 })).toBe(s);
    s = ticketReducer(s, { type: "settle", arrival: s.arrival });
    expect(s.phase).toBe("ready");
  });

  it("facts for a file that is no longer here are ignored", () => {
    const s = run([add(["a.pdf"])]);
    expect(
      ticketReducer(s, { type: "facts", facts: measured("gone", "x.pdf") }),
    ).toBe(s);
  });

  it("more files make the ticket check again", () => {
    let s = run([add(["a.pdf"])]);
    s = ticketReducer(s, { type: "facts", facts: measured("f0", "a.pdf") });
    expect(s.phase).toBe("ready");
    s = ticketReducer(s, add(["b.pdf"], 1));
    expect(s.phase).toBe("checking");
    expect(s.settled).toBe(false);
    expect(s.entries[0]!.facts).not.toBeNull();
  });

  it("isMeasured: the bytes read, and a PDF's probe done or declined", () => {
    expect(isMeasured(null)).toBe(false);
    expect(isMeasured(quick("a", "a.pdf"))).toBe(false);
    expect(isMeasured(measured("a", "a.pdf"))).toBe(true);
    expect(
      isMeasured({
        ...quick("a", "a.pdf"),
        bytes: "PDF",
        pdf: { state: "not-checked", reason: "limit" },
      }),
    ).toBe(true);
    // Contradicted: the bytes said what it is, and nothing will probe it.
    expect(
      isMeasured({
        ...quick("a", "a.pdf"),
        bytes: "PNG",
        contradicted: true,
        pdf: null,
      }),
    ).toBe(true);
  });
});

describe("launching", () => {
  const ready = () =>
    run([add(["a.pdf"]), { type: "facts", facts: measured("f0", "a.pdf") }]);

  it("one launch at a time", () => {
    const s = ticketReducer(ready(), { type: "launch", target: "merge-pdf" });
    expect(s).toMatchObject({ phase: "launching", launching: "merge-pdf" });
    expect(ticketReducer(s, { type: "launch", target: "sign-pdf" })).toBe(s);
  });

  it("a launch that left the page keeps the ticket busy until it is gone", () => {
    const s = ticketReducer(ready(), { type: "launch", target: "merge-pdf" });
    for (const result of ["carried", "plain"] as const)
      expect(
        ticketReducer(s, { type: "launched", target: "merge-pdf", result }),
      ).toBe(s);
  });

  it("a cancelled launch returns to ready; a failed one says so", () => {
    const s = ticketReducer(ready(), { type: "launch", target: "merge-pdf" });
    expect(
      ticketReducer(s, {
        type: "launched",
        target: "merge-pdf",
        result: "cancelled",
      }),
    ).toMatchObject({ phase: "ready", launching: null, failed: null });
    expect(
      ticketReducer(s, {
        type: "launched",
        target: "merge-pdf",
        result: "failed",
      }),
    ).toMatchObject({
      phase: "ready",
      launching: null,
      failed: { target: "merge-pdf" },
    });
  });

  it("Open in workspace does not wait for facts", () => {
    const s = ticketReducer(run([add(["a.pdf"])]), {
      type: "launch",
      target: "workspace",
    });
    expect(s.phase).toBe("launching");
    expect(
      ticketReducer(s, {
        type: "launched",
        target: "workspace",
        result: "failed",
      }).phase,
    ).toBe("checking");
  });

  it("nothing launches from an idle ticket", () => {
    expect(
      ticketReducer(EMPTY_TICKET, { type: "launch", target: "merge-pdf" }),
    ).toBe(EMPTY_TICKET);
  });
});

describe("clear", () => {
  it("returns to idle, and a settle still in flight is stale", () => {
    const s = run([add(["a.pdf"]), { type: "clear" }]);
    expect(s).toMatchObject({ phase: "idle", entries: [], overflow: [] });
    expect(ticketReducer(s, { type: "settle", arrival: 1 })).toBe(s);
  });
});
