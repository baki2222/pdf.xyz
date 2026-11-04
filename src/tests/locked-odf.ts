/**
 * The password-locked OpenDocument files LibreOffice wrote in the worker
 * image (`odf-locked-fixtures/PROVENANCE.txt`), as the in-image proof and the
 * unit tests read them. One per Office to PDF tool, and the unlocked twin of
 * the Writer one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LockedOfficeFile } from "@/lib/workers/office-conversion/input-proof";

const DIR = join(process.cwd(), "src", "tests", "odf-locked-fixtures");
const read = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

export function lockedOdfFixtures(): {
  locked: LockedOfficeFile[];
  lockedTwin: LockedOfficeFile & { word: string };
} {
  return {
    locked: [
      { tool: "word-to-pdf", name: "locked.odt", bytes: read("locked.odt") },
      { tool: "excel-to-pdf", name: "locked.ods", bytes: read("locked.ods") },
      {
        tool: "powerpoint-to-pdf",
        name: "locked.odp",
        bytes: read("locked.odp"),
      },
    ],
    lockedTwin: {
      tool: "word-to-pdf",
      name: "open.odt",
      bytes: read("open.odt"),
      word: "LOCKEDODT",
    },
  };
}
