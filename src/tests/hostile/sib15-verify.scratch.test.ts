// @native-canvas
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  classifyPdfAccess,
  probePdfEncryption,
  type PdfjsForAccess,
} from "@/lib/pdf/encryption";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import {
  ONE_PAGE,
  ownerOnlyEncrypted,
  xrefStreamPdf,
} from "./security-in-browser.fixtures";

const req = createRequire(import.meta.url);
async function legacy(): Promise<PdfjsForAccess> {
  return (await import(
    pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  )) as PdfjsForAccess;
}

async function rawError(bytes: Uint8Array): Promise<string> {
  const lib = await legacy();
  const task = lib.getDocument({ data: bytes.slice(), ...PDFJS_DOCUMENT_DEFAULTS });
  try {
    const d = await task.promise;
    return `opened pages=${d.numPages}`;
  } catch (e) {
    const { name, message, code } = e as { name?: string; message?: string; code?: number };
    return `${name} code=${code} ${message}`;
  } finally {
    await task.destroy().catch(() => {});
  }
}

const cases: [string, () => Uint8Array][] = [
  ["CTRL owner packed, honest", () => ownerOnlyEncrypted(ONE_PAGE, { pack: [1, 2, 3] })],
  ["N 100000", () => ownerOnlyEncrypted(ONE_PAGE, { pack: [1, 2, 3], objStmN: "100000" })],
  ["First 999999", () => ownerOnlyEncrypted(ONE_PAGE, { pack: [1, 2, 3], objStmFirst: "999999" })],
  ["CTRL plain N 100000", () => xrefStreamPdf({ objects: ONE_PAGE, pack: [1, 2, 3], objStmN: "100000" })],
  ["CTRL owner user=secret honest", () => ownerOnlyEncrypted(ONE_PAGE, { pack: [1, 2, 3], user: "secret" })],
];

describe("SIB-15 verify", () => {
  for (const [name, build] of cases) {
    it(name, { timeout: 120_000 }, async () => {
      const bytes = build();
      const access = await classifyPdfAccess(bytes, await legacy());
      const probe = await probePdfEncryption(bytes, legacy);
      const raw = await rawError(bytes);
      appendFileSync(process.env.SIB15_OUT ?? "sib15.out", `[SIB15-pre] ${name} | classify=${access.kind} | probe=${probe} | raw=${raw}
`);
      let open: string;
      try {
        const r = await openProtectedPdf(bytes);
        open = r.kind === "opened"
          ? `opened as=${r.pdf.authenticatedAs} pages=${(r.pdf as unknown as { pageCount?: number }).pageCount}`
          : JSON.stringify(r);
      } catch (e) {
        open = `threw ${(e as Error).message}`;
      }
      appendFileSync(process.env.SIB15_OUT ?? "sib15.out", `[SIB15] ${name} | classify=${access.kind} | probe=${probe} | raw=${raw} | open=${open}
`);
      expect(true).toBe(true);
    });
  }
});
