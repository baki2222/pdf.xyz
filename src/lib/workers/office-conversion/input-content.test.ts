// @vitest-environment node
/**
 * The Office engine's accepted extensions, held to the catalogue, and its
 * content check held to the recogniser it borrows — both ways.
 *
 * Added 2026-11-04 with OpenDocument (ODT, ODS, ODP) and RTF input. Before
 * it, nothing tied `accept` on the three tool pages to the engine's own
 * extension list: the page could offer a format the worker refused at the
 * first line, and no test could see it.
 */
import { describe, expect, it, vi } from "vitest";
import { formatOfName } from "@/lib/intent/formats";
import { sniffFormat } from "@/lib/intent/sniff";
import { EXTENSIONS_BY_FORMAT } from "@/lib/jobs/mime-by-format";
import { getToolBySlug as getTool } from "@/lib/tools";
import {
  DOCUMENT_WORDS,
  OFFICE_INPUT_EXTENSIONS,
  OFFICE_TO_PDF_TOOLS,
  runOfficeToPdf,
  type LibreOfficePdfRunner,
} from "./engine";
import { LibreOfficeRunError } from "./errors";
import { officeContentRefusal, SIGNED_OFFICE_INPUTS } from "./input-content";

const enc = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** A ZIP's first local header: a STORED entry `name` holding `data`. */
function zipHead(name: string, data: string, method = 0): Uint8Array {
  const size = [data.length & 0xff, data.length >> 8, 0, 0];
  return Uint8Array.from([
    ...[0x50, 0x4b, 0x03, 0x04, 0x0a, 0, 0, 0, method, 0],
    ...[0, 0, 0, 0, 0, 0, 0, 0],
    ...size,
    ...size,
    name.length,
    0,
    0,
    0,
    ...enc(name),
    ...enc(data),
  ]);
}

const OLE = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
]);
const OOXML = zipHead("[Content_Types].xml", "<?xml version=");
const odf = (kind: string) =>
  zipHead("mimetype", `application/vnd.oasis.opendocument.${kind}`);

/** Real leading bytes of a genuine file of each accepted extension. */
const GENUINE: Record<string, Uint8Array> = {
  docx: OOXML,
  xlsx: OOXML,
  pptx: OOXML,
  doc: OLE,
  xls: OLE,
  ppt: OLE,
  csv: Uint8Array.from(enc("name,total\nAda,3\n")),
  odt: odf("text"),
  ods: odf("spreadsheet"),
  odp: odf("presentation"),
  rtf: Uint8Array.from(enc("{\\rtf1\\ansi\\deff0 {\\fonttbl}")),
};

const ACCEPTED = [...new Set(Object.values(OFFICE_INPUT_EXTENSIONS).flat())];

describe("what the three Office tools accept", () => {
  it.each(OFFICE_TO_PDF_TOOLS)(
    "%s: the engine takes exactly the extensions the catalogue offers",
    (slug) => {
      const offered = getTool(slug)!.accept.flatMap(
        (label) => EXTENSIONS_BY_FORMAT[label.toUpperCase()] ?? [`?${label}`],
      );
      expect([...OFFICE_INPUT_EXTENSIONS[slug]].sort()).toEqual(
        [...offered].sort(),
      );
    },
  );

  it("names OpenDocument and RTF on the tool each belongs to", () => {
    expect(getTool("word-to-pdf")!.accept).toEqual(
      expect.arrayContaining(["ODT", "RTF"]),
    );
    expect(getTool("excel-to-pdf")!.accept).toContain("ODS");
    expect(getTool("powerpoint-to-pdf")!.accept).toContain("ODP");
  });
});

describe("the content check", () => {
  it("has a genuine fixture for every accepted extension (health)", () => {
    expect(ACCEPTED.filter((ext) => !GENUINE[ext])).toEqual([]);
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(11);
  });

  it("checks EXACTLY the extensions whose bytes name their format", () => {
    // Derived, not typed: asked without a name, the recogniser names an
    // OpenDocument or RTF file from its bytes, and cannot tell a .docx from
    // an .xlsx (one ZIP signature) or a .doc from a .xls (one compound file).
    const selfNaming = ACCEPTED.filter(
      (ext) => sniffFormat(GENUINE[ext]!) === formatOfName(`x.${ext}`),
    );
    expect(selfNaming.sort()).toEqual(Object.keys(SIGNED_OFFICE_INPUTS).sort());
    // Both halves populated: a blind recogniser fails the first, a total one
    // the second.
    expect(selfNaming.length).toBeGreaterThanOrEqual(4);
    expect(ACCEPTED.length - selfNaming.length).toBeGreaterThanOrEqual(7);
  });

  it("passes every genuine file under its own name", () => {
    expect(
      ACCEPTED.filter((ext) => officeContentRefusal(ext, GENUINE[ext]!)),
    ).toEqual([]);
  });

  it("refuses every OTHER format's bytes under a checked name", () => {
    const passed: string[] = [];
    let tried = 0;
    for (const ext of Object.keys(SIGNED_OFFICE_INPUTS)) {
      for (const [other, bytes] of Object.entries(GENUINE)) {
        if (other === ext) continue;
        tried += 1;
        if (officeContentRefusal(ext, bytes) === null)
          passed.push(`${other} bytes as .${ext}`);
      }
    }
    expect(passed).toEqual([]);
    expect(tried).toBeGreaterThanOrEqual(40);
  });

  it.each<[string, Uint8Array]>([
    ["random bytes", Uint8Array.from([0x13, 0x37, 0x00, 0xff, 0x42])],
    ["an empty file", new Uint8Array(0)],
    ["a PDF", Uint8Array.from(enc("%PDF-1.7\n1 0 obj"))],
    ["a template (type BEGINS with the document's)", odf("text-template")],
    [
      "the right type, deflated",
      zipHead("mimetype", "application/vnd.oasis.opendocument.text", 8),
    ],
    ["plain text", Uint8Array.from(enc("Dear Ada,\n"))],
  ])("refuses %s named .odt", (_label, bytes) => {
    expect(officeContentRefusal("odt", bytes)).toMatch(
      /ends in \.odt, but its contents are not an OpenDocument text document/,
    );
  });

  it("reads an RTF that quotes a PDF header as RTF", () => {
    const rtf = Uint8Array.from(enc("{\\rtf1 see %PDF-1.4 in the appendix}"));
    expect(officeContentRefusal("rtf", rtf)).toBeNull();
  });
});

describe("the engine refuses a renamed file before LibreOffice runs", () => {
  const PDF = Uint8Array.from(enc("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n"));
  const runner = (): LibreOfficePdfRunner => ({
    convertToPdf: vi.fn(async () => PDF),
  });

  it.each<[(typeof OFFICE_TO_PDF_TOOLS)[number], string, string, string]>([
    ["word-to-pdf", "essay.odt", "odt", "ods"],
    ["word-to-pdf", "memo.rtf", "rtf", "docx"],
    ["excel-to-pdf", "budget.ods", "ods", "odt"],
    ["powerpoint-to-pdf", "deck.odp", "odp", "ods"],
  ])(
    "%s %s: genuine converts, %s bytes refused",
    async (tool, name, own, other) => {
      const good = runner();
      await expect(
        runOfficeToPdf(tool, GENUINE[own]!, name, { libreoffice: good }),
      ).resolves.toMatchObject({ ok: true });
      expect(good.convertToPdf).toHaveBeenCalledTimes(1);

      const bad = runner();
      await expect(
        runOfficeToPdf(tool, GENUINE[other]!, name, { libreoffice: bad }),
      ).resolves.toMatchObject({ ok: false, kind: "invalid_input" });
      expect(bad.convertToPdf).not.toHaveBeenCalled();
    },
  );

  it("still passes an unchecked format to LibreOffice by content", async () => {
    // A .doc that is really RTF converts today, as it always has.
    const run = runner();
    await expect(
      runOfficeToPdf("word-to-pdf", GENUINE.rtf!, "old.doc", {
        libreoffice: run,
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

/**
 * Audit #40 (2026-11-06): the "could not be converted" reply was built from
 * DOCUMENT_WORDS[tool] alone, so a damaged .odt, .rtf, .ods or .odp was told
 * to open it in Word, Excel or PowerPoint and "save it again as .docx"
 * (.xlsx, .pptx). The advice now follows the INPUT's extension wherever the
 * bytes say the file is not a Microsoft format (`SIGNED_OFFICE_INPUTS`), and
 * is unchanged for the Microsoft formats — which this walk also holds, so it
 * cannot pass by changing every message.
 */
describe("the unreadable reply names the input's own format", () => {
  const NOT_PDF = Uint8Array.from(enc("no pdf"));
  const failing: Record<string, () => LibreOfficePdfRunner> = {
    "LibreOffice wrote no PDF": () => ({
      convertToPdf: vi.fn(async () => {
        throw new LibreOfficeRunError("no_output");
      }),
    }),
    "the output is not a PDF": () => ({
      convertToPdf: vi.fn(async () => NOT_PDF),
    }),
  };
  const pairs = OFFICE_TO_PDF_TOOLS.flatMap((tool) =>
    OFFICE_INPUT_EXTENSIONS[tool].flatMap((ext) =>
      Object.keys(failing).map((how) => [tool, ext, how] as const),
    ),
  );

  /** Plain-text formats: no encryption exists in them to remove. */
  const CANNOT_CARRY_A_PASSWORD = new Set(["rtf", "csv"]);

  it("walks every accepted extension of every tool (health)", () => {
    // Every password-less format is really walked.
    for (const ext of CANNOT_CARRY_A_PASSWORD) {
      expect(pairs.some(([, e]) => e === ext)).toBe(true);
    }
    expect(pairs.length).toBe(ACCEPTED.length * Object.keys(failing).length);
    const signed = pairs.filter(([, ext]) => SIGNED_OFFICE_INPUTS[ext]);
    expect(signed.length).toBeGreaterThanOrEqual(8);
    expect(pairs.length - signed.length).toBeGreaterThanOrEqual(14);
  });

  it.each(pairs)("%s .%s, %s", async (tool, ext, how) => {
    const run = await runOfficeToPdf(tool, GENUINE[ext]!, `file.${ext}`, {
      libreoffice: failing[how]!(),
    });
    expect(run).toMatchObject({ ok: false, kind: "unreadable" });
    const message = run.ok ? "" : run.message;
    const words = DOCUMENT_WORDS[tool];
    // RTF and CSV cannot carry a password, so their advice offers no
    // password route (audit #40 follow-up: .csv was told to remove the
    // password in Excel).
    if (CANNOT_CARRY_A_PASSWORD.has(ext)) {
      expect(message).not.toMatch(/password/i);
      expect(message).toContain(`save it again as .${ext}`);
      expect(message).not.toContain(words.app);
    } else {
      expect(message).toMatch(/password/i);
    }
    if (SIGNED_OFFICE_INPUTS[ext]) {
      expect(message).toContain(`save it again as .${ext}`);
      expect(message).not.toContain(words.app);
      expect(message).not.toContain(words.ext);
    } else if (!CANNOT_CARRY_A_PASSWORD.has(ext)) {
      // Control: a Microsoft format keeps the Microsoft advice.
      expect(message).toContain(`open it in ${words.app}`);
      expect(message).toContain(`save it again as ${words.ext}`);
    }
  });
});
