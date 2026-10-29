# Restricted-PDF fixtures

Encrypted PDFs that open with an **empty user password** and whose author
grants only some permissions — the kind of file Edit PDF and Fill Forms open in
restricted mode (`src/lib/pdf/security`). They test that handler, so **none of
them was made by it**: the form is drawn by pdf-lib, and the encryption is
added by qpdf and pypdf, which share no code with pdf.xyz. Every output the
tests write is read back by pdf.js, a third, independent decryptor.

No user's document went into any file here.

## How they were made (2026-10-29)

1. `base.pdf` — `pnpm exec tsx src/tests/fixtures/restricted-pdf/make-base.ts base.pdf`
   (pdf-lib 1.17.1, object streams on): one Letter page with the line
   `RESTRICTED-FORM-FIXTURE`, text fields `full_name` and `email`, checkbox
   `agree`, dropdown `country` (Bangladesh, Germany, Japan).
2. Everything else — `python -I make-encrypted.py <this folder>` with
   pikepdf 10.17.0 (libqpdf 12.4.2) and pypdf 6.21.4 (+ cryptography, for
   AES).

| file                    | producer | V / R           | cipher  | object streams | grant (pdf.js `getPermissions()`) | owner password     |
| ----------------------- | -------- | --------------- | ------- | -------------- | --------------------------------- | ------------------ |
| `qpdf-r6-aes256.pdf`    | qpdf     | V5 R6           | AES-256 | yes            | 4, 32, 256, 512, 2048 (P −1052)   | `owner-r6-test`    |
| `qpdf-r5-aes256.pdf`    | qpdf     | V5 R5 (Adobe 3) | AES-256 | yes            | 4, 32, 256, 512, 2048             | `owner-r5-test`    |
| `qpdf-r4-aes128.pdf`    | qpdf     | V4 R4           | AES-128 | yes            | 4, 32, 256, 512, 2048             | `owner-r4-test`    |
| `qpdf-r3-rc4-128.pdf`   | qpdf     | V2 R3           | RC4 128 | no             | 4, 32, 256, 512, 2048             | `owner-r3-test`    |
| `qpdf-r2-rc4-40.pdf`    | qpdf     | V1 R2           | RC4 40  | no             | 4, 32, 256, 512, 1024, 2048       | `owner-r2-test`    |
| `qpdf-r6-view-only.pdf` | qpdf     | V5 R6           | AES-256 | yes            | 4, 512, 2048                      | `owner-view-test`  |
| `pypdf-r6-aes256.pdf`   | pypdf    | V5 R6           | AES-256 | no             | 4, 32, 256, 512, 2048             | `owner-pypdf-test` |

"Fill only" is print, comment (32), fill forms (256), accessibility and
high-quality print; change content (8), copy (16) and assemble (1024) withheld.
R2 has no separate assembly bit, so it reads as granted there. pypdf writes /P
unsigned (4294966244), qpdf signed (−1052) — the same bits, and both are read.

The owner passwords are **test values**, published here on purpose.

`hash-2b-vectors.json` — 24 inputs to revision 6's Algorithm 2.B with
pypdf's result for each, half of them stopping on the boundary round (the
last byte of E equal to the round count minus 32): `python -I
make-hash-2b-vectors.py hash-2b-vectors.json` (fixed seed). A fixture file
has one random key, so whether it exercises that boundary is luck; these do
on purpose. Added 2026-10-30, when the worker-image proof hit it.

## Where they are used

- `src/tests/restricted-pdf-fixtures.ts` — the table above, as data.
- `src/lib/pdf/security/protected-pdf.test.ts` — key derivation, owner password
  right/wrong, fill-and-save read back by pdf.js, the unencrypted-write control.
- `e2e/restricted-pdf.spec.ts` — the banner, a fill and a download in
  `/tools/edit-pdf`, then the owner password.

The worker-image proof (`scripts/worker-restricted-edit-proof.ts`) does not use
these files: it encrypts `make-base.ts`'s form with the image's own qpdf.
