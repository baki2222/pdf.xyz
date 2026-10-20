// @vitest-environment jsdom
/**
 * Option memory (`pdfxyz.options.v1`, redesign E.9 and E.14) keeps a few
 * choices between visits, and NEVER anything a person typed. Held three
 * ways, because each misses what the others see:
 *
 *  1. THE REGISTERED SCHEMAS. Every field of every schema in
 *     {@link OPTION_SCHEMAS} is an enum, a number or a boolean — there is no
 *     string kind to register — and each enum's values are the fixed list
 *     the picker offers, read from the module that owns it. The checker that
 *     says so is itself shown a string field and an empty enum (positive
 *     controls), so a checker that passes everything cannot hide here.
 *  2. THE STORE. Corrupted JSON, a wrong version, a value outside its field
 *     — each falls back to the default, field by field; a field the schema
 *     does not name is never written, whatever the caller passes.
 *  3. THE WIRE. A watermark's text and a custom page-number format are typed
 *     into the real editors, Run is pressed, and the raw stored JSON is read
 *     for them. Its positive control: the same JSON does hold the choices
 *     that are meant to be kept.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { ALIGN_OPTIONS } from "@/components/tools/runner/header-footer-runner";
import {
  FORMAT_PRESETS,
  PageNumbersEditor,
} from "@/components/tools/runner/page-numbers-runner";
import { WatermarkEditor } from "@/components/tools/runner/watermark-runner";
import type { LoadedPdf } from "@/components/tools/runner/use-single-pdf";
import { RASTER_RESOLUTIONS } from "@/lib/pdf/pdf-to-image";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { OPTIONS_STORAGE_KEY } from "./options-key";
import {
  OPTION_SCHEMAS,
  recallOptions,
  rememberOptions,
  schemaProblems,
} from "./option-memory";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  resetAnnouncer();
  window.localStorage.clear();
});

const raw = () => window.localStorage.getItem(OPTIONS_STORAGE_KEY);

describe("the registered schemas hold no free text", () => {
  const fields = Object.entries(OPTION_SCHEMAS).flatMap(([tool, schema]) =>
    Object.entries(schema).map(([name, field]) => ({ tool, name, field })),
  );

  it("health: every schema the spec lists is registered, and they have fields", () => {
    expect(Object.keys(OPTION_SCHEMAS).sort()).toEqual(
      ["header-footer", "page-numbers", "pdf-to-image", "watermark"].sort(),
    );
    expect(fields.length).toBeGreaterThanOrEqual(7);
  });

  it("every field is an enum, a number or a boolean", () => {
    for (const { tool, name, field } of fields)
      expect(["enum", "number", "boolean"], `${tool}.${name}`).toContain(
        field.kind,
      );
    for (const [tool, schema] of Object.entries(OPTION_SCHEMAS))
      expect(schemaProblems(schema), tool).toEqual([]);
  });

  it("positive controls: the checker refuses a string field and an empty enum", () => {
    expect(
      schemaProblems({ text: { kind: "string" } } as never),
    ).not.toEqual([]);
    expect(
      schemaProblems({ pick: { kind: "enum", values: [] } } as never),
    ).not.toEqual([]);
    expect(
      schemaProblems({
        pick: { kind: "enum", values: [7] },
      } as never),
    ).not.toEqual([]);
    expect(
      schemaProblems({
        n: { kind: "number", min: 5, max: 1, integer: true },
      } as never),
    ).not.toEqual([]);
  });

  it("each enum is the fixed list its picker offers, read from that picker's module", () => {
    const S = OPTION_SCHEMAS;
    expect(S["page-numbers"].position.values).toEqual(STAMP_POSITIONS);
    expect(S["page-numbers"].format.values).toEqual(
      FORMAT_PRESETS.map((p) => p.value),
    );
    expect(S["header-footer"].headerAlign.values).toEqual(
      ALIGN_OPTIONS.map((o) => o.value),
    );
    expect(S["header-footer"].footerAlign.values).toEqual(
      ALIGN_OPTIONS.map((o) => o.value),
    );
    expect(S["pdf-to-image"].resolution.values).toEqual(
      RASTER_RESOLUTIONS.map((r) => r.id),
    );
  });

  it("the watermark's schema has no field for its text", () => {
    expect(Object.keys(OPTION_SCHEMAS.watermark)).not.toContain("text");
  });
});

describe("the store", () => {
  it("round-trips the choices it is given", () => {
    rememberOptions("watermark", { opacity: 40, rotation: -30 });
    expect(recallOptions("watermark")).toEqual({ opacity: 40, rotation: -30 });
    rememberOptions("pdf-to-image", { resolution: "print" });
    expect(recallOptions("pdf-to-image")).toEqual({ resolution: "print" });
    // One tool's write keeps the other's.
    expect(recallOptions("watermark")).toEqual({ opacity: 40, rotation: -30 });
  });

  it("corrupted JSON, or a record of another shape, falls back to the defaults", () => {
    for (const bad of [
      "{not json",
      "null",
      "[]",
      '"text"',
      JSON.stringify({ version: 2, tools: { watermark: { opacity: 40 } } }),
      JSON.stringify({ version: 1, tools: [] }),
      JSON.stringify({ version: 1, tools: { watermark: "x" } }),
    ]) {
      window.localStorage.setItem(OPTIONS_STORAGE_KEY, bad);
      expect(recallOptions("watermark"), bad).toEqual({});
    }
  });

  it("a value outside its field is dropped, and the rest are kept", () => {
    window.localStorage.setItem(
      OPTIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tools: {
          "page-numbers": {
            position: "middle-of-nowhere",
            format: "Invoice {n} SECRET",
            startPage: 2.5,
            startAt: 7,
          },
          watermark: { opacity: 1000, rotation: "45" },
        },
      }),
    );
    expect(recallOptions("page-numbers")).toEqual({ startAt: 7 });
    expect(recallOptions("watermark")).toEqual({});
  });

  it("never writes a field its schema does not name, nor a value outside it", () => {
    rememberOptions("watermark", {
      opacity: 30,
      text: "TOP SECRET",
    } as never);
    rememberOptions("page-numbers", {
      format: "Invoice {n} SECRET",
      startAt: 3,
    } as never);
    const stored = raw()!;
    expect(stored).not.toContain("TOP SECRET");
    expect(stored).not.toContain("Invoice");
    expect(recallOptions("page-numbers")).toEqual({ startAt: 3 });
  });

  it("a browser that refuses storage remembers nothing and throws nothing", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      expect(() => rememberOptions("watermark", { opacity: 30 })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(recallOptions("watermark")).toEqual({});
  });
});

async function loaded(pages = 1): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]);
  const bytes = await doc.save();
  return {
    file: new File([new Uint8Array(bytes)], "doc.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount: pages,
    rotations: Array.from({ length: pages }, () => 0 as const),
    digitalSignatures: 0,
  };
}

describe("the wire: what the real editors store holds no typed text", () => {
  it("a watermark's text is typed and Run pressed: the text is not stored, its opacity is", async () => {
    const TYPED = "Quarterly-Board-Pack-7731";
    render(<WatermarkEditor pdf={await loaded()} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^text$/i), {
      target: { value: TYPED },
    });
    fireEvent.change(screen.getByLabelText(/^opacity/i), {
      target: { value: "37" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add watermark/i }));
    await screen.findByRole("group", { name: /watermark added/i });
    const stored = raw();
    // Positive control: something WAS stored, and it is the choice.
    expect(stored).not.toBeNull();
    expect(recallOptions("watermark").opacity).toBe(37);
    expect(stored).not.toContain(TYPED);
    expect(stored!.toLowerCase()).not.toContain("quarterly");
  });

  it("a custom page-number format is typed and Run pressed: it is not stored, the position is", async () => {
    const TYPED = "Dossier-{n}-Kestrel";
    render(<PageNumbersEditor pdf={await loaded(2)} onReset={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^custom format/i), {
      target: { value: TYPED },
    });
    fireEvent.click(screen.getByRole("radio", { name: /top right/i }));
    fireEvent.click(screen.getByRole("button", { name: /add page numbers/i }));
    await screen.findByRole("group", { name: /page numbers added/i });
    const stored = raw();
    expect(stored).not.toBeNull();
    expect(recallOptions("page-numbers").position).toBe("top-right");
    expect(stored).not.toContain("Kestrel");
    expect(stored).not.toContain("Dossier");
    expect(recallOptions("page-numbers").format).toBeUndefined();
  });

  it("a remembered choice is what the next editor opens with", async () => {
    rememberOptions("watermark", { opacity: 64, rotation: -15 });
    render(<WatermarkEditor pdf={await loaded()} onReset={() => {}} />);
    expect(
      (screen.getByLabelText(/^opacity/i) as HTMLInputElement).value,
    ).toBe("64");
    expect(
      (screen.getByLabelText(/^rotation/i) as HTMLInputElement).value,
    ).toBe("-15");
  });
});
