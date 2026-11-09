// @vitest-environment jsdom
/**
 * The typed signature's Style radio group (audit sign-pdf#1, 2026-11-09).
 *
 * Every style is DISCOVERED from `SIGNATURE_STYLES`; none is named here, so a
 * style added to the model is held to all of it:
 *  - one radio per style, named by its label, in the model's order, with
 *    `DEFAULT_SIGNATURE_STYLE` checked;
 *  - one tab stop, the arrows move the choice and the focus, wrapping;
 *  - a box of fixed size (`h-14`, 56 px: a 44 px target with room), so a face
 *    arriving late moves nothing;
 *  - the handwriting faces are registered as `FontFace`s when the Type tab
 *    is shown, and not when the module is merely loaded;
 *  - each option previews in the face the PDF will get, and a face that
 *    lacks a letter of the name says which, under the group.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
} from "@/lib/pdf/offered-kinds";
import {
  DEFAULT_SIGNATURE_STYLE,
  isHandwritingStyle,
} from "@/lib/pdf/signature-style";
import {
  handwritingMissing,
  handwritingMissingLabels,
} from "@/lib/pdf/handwriting";
import { PREVIEW_LINE_EMS, handwritingFamily } from "./handwriting-faces";
import { cssLineHeightShowing } from "@/lib/pdf/handwriting-metrics";

/** A FontFace the test DOM lacks: records what was asked for. */
const constructed: string[] = [];
const added: string[] = [];
class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
  ) {
    constructed.push(family);
  }
  load() {
    return Promise.resolve(this);
  }
}

beforeAll(() => {
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (f: FakeFontFace) => added.push(f.family) },
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function panel() {
  const { SignaturePanel, handwritingFallbackNote } =
    await import("./signature-panel");
  render(<SignaturePanel onReady={() => {}} onClose={() => {}} />);
  const group = screen.getByRole("radiogroup", { name: "Style" });
  return {
    group,
    radios: within(group).getAllByRole("radio"),
    handwritingFallbackNote,
  };
}

function typeName(name: string) {
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: name },
  });
}

describe("the Style radio group", () => {
  it("registers no face when the panel's module loads, and every handwriting face once the Type tab shows", async () => {
    await import("./signature-panel");
    expect(constructed).toEqual([]);
    await panel(); // opens on Type
    const families = HANDWRITING_STYLES.map((s) => `pdfxyz-hand-${s}`);
    await waitFor(() => expect([...added].sort()).toEqual(families.sort()), {
      timeout: 20_000,
    });
    expect([...constructed].sort()).toEqual(families.sort());
  });

  it("offers every style by its label, in the model's order, the default checked", async () => {
    const { radios } = await panel();
    expect(SIGNATURE_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(
      SIGNATURE_STYLES.map((s) => SIGNATURE_STYLE_LABEL[s]),
    );
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked.map((r) => r.getAttribute("aria-label"))).toEqual([
      SIGNATURE_STYLE_LABEL[DEFAULT_SIGNATURE_STYLE],
    ]);
  });

  it("every option is a fixed 64 px box whose preview line holds the tallest face's ink (no shift when a face lands, no descender cut)", async () => {
    const { radios } = await panel();
    // WAS h-14 with an h-7 (1.4 em) preview line, which sliced Homemade
    // Apple's descenders flat (review of sign-pdf#1). The line height is
    // now derived from every face's reach, and the box sized to hold it.
    for (const style of HANDWRITING_STYLES)
      expect(PREVIEW_LINE_EMS, style).toBeGreaterThanOrEqual(
        cssLineHeightShowing(style),
      );
    // Health check: the tallest face needs more than the old 1.4 em line.
    expect(
      Math.max(...HANDWRITING_STYLES.map(cssLineHeightShowing)),
    ).toBeGreaterThan(1.4);
    typeName("Jágy Pöqfly");
    const lines = [
      ...radios.map((r) => r.querySelector("span")!),
      document.querySelector<HTMLElement>("[data-signature-preview]")!,
    ];
    for (const r of radios) {
      expect(r.className).toMatch(/\bh-16\b/);
      expect(r.className).toMatch(/\boverflow-hidden\b/);
    }
    for (const line of lines) {
      expect(line.style.lineHeight).toBe(`${PREVIEW_LINE_EMS}em`);
      expect(line.style.height).toBe(`${PREVIEW_LINE_EMS}em`);
      // No class may set another height or line height over the style.
      expect(line.className).not.toMatch(/\b(?:h|leading)-/);
    }
  });

  it("is one tab stop, and the arrow keys move the choice and the focus, wrapping", async () => {
    const { radios } = await panel();
    const at = SIGNATURE_STYLES.indexOf(DEFAULT_SIGNATURE_STYLE);
    const tabbable = () =>
      radios.filter((r) => r.getAttribute("tabindex") !== "-1");
    const checked = () =>
      radios.find((r) => r.getAttribute("aria-checked") === "true");
    expect(tabbable()).toEqual([radios[at]]);

    fireEvent.keyDown(radios[at]!, { key: "ArrowRight" });
    const next = (at + 1) % radios.length;
    expect(checked()).toBe(radios[next]);
    expect(document.activeElement).toBe(radios[next]);
    expect(tabbable()).toEqual([radios[next]]);

    // From the first option, left wraps to the last; down from it, to the first.
    fireEvent.click(radios[0]!);
    fireEvent.keyDown(radios[0]!, { key: "ArrowLeft" });
    expect(checked()).toBe(radios.at(-1));
    expect(document.activeElement).toBe(radios.at(-1));
    fireEvent.keyDown(radios.at(-1)!, { key: "ArrowDown" });
    expect(checked()).toBe(radios[0]);
  });

  it("each option previews the typed name in the face the PDF will get", async () => {
    const { radios } = await panel();
    const name = "Zoé Łukasz Erdős";
    typeName(name);
    for (const [i, style] of SIGNATURE_STYLES.entries()) {
      const preview = radios[i]!.querySelector("span")!;
      expect(preview.textContent).toBe(name);
      const family = preview.style.fontFamily;
      if (isHandwritingStyle(style) && !handwritingMissing(style, name).length)
        expect(family, style).toContain(`pdfxyz-hand-${style}`);
      else expect(family, style).not.toContain("pdfxyz-hand-");
    }
  });

  it("says which letters a chosen handwriting face lacks, and nothing when it has them all", async () => {
    const { radios } = await panel();
    const note = () =>
      document.querySelector("[data-style-fallback]")!.textContent ?? "";
    const name = "Zoé Łukasz Erdős";
    typeName(name);
    const lacking = HANDWRITING_STYLES.filter(
      (s) => handwritingMissing(s, name).length > 0,
    );
    const having = HANDWRITING_STYLES.filter(
      (s) => handwritingMissing(s, name).length === 0,
    );
    expect(lacking.length).toBeGreaterThan(0);
    expect(having.length).toBeGreaterThan(0);
    for (const s of lacking) {
      fireEvent.click(radios[SIGNATURE_STYLES.indexOf(s)]!);
      expect(note()).toContain(SIGNATURE_STYLE_LABEL[s]);
      for (const label of handwritingMissingLabels(s, name))
        expect(note()).toContain(label);
      expect(note()).toContain(`as ${SIGNATURE_STYLE_LABEL.signature} sets it`);
    }
    for (const s of having) {
      fireEvent.click(radios[SIGNATURE_STYLES.indexOf(s)]!);
      expect(note()).toBe("");
    }
  });

  it("a Bengali name: every handwriting style says it falls back, naming the script, not a row of vowel signs", async () => {
    const { radios } = await panel();
    typeName("বাকী বিল্লাহ");
    for (const s of HANDWRITING_STYLES) {
      fireEvent.click(radios[SIGNATURE_STYLES.indexOf(s)]!);
      const note =
        document.querySelector("[data-style-fallback]")!.textContent ?? "";
      expect(note, s).toMatch(/so this name will be set as/);
      expect(note, s).toContain(
        `${SIGNATURE_STYLE_LABEL[s]} has no Bengali letters,`,
      );
      // No combining mark (a dependent vowel sign, the virama) on its own.
      expect(note, s).not.toMatch(/\p{M}/u);
    }
  });

  it("a pasted no-break space or a decomposed accent changes nothing: same face, no note", async () => {
    const { radios } = await panel();
    const note = () =>
      document.querySelector("[data-style-fallback]")!.textContent ?? "";
    for (const s of HANDWRITING_STYLES) {
      fireEvent.click(radios[SIGNATURE_STYLES.indexOf(s)]!);
      const preview =
        radios[SIGNATURE_STYLES.indexOf(s)]!.querySelector("span")!;
      const big = () =>
        document.querySelector<HTMLElement>("[data-signature-preview]")!.style
          .fontFamily;
      typeName("Ada Lovelace");
      const plain = [preview.style.fontFamily, big()];
      // Health check: the face is the one previewed, not a fallback.
      expect(plain[1], s).toContain(handwritingFamily(s));
      typeName("Ada\u00a0Lovelace");
      expect(note(), s).toBe("");
      expect([preview.style.fontFamily, big()], s).toEqual(plain);
      typeName("Zoé");
      const composed = [note(), preview.style.fontFamily, big()];
      typeName("Zoe\u0301");
      expect([note(), preview.style.fontFamily, big()], s).toEqual(composed);
    }
  });
});
