import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The restricted-PDF fixtures (`src/tests/fixtures/restricted-pdf/`), made
 * by qpdf and pypdf — never by the handler they test. How, and the owner
 * passwords, are in that folder's README; the passwords are test values.
 */
export const RESTRICTED_FIXTURE_DIR = path.join(
  process.cwd(),
  "src/tests/fixtures/restricted-pdf",
);

export interface RestrictedFixture {
  file: string;
  producer: "qpdf" | "pypdf";
  v: number;
  r: number;
  owner: string;
  /** pdf.js `getPermissions()` of the file, as published. */
  permissions: number[];
  objectStreams: boolean;
}

/** print, comment, fill forms, accessibility, high-quality print (/P -1052). */
export const FILL_ONLY_PERMISSIONS = [4, 32, 256, 512, 2048];

export const RESTRICTED_FIXTURES: readonly RestrictedFixture[] = [
  {
    file: "qpdf-r6-aes256.pdf",
    producer: "qpdf",
    v: 5,
    r: 6,
    owner: "owner-r6-test",
    permissions: FILL_ONLY_PERMISSIONS,
    objectStreams: true,
  },
  {
    file: "qpdf-r5-aes256.pdf",
    producer: "qpdf",
    v: 5,
    r: 5,
    owner: "owner-r5-test",
    permissions: FILL_ONLY_PERMISSIONS,
    objectStreams: true,
  },
  {
    file: "qpdf-r4-aes128.pdf",
    producer: "qpdf",
    v: 4,
    r: 4,
    owner: "owner-r4-test",
    permissions: FILL_ONLY_PERMISSIONS,
    objectStreams: true,
  },
  {
    file: "qpdf-r3-rc4-128.pdf",
    producer: "qpdf",
    v: 2,
    r: 3,
    owner: "owner-r3-test",
    permissions: FILL_ONLY_PERMISSIONS,
    objectStreams: false,
  },
  {
    file: "qpdf-r2-rc4-40.pdf",
    producer: "qpdf",
    v: 1,
    r: 2,
    owner: "owner-r2-test",
    // R2 has no bits above 6: assembly cannot be withheld separately.
    permissions: [4, 32, 256, 512, 1024, 2048],
    objectStreams: false,
  },
  {
    file: "pypdf-r6-aes256.pdf",
    producer: "pypdf",
    v: 5,
    r: 6,
    owner: "owner-pypdf-test",
    permissions: FILL_ONLY_PERMISSIONS,
    objectStreams: false,
  },
];

/** Opens with no password and grants nothing but viewing and printing. */
export const VIEW_ONLY_FIXTURE: RestrictedFixture = {
  file: "qpdf-r6-view-only.pdf",
  producer: "qpdf",
  v: 5,
  r: 6,
  owner: "owner-view-test",
  permissions: [4, 512, 2048],
  objectStreams: true,
};

/** The fields every fixture carries (from `make-base.ts`). */
export const FIXTURE_FIELDS = {
  text: ["full_name", "email"],
  checkbox: "agree",
  dropdown: { name: "country", options: ["Bangladesh", "Germany", "Japan"] },
} as const;

/** The page text every fixture draws. */
export const FIXTURE_PAGE_TEXT = "RESTRICTED-FORM-FIXTURE";

export function readRestrictedFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(RESTRICTED_FIXTURE_DIR, file)));
}
