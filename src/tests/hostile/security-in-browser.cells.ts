/**
 * The security-in-browser hostile matrix: every fixture, what a correct
 * reader would make of it (its TRUTH), and which entry points it is put to.
 *
 * No product code is imported here: the cells run in a child process
 * (`security-in-browser.runner.ts`) so a synchronous hang or a memory
 * blow-up is killed and recorded instead of freezing the test worker.
 */
import { PDFDocument } from "pdf-lib";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import { encryptPdf, type EncryptCipher } from "@/tests/encrypted-pdf";
import {
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "@/tests/fixtures-broken-subset";
import {
  linearizedPdf,
  linearizedThenUpdatedPdf,
} from "@/tests/linearized-pdf-fixture";
import {
  ASSEMBLE_COPY_FIXTURE,
  FIXTURE_OPEN_PASSWORD,
  OPEN_PASSWORD_FIXTURE,
  OPEN_PASSWORD_RESTRICTED_FIXTURE,
  RESTRICTED_FIXTURES,
  SIGNED_RESTRICTED_FIXTURE,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  NOT_PDF,
  ONE_PAGE,
  concatBytes,
  deepPageTreeObjects,
  latin1,
  manyPageObjects,
  onePageWith,
  ownerOnlyEncrypted,
  patchPrev,
  rawPdf,
  reflate,
  startxrefOf,
  text,
  truncateAt,
  truncateAtLastEndobj,
  xrefStreamPdf,
  zeroBomb,
  type OwnerOnlyOptions,
  type RawObject,
} from "./security-in-browser.fixtures";

/** What a correct reader makes of a fixture. */
export type Truth =
  /** Not a PDF at all: every reader refuses. */
  | { kind: "notpdf" }
  /**
   * Unencrypted. `damaged`: a refusal is as acceptable as a recovery.
   * `pages`: the count a correct reader finds, when one is readable.
   */
  | { kind: "plain"; pages?: number; damaged?: boolean }
  /**
   * Encrypted, opens with the empty password. `hostile`: the file is broken
   * on purpose, so a typed refusal is acceptable; output must still be right.
   */
  | { kind: "owner"; pages?: number; hostile?: boolean; owner?: string }
  /** Needs `password` to open. */
  | { kind: "user"; password: string; pages?: number }
  /** A security handler no browser reader decrypts. */
  | { kind: "unsupported" };

export interface FixtureSpec {
  id: string;
  /** Hostile class from the survey (H01..H24), or `CTRL` for a control. */
  cls: string;
  what: string;
  truth: Truth;
  /** Digital signatures a reader finds (default 0). */
  signatures?: number;
  /** Linearized by ISO 32000 Annex F (default false). */
  linearized?: boolean;
  /** Put an opened copy through `saveChanges` (incremental update). */
  save?: boolean;
  /** Known slow: a long per-cell bound. */
  slow?: boolean;
  /** Each cell in a child of its own, so its memory growth is measured cold. */
  isolate?: boolean;
  build: () => Uint8Array | Promise<Uint8Array>;
}

export const ENTRIES = [
  "classify",
  "probe",
  "openProtected",
  "openWrongPassword",
  "openRightPassword",
  "openProtectedCopy",
  "readXref",
  "signatures",
  "countSignatures",
  "linearization",
  "saveChanges",
] as const;
export type Entry = (typeof ENTRIES)[number];

export function applicable(f: FixtureSpec, e: Entry): boolean {
  if (e === "openRightPassword")
    return (
      f.truth.kind === "user" || (f.truth.kind === "owner" && !!f.truth.owner)
    );
  if (e === "saveChanges") return !!f.save;
  return true;
}

/* ------------------------------------------------------------------ */

const owner = (objects: RawObject[], opts: OwnerOnlyOptions = {}) =>
  ownerOnlyEncrypted(objects, opts);

async function pdfLibOnePage(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // encryptPdf refuses a document with no stream to encrypt: draw something.
  for (let i = 0; i < pages; i++)
    doc
      .addPage([200, 200])
      .drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  return doc.save({ useObjectStreams: false });
}

async function encrypted(
  cipher: EncryptCipher,
  userPassword: string,
  objectStreams = false,
): Promise<Uint8Array> {
  return encryptPdf(await pdfLibOnePage(), {
    userPassword,
    ownerPassword: `owner-${cipher}`,
    cipher,
    objectStreams,
  });
}

/** Trailer body of a classic-table file (between `trailer <<` and `>>`). */
function trailerBodyOf(bytes: Uint8Array): string {
  const t = text(bytes);
  const at = t.lastIndexOf("trailer");
  const m = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(t.slice(at));
  if (!m) throw new Error("no trailer");
  return m[1]!;
}

/** Trailer /Prev pointing at its own xref section (classic). */
function prevSelf(base: Uint8Array): Uint8Array {
  return patchPrev(base, "/Prev 0000000000", startxrefOf(base));
}

/**
 * Two sections whose /Prev point at each other: the base's /Prev names the
 * appended update's section, the update's /Prev names the base's.
 */
function prevCycle(base: Uint8Array): Uint8Array {
  const x1 = startxrefOf(base);
  const x2 = base.length;
  const body = trailerBodyOf(base).replace(
    "/Prev 0000000000",
    `/Prev ${String(x1).padStart(10, "0")}`,
  );
  const update = latin1(
    `xref\n0 0\ntrailer\n<<${body}>>\nstartxref\n${x2}\n%%EOF\n`,
  );
  return patchPrev(concatBytes(base, update), "/Prev 0000000000", x2);
}

/**
 * A first object (number 99) that is a linearization dictionary, written
 * before the one-page document, with `/L` iterated to the file's own length.
 * `pad` is a line between the header and that object.
 */
function linearizedBy(dict: (len: string) => string, pad = ""): Uint8Array {
  const build = (len: number) =>
    rawPdf({
      header: `%PDF-1.7${pad ? `\n${pad}` : ""}`,
      objects: [`<< ${dict(String(len).padStart(10, "0"))} >>`, ...ONE_PAGE],
      numbers: [99, 1, 2, 3, 4],
    });
  let len = build(0).length;
  for (let i = 0; i < 3; i++) len = build(len).length;
  return build(len);
}

const SIG_CONTENTS = `<${"00".repeat(64)}>`;

/** One page plus a signed signature dictionary (5) on a field (6). */
function signedObjects(byteRange: string): RawObject[] {
  return [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [6 0 R] >>",
    { dict: "", stream: latin1("0 0 m 100 100 l S") },
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange ${byteRange} /Contents ${SIG_CONTENTS} >>`,
    "<< /FT /Sig /T (Signature1) /V 5 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>",
  ];
}

/** `base` plus an incremental update that rewrites object 5. */
function signedThenResigned(): Uint8Array {
  const base = rawPdf({ objects: signedObjects("[0 100 228 300]") });
  const x1 = startxrefOf(base);
  const objAt = base.length;
  const obj = latin1(
    `5 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 120 248 400] /Contents ${SIG_CONTENTS} >>\nendobj\n`,
  );
  const xrefAt = objAt + obj.length;
  const update = latin1(
    `xref\n0 1\n0000000000 65535 f \n5 1\n${String(objAt).padStart(10, "0")} 00000 n \n` +
      `trailer\n<< /Size 7 /Root 1 0 R /Prev ${x1} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
  return concatBytes(base, obj, update);
}

const ONE_PAGE_PLAIN = () => rawPdf({ objects: ONE_PAGE });

export const SECURITY_FIXTURES: readonly FixtureSpec[] = [
  /* ---------------- controls ---------------- */
  {
    id: "CTRL-plain-one-page",
    cls: "CTRL",
    what: "a well-formed one-page PDF (positive control)",
    truth: { kind: "plain", pages: 1 },
    build: ONE_PAGE_PLAIN,
  },
  {
    id: "CTRL-owner-r3-one-page",
    cls: "CTRL",
    what: "this family's own R3 owner-only builder (positive control for every hostile owner-only variant)",
    truth: { kind: "owner", pages: 1, owner: "hostile-owner" },
    save: true,
    build: () => owner(ONE_PAGE),
  },
  {
    id: "CTRL-owner-r3-xref-stream",
    cls: "CTRL",
    what: "the same, behind an xref stream with the catalog in an encrypted object stream",
    truth: { kind: "owner", pages: 1, owner: "hostile-owner" },
    save: true,
    build: () => owner(ONE_PAGE, { pack: [1, 2, 3] }),
  },

  /* ---------------- H01-H03 not a PDF ---------------- */
  {
    id: "H01-zero-bytes",
    cls: "H01",
    what: "Uint8Array(0)",
    truth: { kind: "notpdf" },
    build: NOT_PDF.empty,
  },
  {
    id: "H02-png-magic",
    cls: "H02",
    what: "PNG signature + noise",
    truth: { kind: "notpdf" },
    build: NOT_PDF.png,
  },
  {
    id: "H02-zip-docx-magic",
    cls: "H02",
    what: "ZIP/DOCX local header + noise",
    truth: { kind: "notpdf" },
    build: NOT_PDF.zip,
  },
  {
    id: "H02-random-4k",
    cls: "H02",
    what: "4 KB of deterministic noise",
    truth: { kind: "notpdf" },
    build: NOT_PDF.random4k,
  },
  {
    id: "H02-html",
    cls: "H02",
    what: "an HTML page",
    truth: { kind: "notpdf" },
    build: NOT_PDF.html,
  },
  {
    id: "H03-header-only",
    cls: "H03",
    what: "'%PDF-1.7\\n' and nothing else",
    truth: { kind: "notpdf" },
    build: NOT_PDF.headerOnly,
  },

  /* ---------------- H04 truncated ---------------- */
  {
    id: "H04-plain-cut-50pct",
    cls: "H04",
    what: "one-page PDF cut at 50%",
    truth: { kind: "plain", damaged: true },
    build: () => truncateAt(ONE_PAGE_PLAIN(), 0.5),
  },
  {
    id: "H04-plain-cut-at-endobj",
    cls: "H04",
    what: "one-page PDF cut after its last endobj (no xref, no trailer)",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () => truncateAtLastEndobj(ONE_PAGE_PLAIN()),
  },
  {
    id: "H04-owner-cut-at-endobj",
    cls: "H04",
    what: "owner-only file cut after its last endobj: the trailer that names /Encrypt is gone",
    truth: { kind: "owner", hostile: true },
    build: () => truncateAtLastEndobj(owner(ONE_PAGE)),
  },
  {
    id: "H04-owner-cut-50pct",
    cls: "H04",
    what: "owner-only file cut at 50%",
    truth: { kind: "owner", hostile: true },
    build: () => truncateAt(owner(ONE_PAGE), 0.5),
  },

  /* ---------------- H05 broken xref ---------------- */
  {
    id: "H05-plain-offsets-wrong",
    cls: "H05",
    what: "every xref offset 7 bytes late",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () => rawPdf({ objects: ONE_PAGE, offset: (o) => o + 7 }),
  },
  {
    id: "H05-plain-startxref-past-eof",
    cls: "H05",
    what: "startxref spliced past EOF (spliceStartxrefPastEnd)",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () => spliceStartxrefPastEnd(ONE_PAGE_PLAIN()),
  },
  {
    id: "H05-plain-xref-garbage",
    cls: "H05",
    what: "xref table replaced by garbage tokens",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () =>
      rawPdf({ objects: ONE_PAGE, table: "0 5\nzz qq n \n!! ## f \n%%%\n" }),
  },
  {
    id: "H05-owner-offsets-wrong",
    cls: "H05",
    what: "owner-only, every xref offset 7 bytes late",
    truth: { kind: "owner", hostile: true, pages: 1 },
    build: () => {
      const good = owner(ONE_PAGE);
      const t = text(good);
      return latin1(
        t.replace(
          /(\d{10}) 00000 n/g,
          (_m, d: string) =>
            `${String(Number(d) + 7).padStart(10, "0")} 00000 n`,
        ),
      );
    },
  },
  {
    id: "H05-owner-startxref-past-eof",
    cls: "H05",
    what: "owner-only, startxref spliced past EOF",
    truth: { kind: "owner", hostile: true, pages: 1 },
    build: () => spliceStartxrefPastEnd(owner(ONE_PAGE)),
  },

  /* ---------------- H06 xref /Prev loops ---------------- */
  {
    id: "H06-plain-prev-self",
    cls: "H06",
    what: "classic trailer /Prev names its own section",
    truth: { kind: "plain", pages: 1, damaged: true },
    build: () =>
      prevSelf(rawPdf({ objects: ONE_PAGE, trailer: "/Prev 0000000000" })),
  },
  {
    id: "H06-plain-prev-cycle",
    cls: "H06",
    what: "two classic sections whose /Prev name each other (A->B->A)",
    truth: { kind: "plain", pages: 1, damaged: true },
    build: () =>
      prevCycle(rawPdf({ objects: ONE_PAGE, trailer: "/Prev 0000000000" })),
  },
  {
    id: "H06-owner-prev-self",
    cls: "H06",
    what: "owner-only, /Prev names its own section",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => prevSelf(owner(ONE_PAGE, { trailer: "/Prev 0000000000" })),
  },
  {
    id: "H06-owner-prev-cycle",
    cls: "H06",
    what: "owner-only, A->B->A /Prev cycle",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => prevCycle(owner(ONE_PAGE, { trailer: "/Prev 0000000000" })),
  },
  {
    id: "H06-owner-xrefstream-prev-self",
    cls: "H06",
    what: "owner-only xref STREAM whose /Prev names itself",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => {
      const b = owner(ONE_PAGE, {
        pack: [1, 2, 3],
        trailer: "/Prev 0000000000",
      });
      return patchPrev(b, "/Prev 0000000000", startxrefOf(b));
    },
  },

  /* ---------------- H07 self-reference ---------------- */
  {
    id: "H07-plain-kids-contains-self",
    cls: "H07",
    what: "Pages /Kids contains its own reference",
    truth: { kind: "plain", damaged: true },
    build: () =>
      rawPdf({
        objects: onePageWith({
          2: "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>",
        }),
      }),
  },
  {
    id: "H07-owner-kids-contains-self",
    cls: "H07",
    what: "owner-only, Pages /Kids contains its own reference",
    truth: { kind: "owner", hostile: true },
    build: () =>
      owner(
        onePageWith({ 2: "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>" }),
      ),
  },
  {
    id: "H07-owner-kids-cycle",
    cls: "H07",
    what: "owner-only, a kid that is a Pages node whose /Kids name the root",
    truth: { kind: "owner", hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>",
        }),
      ),
  },
  {
    id: "H07-owner-parent-self",
    cls: "H07",
    what: "owner-only, page /Parent is itself",
    truth: { kind: "owner", hostile: true, pages: 1 },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
        }),
      ),
  },
  {
    id: "H07-owner-ref-to-self",
    cls: "H07",
    what: "owner-only, /Contents is object 4 whose value is `4 0 R`",
    truth: { kind: "owner", hostile: true, pages: 1 },
    build: () => owner(onePageWith({ 4: "4 0 R" })),
  },

  /* ---------------- H08 deep page tree ---------------- */
  {
    id: "H08-plain-page-tree-depth-2000",
    cls: "H08",
    what: "/Kids nested 2,000 deep, one page at the bottom",
    truth: { kind: "plain", pages: 1, damaged: true },
    build: () => rawPdf({ objects: deepPageTreeObjects(2000) }),
  },
  {
    id: "H08-owner-page-tree-depth-2000",
    cls: "H08",
    what: "owner-only, /Kids nested 2,000 deep",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => owner(deepPageTreeObjects(2000)),
  },

  /* ---------------- H09 page count lies ---------------- */
  ...(
    [
      ["count-2147483647", "2147483647"],
      ["count-minus-1", "-1"],
      ["count-non-integer", "1.5"],
    ] as const
  ).flatMap(([tag, count]): FixtureSpec[] => [
    {
      id: `H09-plain-${tag}`,
      cls: "H09",
      what: `/Count ${count} with one real page`,
      truth: { kind: "plain", pages: 1, damaged: true },
      build: () =>
        rawPdf({
          objects: onePageWith({
            2: `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
          }),
        }),
    },
    {
      id: `H09-owner-${tag}`,
      cls: "H09",
      what: `owner-only, /Count ${count} with one real page`,
      truth: { kind: "owner", pages: 1, hostile: true },
      build: () =>
        owner(
          onePageWith({
            2: `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
          }),
        ),
    },
  ]),

  /* ---------------- H10 boxes ---------------- */
  {
    id: "H10-owner-mediabox-1e9-userunit",
    cls: "H10",
    what: "owner-only, MediaBox [0 0 1e9 1e9] and /UserUnit 14400",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000000000 1000000000] /UserUnit 14400 /Contents 4 0 R >>",
        }),
      ),
  },
  {
    id: "H10-owner-mediabox-zero",
    cls: "H10",
    what: "owner-only, MediaBox [0 0 0 0]",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 0 0] /Contents 4 0 R >>",
        }),
      ),
  },

  /* ---------------- H12 decompression bomb ---------------- */
  {
    id: "H12-plain-xref-stream-flate-bomb-1GiB",
    cls: "H12",
    isolate: true,
    what: "xref stream whose /FlateDecode body (~1 MB) inflates to 1 GiB",
    truth: { kind: "plain", damaged: true },
    slow: true,
    build: () =>
      xrefStreamPdf({
        objects: ONE_PAGE,
        xrefBody: zeroBomb(1024),
        xrefDict: "/Filter /FlateDecode",
      }),
  },
  {
    id: "H12-plain-xref-stream-chained-flate-bomb-1GiB",
    cls: "H12",
    isolate: true,
    what: "xref stream, [/FlateDecode /FlateDecode] over a 1 GiB zero bomb (a few KB on disk)",
    truth: { kind: "plain", damaged: true },
    slow: true,
    build: () =>
      xrefStreamPdf({
        objects: ONE_PAGE,
        xrefBody: reflate(zeroBomb(1024)),
        xrefDict: "/Filter [/FlateDecode /FlateDecode]",
      }),
  },

  {
    id: "H12-owner-xref-stream-flate-bomb-1GiB",
    cls: "H12",
    isolate: true,
    what: "owner-only, xref stream whose /FlateDecode body (~1 MB) inflates to 1 GiB",
    truth: { kind: "owner", pages: 1, hostile: true },
    slow: true,
    build: () =>
      owner(ONE_PAGE, {
        xrefBody: zeroBomb(1024),
        xrefDict: "/Filter /FlateDecode",
      }),
  },

  /* ---------------- H13 invalid font ---------------- */
  {
    id: "H13-broken-cjk-subset",
    cls: "H13",
    what: "BROKEN_CJK_SUBSET (broken embedded font subset)",
    truth: { kind: "plain", pages: 1 },
    build: () =>
      new Uint8Array(Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64")),
  },

  /* ---------------- H14 open password ---------------- */
  {
    id: "H14-user-rc4-classic",
    cls: "H14",
    what: "userPasswordEncryptedPdf (R3 RC4, classic table)",
    truth: { kind: "user", password: "open-sesame", pages: 1 },
    build: userPasswordEncryptedPdf,
  },
  {
    id: "H14-user-rc4-objstm",
    cls: "H14",
    what: "userPasswordObjectStreamPdf (page tree in an encrypted object stream)",
    truth: { kind: "user", password: "open-sesame", pages: 1 },
    build: userPasswordObjectStreamPdf,
  },
  {
    id: "H14-user-pypdf-r3",
    cls: "H14",
    what: "pypdf R3 open-password fixture",
    truth: {
      kind: "user",
      password: FIXTURE_OPEN_PASSWORD,
      pages: OPEN_PASSWORD_FIXTURE.pageCount,
    },
    build: () => readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file),
  },
  {
    id: "H14-user-pypdf-r3-restricted",
    cls: "H14",
    what: "pypdf R3 open-password + restrictions fixture",
    truth: {
      kind: "user",
      password: FIXTURE_OPEN_PASSWORD,
      pages: OPEN_PASSWORD_RESTRICTED_FIXTURE.pageCount,
    },
    build: () => readRestrictedFixture(OPEN_PASSWORD_RESTRICTED_FIXTURE.file),
  },
  ...(["rc4-40", "aes-128", "aes-256", "aes-256-r5"] as const).map(
    (cipher): FixtureSpec => ({
      id: `H14-user-${cipher}`,
      cls: "H14",
      what: `encryptPdf ${cipher} with an open password`,
      truth: { kind: "user", password: "hostile-open", pages: 1 },
      build: () => encrypted(cipher, "hostile-open"),
    }),
  ),

  /* ---------------- H15 owner-only + unknown handler ---------------- */
  ...RESTRICTED_FIXTURES.map((f): FixtureSpec => ({
    id: `H15-owner-${f.file.replace(/\.pdf$/, "")}`,
    cls: "H15",
    what: `${f.producer} V${f.v} R${f.r} owner-only`,
    truth: { kind: "owner", pages: 1, owner: f.owner },
    save: true,
    build: () => readRestrictedFixture(f.file),
  })),
  {
    id: "H15-owner-view-only-r6",
    cls: "H15",
    what: "qpdf R6 view-only (grants nothing but viewing/printing)",
    truth: { kind: "owner", pages: 1, owner: VIEW_ONLY_FIXTURE.owner },
    build: () => readRestrictedFixture(VIEW_ONLY_FIXTURE.file),
  },
  {
    id: "H15-owner-pypdf-r3-assemble",
    cls: "H15",
    what: "pypdf R3 grant fixture (two pages)",
    truth: {
      kind: "owner",
      pages: ASSEMBLE_COPY_FIXTURE.pageCount,
      owner: ASSEMBLE_COPY_FIXTURE.owner,
    },
    build: () => readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file),
  },
  {
    id: "H15-owner-only-classic",
    cls: "H15",
    what: "ownerOnlyEncryptedPdf (R3 classic)",
    truth: { kind: "owner", pages: 1, owner: "owner-secret" },
    build: ownerOnlyEncryptedPdf,
  },
  {
    id: "H15-owner-only-objstm",
    cls: "H15",
    what: "ownerOnlyObjectStreamPdf (R3, page tree in an object stream)",
    truth: { kind: "owner", pages: 1, owner: "owner-secret" },
    build: ownerOnlyObjectStreamPdf,
  },
  {
    id: "H15-unknown-handler-objstm",
    cls: "H15",
    what: "unknownHandlerObjectStreamPdf (/Filter /Adobe.PubSec)",
    truth: { kind: "unsupported" },
    build: unknownHandlerObjectStreamPdf,
  },
  {
    id: "H15-unknown-handler-pubsec",
    cls: "H15",
    what: "unsupportedEncryptionPdf (public-key handler, classic)",
    truth: { kind: "unsupported" },
    build: unsupportedEncryptionPdf,
  },
  ...(
    [
      ["r-99", (d: string) => d.replace("/R 3", "/R 99"), "/R 99"],
      [
        "v-3",
        (d: string) => d.replace("/V 2", "/V 3"),
        "/V 3 (never published)",
      ],
      [
        "length-0",
        (d: string) => d.replace("/Length 128", "/Length 0"),
        "/Length 0",
      ],
      [
        "length-negative",
        (d: string) => d.replace("/Length 128", "/Length -8"),
        "/Length -8",
      ],
      [
        "length-1e9",
        (d: string) => d.replace("/Length 128", "/Length 1000000000"),
        "/Length 1000000000",
      ],
      ["o-missing", (d: string) => d.replace(/\/O <[0-9A-F]+>/, ""), "no /O"],
      [
        "u-short",
        (d: string) => d.replace(/\/U <([0-9A-F]{8})[0-9A-F]+>/, "/U <$1>"),
        "/U of 4 bytes",
      ],
      [
        "o-not-string",
        (d: string) => d.replace(/\/O <[0-9A-F]+>/, "/O 42"),
        "/O is a number",
      ],
      [
        "p-huge",
        (d: string) => d.replace("/P -3900", "/P 99999999999999999999"),
        "/P 99999999999999999999",
      ],
      [
        "v4-cf-missing",
        (d: string) =>
          d.replace("/V 2 /R 3", "/V 4 /R 4 /StmF /StdCF /StrF /StdCF"),
        "V4 naming a crypt filter /CF lacks",
      ],
      [
        "v4-cfm-unknown",
        (d: string) =>
          d.replace(
            "/V 2 /R 3",
            "/V 4 /R 4 /StmF /StdCF /StrF /StdCF /CF << /StdCF << /CFM /ROT13 >> >>",
          ),
        "V4 crypt filter /CFM /ROT13",
      ],
      [
        "r6-ue-missing",
        (d: string) => d.replace("/V 2 /R 3", "/V 5 /R 6"),
        "V5 R6 with 32-byte /O /U and no /OE /UE",
      ],
    ] as const
  ).map(([tag, edit, what]): FixtureSpec => ({
    id: `H15-hostile-encrypt-${tag}`,
    cls: "H15",
    what: `owner-only R3 file whose /Encrypt has ${what}`,
    truth: { kind: "owner", hostile: true },
    build: () => owner(ONE_PAGE, { encryptDict: edit }),
  })),
  {
    id: "H15-hostile-encrypt-dangling-ref",
    cls: "H15",
    what: "trailer /Encrypt names an object that does not exist",
    truth: { kind: "owner", hostile: true },
    build: () => owner(ONE_PAGE, { encryptEntry: () => "77 0 R" }),
  },
  {
    id: "H15-hostile-encrypt-ref-to-ref",
    cls: "H15",
    what: "trailer /Encrypt names an object whose value is a reference to itself",
    truth: { kind: "owner", hostile: true },
    build: () => owner([...ONE_PAGE, "5 0 R"], { encryptEntry: () => "5 0 R" }),
  },

  /* ---------------- H16 active content ---------------- */
  {
    id: "H16-owner-js-launch-uri-embedded",
    cls: "H16",
    what: "owner-only with /OpenAction JavaScript, catalog /AA, /Launch, a javascript: /URI and an /EmbeddedFiles tree",
    truth: { kind: "owner", pages: 1, owner: "hostile-owner" },
    save: true,
    build: () =>
      owner([
        "<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R /AA << /WC 6 0 R >> /Names << /EmbeddedFiles << /Names [{{S:evil.exe}} 7 0 R] >> >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [8 0 R] >>",
        { dict: "", stream: latin1("0 0 m 100 100 l S") },
        "<< /S /JavaScript /JS 9 0 R >>",
        "<< /S /Launch /F {{S:cmd.exe}} >>",
        "<< /Type /Filespec /F {{S:evil.exe}} /EF << /F 10 0 R >> >>",
        "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI {{S:javascript:alert(1)}} >> >>",
        { dict: "", stream: latin1("app.alert('hostile-js-marker');") },
        {
          dict: "/Type /EmbeddedFile",
          stream: latin1("MZ hostile-embedded-marker"),
        },
      ]),
  },

  /* ---------------- H17 signatures + incremental ---------------- */
  {
    id: "H17-owner-signed-restricted-then-update",
    cls: "H17",
    what: "pypdf R3 restricted + certificate-signed; saveChanges appends an update after the signed revision",
    truth: {
      kind: "owner",
      pages: SIGNED_RESTRICTED_FIXTURE.pageCount,
      owner: SIGNED_RESTRICTED_FIXTURE.owner,
    },
    signatures: 1,
    save: true,
    build: () => readRestrictedFixture(SIGNED_RESTRICTED_FIXTURE.file),
  },
  {
    id: "H17-plain-signed",
    cls: "H17",
    what: "one signed signature dictionary on a field",
    truth: { kind: "plain", pages: 1 },
    signatures: 1,
    build: () => rawPdf({ objects: signedObjects("[0 100 228 300]") }),
  },
  {
    id: "H17-plain-signed-then-sig-rewritten",
    cls: "H17",
    what: "signed, then an incremental update REWRITES the same signature object with a new /ByteRange (a reader sees one signature)",
    truth: { kind: "plain", pages: 1 },
    signatures: 1,
    build: signedThenResigned,
  },
  {
    id: "H17-plain-byterange-in-content-text",
    cls: "H17",
    what: "no signature; page text draws the literal string '/ByteRange [0 10 20 30]'",
    truth: { kind: "plain", pages: 1 },
    signatures: 0,
    build: () =>
      rawPdf({
        objects: onePageWith({
          4: {
            dict: "",
            stream: latin1(
              "BT /F1 12 Tf 10 10 Td (/ByteRange [0 10 20 30]) Tj ET",
            ),
          },
        }),
      }),
  },
  {
    id: "H17-plain-placeholder-byterange",
    cls: "H17",
    what: "an unsigned placeholder /ByteRange [0 /********** /********** /**********]",
    truth: { kind: "plain", pages: 1 },
    signatures: 0,
    build: () =>
      rawPdf({
        objects: signedObjects("[0 /********** /********** /**********]"),
      }),
  },

  /* ---------------- H18 numbers ---------------- */
  {
    id: "H18-plain-xref-w-zero-index-2e31",
    cls: "H18",
    what: "xref stream /W [0 0 0] /Index [0 2147483647] (zero-width rows, 2^31 entries declared)",
    truth: { kind: "plain", damaged: true },
    build: () =>
      xrefStreamPdf({
        objects: ONE_PAGE,
        w: "[0 0 0]",
        index: "[0 2147483647]",
      }),
  },
  {
    id: "H18-owner-xref-w-zero-index-2e31",
    cls: "H18",
    what: "owner-only, xref stream /W [0 0 0] /Index [0 2147483647]",
    truth: { kind: "owner", hostile: true },
    build: () =>
      xrefStreamPdf({
        objects: [...ONE_PAGE, `<< ${standardEncrypt()} >>`],
        w: "[0 0 0]",
        index: "[0 2147483647]",
        trailer: "/Encrypt 5 0 R /ID [<00> <00>]",
      }),
  },
  {
    id: "H18-plain-xref-size-huge",
    cls: "H18",
    what: "xref stream /Size 99999999999999999999",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () =>
      xrefStreamPdf({ objects: ONE_PAGE, size: "99999999999999999999" }),
  },
  {
    id: "H18-plain-xref-w-1e309",
    cls: "H18",
    what: "xref stream /W [1 1e309 1]",
    truth: { kind: "plain", damaged: true },
    build: () => xrefStreamPdf({ objects: ONE_PAGE, w: "[1 1e309 1]" }),
  },
  {
    id: "H18-plain-startxref-huge",
    cls: "H18",
    what: "startxref 99999999999999999999",
    truth: { kind: "plain", damaged: true, pages: 1 },
    build: () =>
      rawPdf({ objects: ONE_PAGE, startxref: "99999999999999999999" }),
  },
  {
    id: "H18-owner-prev-minus-zero",
    cls: "H18",
    what: "owner-only, trailer /Prev -0",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => owner(ONE_PAGE, { trailer: "/Prev -0" }),
  },
  {
    id: "H18-owner-prev-dot",
    cls: "H18",
    what: "owner-only, trailer /Prev . (a lone dot)",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => owner(ONE_PAGE, { trailer: "/Prev ." }),
  },
  {
    id: "H18-owner-mediabox-rotate-nan",
    cls: "H18",
    what: "owner-only, MediaBox [0 0 1e309 --5], /Rotate 99999999999999999999",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1e309 --5] /Rotate 99999999999999999999 /Contents 4 0 R >>",
        }),
      ),
  },
  {
    id: "H18-linearized-L-huge",
    cls: "H18",
    what: "first object /Linearized 1 /L 99999999999999999999",
    truth: { kind: "plain", pages: 1 },
    build: () =>
      linearizedBy(() => "/Linearized 1 /L 99999999999999999999 /N 1"),
  },
  {
    id: "H18-linearized-flag-1e309",
    cls: "H18",
    what: "first object /Linearized 1e309 with a true /L",
    truth: { kind: "plain", pages: 1 },
    linearized: true,
    build: () => linearizedBy((len) => `/Linearized 1e309 /L ${len} /N 1`),
  },
  {
    id: "H18-linearized-flag-minus-zero",
    cls: "H18",
    what: "first object /Linearized -0 with a true /L",
    truth: { kind: "plain", pages: 1 },
    build: () => linearizedBy((len) => `/Linearized -0 /L ${len} /N 1`),
  },
  {
    id: "H18-linearized-nested-dict",
    cls: "H18",
    what: "a true linearization dict whose first key holds a nested dict carrying its own /L",
    truth: { kind: "plain", pages: 1 },
    linearized: true,
    build: () =>
      linearizedBy((len) => `/Linearized 1 /X << /L 5 >> /L ${len} /N 1`),
  },
  {
    id: "H18-linearized-past-window",
    cls: "H18",
    what: "a true linearization dict pushed past byte 1024 by a comment",
    truth: { kind: "plain", pages: 1 },
    build: () =>
      linearizedBy(
        (len) => `/Linearized 1 /L ${len} /N 1`,
        `%${"x".repeat(1100)}`,
      ),
  },
  {
    id: "H18-byterange-huge-integer",
    cls: "H18",
    what: "signed dict with /ByteRange [0 99999999999999999999 1 2]",
    truth: { kind: "plain", pages: 1 },
    signatures: 1,
    build: () =>
      rawPdf({ objects: signedObjects("[0 99999999999999999999 1 2]") }),
  },

  ...(
    [
      ["mediabox-1e309", "/MediaBox [0 0 1e309 200]"],
      ["mediabox-double-minus", "/MediaBox [0 0 200 --5]"],
      [
        "rotate-20-digits",
        "/MediaBox [0 0 200 200] /Rotate 99999999999999999999",
      ],
    ] as const
  ).map(([tag, keys]): FixtureSpec => ({
    id: `H18-owner-${tag}`,
    cls: "H18",
    what: `owner-only, page dictionary with ${keys}`,
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: `<< /Type /Page /Parent 2 0 R ${keys} /Contents 4 0 R >>`,
        }),
      ),
  })),

  /* ---------------- H19 duplicate ids ---------------- */
  {
    id: "H19-plain-duplicate-page-object",
    cls: "H19",
    what: "object 3 defined twice (second with a 50x50 box); the table names the first",
    truth: { kind: "plain", pages: 1 },
    build: () =>
      rawPdf({
        objects: [
          ...ONE_PAGE,
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 50] >>",
        ],
        numbers: [1, 2, 3, 4, 3],
      }),
  },

  /* ---------------- H20 PDF 2.0 + object streams ---------------- */
  {
    id: "H20-plain-pdf20-objstm-catalog",
    cls: "H20",
    what: "%PDF-2.0, xref stream only, catalog in an object stream",
    truth: { kind: "plain", pages: 1 },
    build: () =>
      xrefStreamPdf({ header: "%PDF-2.0", objects: ONE_PAGE, pack: [1, 2, 3] }),
  },
  {
    id: "H20-owner-pdf20-objstm-catalog",
    cls: "H20",
    what: "owner-only %PDF-2.0, catalog in an encrypted object stream",
    truth: { kind: "owner", pages: 1, owner: "hostile-owner" },
    save: true,
    build: () => owner(ONE_PAGE, { header: "%PDF-2.0", pack: [1, 2, 3] }),
  },
  {
    id: "H20-owner-pdf20-aes256-objstm",
    cls: "H20",
    what: "encryptPdf aes-256 objectStreams with the header rewritten to %PDF-2.0",
    truth: { kind: "owner", pages: 1, owner: "owner-aes-256" },
    save: true,
    build: async () => {
      const b = await encrypted("aes-256", "", true);
      const head = text(b.subarray(0, 8));
      if (!/^%PDF-1\.\d$/.test(head))
        throw new Error(`unexpected header ${head}`);
      const out = b.slice();
      out.set(latin1("%PDF-2.0"), 0);
      return out;
    },
  },

  /* ---------------- H21 2,000 pages ---------------- */
  {
    id: "H21-plain-2000-pages",
    cls: "H21",
    what: "2,000 pages sharing one content stream",
    truth: { kind: "plain", pages: 2000 },
    slow: true,
    build: () => rawPdf({ objects: manyPageObjects(2000) }),
  },
  {
    id: "H21-owner-2000-pages",
    cls: "H21",
    what: "owner-only, 2,000 pages sharing one content stream",
    truth: { kind: "owner", pages: 2000, owner: "hostile-owner" },
    slow: true,
    save: true,
    build: () => owner(manyPageObjects(2000)),
  },

  /* ---------------- H22 rotation ---------------- */
  {
    id: "H22-owner-rotate-45",
    cls: "H22",
    what: "owner-only, page /Rotate 45",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Rotate 45 /Contents 4 0 R >>",
        }),
      ),
  },
  {
    id: "H22-owner-rotate-inherited-1e9",
    cls: "H22",
    what: "owner-only, /Rotate 1000000000 inherited from Pages",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner(
        onePageWith({
          2: "<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 1000000000 >>",
        }),
      ),
  },

  /* ---------------- H23 object stream lies ---------------- */
  {
    id: "H23-owner-objstm-N-1e9",
    cls: "H23",
    what: "owner-only, encrypted object stream declaring /N 999999999 (holds 3)",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => owner(ONE_PAGE, { pack: [1, 2, 3], objStmN: "999999999" }),
  },
  {
    id: "H23-owner-objstm-N-1e5",
    cls: "H23",
    what: "owner-only, encrypted object stream declaring /N 100000 (holds 3)",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () => owner(ONE_PAGE, { pack: [1, 2, 3], objStmN: "100000" }),
  },
  {
    id: "H23-owner-objstm-N-1e9-unrelated",
    cls: "H23",
    what: "owner-only; the page tree is plain, and an object stream holding ONE unrelated dict declares /N 999999999",
    truth: { kind: "owner", pages: 1, hostile: true },
    build: () =>
      owner([...ONE_PAGE, "<< /Unrelated true >>"], {
        pack: [5],
        objStmN: "999999999",
      }),
  },
  {
    id: "H23-owner-objstm-first-past-end",
    cls: "H23",
    what: "owner-only, encrypted object stream with /First 999999",
    truth: { kind: "owner", hostile: true },
    build: () => owner(ONE_PAGE, { pack: [1, 2, 3], objStmFirst: "999999" }),
  },

  /* ---------------- linearization controls ---------------- */
  {
    id: "CTRL-linearized",
    cls: "CTRL",
    what: "linearizedPdf() (positive control for linearization)",
    truth: { kind: "plain", pages: 1 },
    linearized: true,
    build: () => linearizedPdf(),
  },
  {
    id: "CTRL-linearized-then-updated",
    cls: "CTRL",
    what: "linearizedThenUpdatedPdf() (incremental update after linearization)",
    truth: { kind: "plain", damaged: true },
    build: () => linearizedThenUpdatedPdf(),
  },
  {
    id: "CTRL-linearized-own-builder",
    cls: "CTRL",
    what: "this family's linearizedBy() with an honest dict (control for the H18 linearization variants)",
    truth: { kind: "plain", pages: 1 },
    linearized: true,
    build: () => linearizedBy((len) => `/Linearized 1 /L ${len} /N 1`),
  },
];

/** A Standard /Encrypt body for files that never get far enough to need a real key. */
function standardEncrypt(): string {
  return (
    "/Filter /Standard /V 2 /R 3 /Length 128 /P -3900 /O <" +
    "00".repeat(32) +
    "> /U <" +
    "00".repeat(32) +
    ">"
  );
}
