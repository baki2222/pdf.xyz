// @vitest-environment node
/**
 * The placement editor's geometry, held to the WORKER'S parser rather than to
 * itself (audit #21, 2026-11-17). Every box an operation can produce, over a
 * seeded corpus of frames and operations, must be one
 * `parseSignatureRequestOptions` accepts — the parser is the independent
 * bound, so a clamp that agreed with its own idea of the page and not the
 * worker's would fail here. The positive control proves the parser refuses
 * what an unclamped move produces.
 */
import { describe, expect, it } from "vitest";
import {
  REQUEST_SIGNATURE_FIELD_TYPES,
  parseSignatureRequestOptions,
  signatureBlockFields,
} from "@/lib/jobs/request-signatures";
import { NUDGE_BIG_PT, NUDGE_PT } from "@/lib/pdf/editor/model";
import { requestSignaturesJobOptions } from "@/lib/workers/request-signatures-client";
import {
  CLEARANCE_PT,
  MIN_FIELD_PT,
  PRESETS,
  PRESET_ORDER,
  SIGNER_COLOURS,
  STEP_BIG_PT,
  STEP_PT,
  addField,
  clampField,
  moveField,
  nudgeField,
  readingOrder,
  resizeField,
  startingLayout,
  toRequestFields,
  type FrameSize,
  type LayoutField,
} from "./request-layout";

const FRAMES: { label: string; frame: FrameSize }[] = [
  { label: "tiny 20x20", frame: { width: 20, height: 20 } },
  { label: "Letter", frame: { width: 612, height: 792 } },
  { label: "A4 landscape", frame: { width: 842, height: 595 } },
  { label: "banner 14400x200", frame: { width: 14_400, height: 200 } },
];

/** mulberry32: a seeded generator, so a red run is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIGNERS = [{ name: "Ada Lovelace", email: "ada@example.com" }];

function accepted(field: LayoutField) {
  return parseSignatureRequestOptions({
    signers: SIGNERS,
    fields: toRequestFields([field], new Map([[field.owner, 0]])),
  });
}

const decimals = (n: number) => {
  const s = String(n);
  return s.includes("e") ? 99 : (s.split(".")[1]?.length ?? 0);
};

describe("every box an operation produces is one the worker accepts", () => {
  const random = rng(20261117);
  const cases: { where: string; field: LayoutField; frame: FrameSize }[] = [];
  const pastAnEdge = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const { label, frame } of FRAMES) {
    let layout: LayoutField[] = [];
    for (let i = 0; i < 300; i += 1) {
      const preset = PRESET_ORDER[Math.floor(random() * PRESET_ORDER.length)]!;
      layout = addField(layout, preset, 1, 1, frame);
      let field = layout[layout.length - 1]!;
      // Push it hard in some direction, sometimes far past the page.
      const dx = (random() - 0.5) * 3;
      const dy = (random() - 0.5) * 3;
      if (field.x + dx < 0) pastAnEdge.left += 1;
      if (field.x + field.width + dx > 1) pastAnEdge.right += 1;
      if (field.y + dy < 0) pastAnEdge.bottom += 1;
      if (field.y + field.height + dy > 1) pastAnEdge.top += 1;
      field = moveField(field, dx, dy, frame);
      cases.push({ where: `${label} move ${i}`, field, frame });
      field = resizeField(
        field,
        (random() - 0.5) * 2.5,
        (random() - 0.5) * 2.5,
        frame,
      );
      cases.push({ where: `${label} resize ${i}`, field, frame });
      field = nudgeField(
        field,
        random() < 0.5 ? STEP_BIG_PT : -STEP_PT,
        random() < 0.5 ? -STEP_BIG_PT : STEP_PT,
        frame,
      );
      cases.push({ where: `${label} nudge ${i}`, field, frame });
      // Raw garbage straight into the clamp.
      cases.push({
        where: `${label} clamp ${i}`,
        field: clampField(
          {
            ...field,
            x: (random() - 0.5) * 4,
            y: (random() - 0.5) * 4,
            width: (random() - 0.2) * 3,
            height: (random() - 0.2) * 3,
          },
          frame,
        ),
        frame,
      });
      layout[layout.length - 1] = field;
    }
  }

  it("health: the corpus is large and pushes boxes past every edge", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1000);
    for (const edge of Object.values(pastAnEdge))
      expect(edge).toBeGreaterThanOrEqual(20);
  });

  it("the parser accepts every one, each at least the minimum size (or the page), with at most 4 decimals", () => {
    const bad: string[] = [];
    for (const { where, field, frame } of cases) {
      const parsed = accepted(field);
      if (!parsed.ok) {
        bad.push(`${where}: ${parsed.error.body.error.message}`);
        continue;
      }
      const minW = Math.min(1, MIN_FIELD_PT.width / frame.width);
      const minH = Math.min(1, MIN_FIELD_PT.height / frame.height);
      if (field.width < minW - 1e-12 || field.height < minH - 1e-12)
        bad.push(`${where}: below the minimum ${JSON.stringify(field)}`);
      if (field.x < 0 || field.y < 0)
        bad.push(`${where}: negative ${JSON.stringify(field)}`);
      for (const k of ["x", "y", "width", "height"] as const)
        if (decimals(field[k]) > 4)
          bad.push(`${where}: ${k} = ${field[k]} has more than 4 decimals`);
    }
    expect(bad.slice(0, 20), bad.join("\n")).toEqual([]);
  });

  it("positive control: an unclamped move past the right edge is refused by the parser", () => {
    const frame = FRAMES[1]!.frame;
    const [field] = addField([], "signature", 1, 1, frame);
    const raw = { ...field!, x: field!.x + 0.9 };
    expect(accepted(raw).ok).toBe(false);
    expect(accepted(moveField(field!, 0.9, 0, frame)).ok).toBe(true);
  });

  it("a drag past the edge stops at the edge and keeps the size", () => {
    const frame = FRAMES[1]!.frame;
    const [field] = addField([], "signature", 1, 1, frame);
    const moved = moveField(field!, 5, -5, frame);
    expect(moved.width).toBe(field!.width);
    expect(moved.height).toBe(field!.height);
    expect(moved.x + moved.width).toBeCloseTo(1, 4);
    expect(moved.y).toBe(0);
  });

  it("resizing keeps the displayed top-left in place", () => {
    const frame = FRAMES[1]!.frame;
    const [field] = addField([], "date", 1, 1, frame);
    const grown = resizeField(field!, 0.05, 0.05, frame);
    expect(grown.x).toBe(field!.x);
    expect(grown.y + grown.height).toBeCloseTo(field!.y + field!.height, 4);
    expect(grown.height).toBeGreaterThan(field!.height);
  });

  it("adds on one page cascade 12 pt right and down until clear of every other box's 40 pt reach", () => {
    const frame = FRAMES[1]!.frame;
    let layout: LayoutField[] = [];
    for (const preset of ["name", "text", "signature", "initials"] as const)
      layout = addField(layout, preset, 1, 1, frame);
    expect(new Set(layout.map((f) => f.id)).size).toBe(4);
    const reach = (f: LayoutField) => {
      const w = Math.max(f.width, CLEARANCE_PT / frame.width);
      const h = Math.max(f.height, CLEARANCE_PT / frame.height);
      const cx = f.x + f.width / 2;
      const cy = f.y + f.height / 2;
      return [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2] as const;
    };
    for (let i = 0; i < layout.length; i += 1)
      for (let j = i + 1; j < layout.length; j += 1) {
        const [al, ar, ab, at] = reach(layout[i]!);
        const [bl, br, bb, bt] = reach(layout[j]!);
        const overlap =
          al < br - 1e-9 && bl < ar - 1e-9 && ab < bt - 1e-9 && bb < at - 1e-9;
        expect(overlap, `${i} and ${j}`).toBe(false);
      }
    // The second Text-sized box is a whole number of 12 pt steps from the first.
    const steps = ((layout[1]!.x - layout[0]!.x) * 612) / 12;
    expect(steps).toBeGreaterThanOrEqual(1);
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.01);
    expect(((layout[0]!.y - layout[1]!.y) * 792) / 12).toBeCloseTo(steps, 1);
  });
});

describe("the starting layout is signatureBlockFields, one definition", () => {
  it("maps to exactly signatureBlockFields(ids.length, page, date), for every count and option", () => {
    for (let n = 1; n <= 10; n += 1)
      for (const date of [true, false]) {
        const ids = Array.from({ length: n }, (_, i) => 100 + i * 7);
        const index = new Map(ids.map((id, i) => [id, i]));
        expect(toRequestFields(startingLayout(ids, 3, date), index)).toEqual(
          signatureBlockFields(n, 3, date),
        );
      }
  });

  it("reading order runs top to bottom, then left to right, page by page", () => {
    const ids = [1, 2];
    const order = readingOrder(startingLayout(ids, 1, true));
    // Signer 2's row sits above signer 1's, so it comes first; date after signature.
    expect(order.map((f) => [f.owner, f.type])).toEqual([
      [2, "signature"],
      [2, "date"],
      [1, "signature"],
      [1, "date"],
    ]);
  });
});

describe("presets, steps and text", () => {
  it("each preset is a contract type, and Name is a text box labelled Name", () => {
    for (const key of PRESET_ORDER)
      expect(REQUEST_SIGNATURE_FIELD_TYPES).toContain(PRESETS[key].type);
    expect(PRESETS.name).toMatchObject({ type: "text", label: "Name" });
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_ORDER].sort());
  });

  it("the arrow-key steps are Edit PDF's (one value, two homes)", () => {
    expect(STEP_PT).toBe(NUDGE_PT);
    expect(STEP_BIG_PT).toBe(NUDGE_BIG_PT);
  });

  it("the message and labels the client sends are ones the worker's parser accepts, for fuzzed raw input", () => {
    const random = rng(7);
    const fields = signatureBlockFields(1, 1, false);
    let checked = 0;
    for (let i = 0; i < 400; i += 1) {
      const codes = Array.from({ length: 1 + Math.floor(random() * 60) }, () =>
        random() < 0.3
          ? Math.floor(random() * 32)
          : random() < 0.05
            ? 0x7f
            : 0x20 + Math.floor(random() * 0x2fd0),
      );
      const raw = String.fromCharCode(...codes).slice(0, 80);
      const options = requestSignaturesJobOptions({
        signers: SIGNERS,
        fields: [{ ...fields[0]!, label: raw }],
        message: raw,
        title: raw,
      });
      const parsed = parseSignatureRequestOptions(options);
      expect(parsed.ok, JSON.stringify(raw)).toBe(true);
      if (options.message !== undefined) checked += 1;
    }
    expect(checked).toBeGreaterThan(300);
    // Positive control: the raw text with a line break and a tab is refused
    // by the parser, and the client sends it as spaces.
    const raw = `a${String.fromCharCode(10)}b${String.fromCharCode(9)}c`;
    expect(
      parseSignatureRequestOptions({
        signers: SIGNERS,
        fields,
        message: raw,
      }).ok,
    ).toBe(false);
    const sent = requestSignaturesJobOptions({
      signers: SIGNERS,
      fields,
      message: raw,
    });
    expect(sent.message).toBe("a b c");
    // Blank after normalising is not sent at all.
    expect(
      "message" in
        requestSignaturesJobOptions({ signers: SIGNERS, fields, message: " " }),
    ).toBe(false);
    // An unlabelled field passes through as the same object (byte-identical default).
    expect(
      (
        requestSignaturesJobOptions({ signers: SIGNERS, fields })
          .fields as unknown[]
      )[0],
    ).toBe(fields[0]);
  });
});

/** WCAG 2 relative luminance and contrast. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("signer colours", () => {
  it("ten colours, distinct, each at least 4.5:1 on the white page", () => {
    expect(SIGNER_COLOURS).toHaveLength(10);
    expect(new Set(SIGNER_COLOURS).size).toBe(10);
    for (const hex of SIGNER_COLOURS)
      expect(contrastOnWhite(hex), hex).toBeGreaterThanOrEqual(4.5);
  });

  it("positive control: a light yellow fails, and black is 21:1", () => {
    expect(contrastOnWhite("#ffd400")).toBeLessThan(4.5);
    expect(contrastOnWhite("#000000")).toBeCloseTo(21, 5);
  });
});
