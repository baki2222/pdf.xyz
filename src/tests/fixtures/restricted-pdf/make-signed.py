"""The RESTRICTED + CERTIFICATE-SIGNED fixture (see README.md beside this file).

grant-base.pdf (pdf-lib) gets one signed signature field — a /Sig value with
a /ByteRange and a /Contents hole, signed in structure, not in cryptography,
like src/tests/signed-pdf.ts — and is encrypted by pypdf (RC4 128-bit,
revision 3), which shares no code with pdf.xyz. It opens with the EMPTY user
password; the owner password is a test value, written in the README.

The /ByteRange is written as a fixed-width placeholder and patched in the
saved bytes afterwards, as a signer does, so it names the real offsets of
the encrypted file around its /Contents hole.

    python -I make-signed.py <dir containing grant-base.pdf>
"""

import re
import sys
from pathlib import Path

import pypdf
from pypdf.constants import UserAccessPermissions as UAP
from pypdf.generic import (
    ArrayObject,
    ByteStringObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

NAME = "pypdf-r3-signed-restricted.pdf"
OWNER = "owner-signed-test"
# Print, comment, fill forms, accessibility, high-quality print granted;
# change content (8), copy (16) and assemble (1024) withheld (P -1052).
FILL_ONLY = -1 & ~(1 | 2 | 8 | 16 | 1024)
PLACEHOLDER = [1111111111, 2222222222, 3333333333]


def main(folder: Path):
    writer = pypdf.PdfWriter(clone_from=str(folder / "grant-base.pdf"))
    sig = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Sig"),
                NameObject("/Filter"): NameObject("/Adobe.PPKLite"),
                NameObject("/SubFilter"): NameObject("/adbe.pkcs7.detached"),
                NameObject("/ByteRange"): ArrayObject(
                    [NumberObject(0)] + [NumberObject(n) for n in PLACEHOLDER]
                ),
                NameObject("/Contents"): ByteStringObject(b"\x00" * 256),
                NameObject("/M"): TextStringObject("D:20260901120000Z"),
            }
        )
    )
    page = writer.pages[0]
    widget = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Sig"),
                NameObject("/T"): TextStringObject("Signature1"),
                NameObject("/Rect"): ArrayObject([NumberObject(0)] * 4),
                NameObject("/F"): NumberObject(132),
                NameObject("/P"): page.indirect_reference,
                NameObject("/V"): sig,
            }
        )
    )
    page[NameObject("/Annots")] = ArrayObject([widget])
    writer._root_object[NameObject("/AcroForm")] = DictionaryObject(
        {
            NameObject("/Fields"): ArrayObject([widget]),
            NameObject("/SigFlags"): NumberObject(3),
        }
    )
    writer.encrypt(
        user_password="",
        owner_password=OWNER,
        permissions_flag=UAP(FILL_ONLY & 0xFFFFFFFF),
        algorithm="RC4-128",
    )
    out = folder / NAME
    with open(out, "wb") as fh:
        writer.write(fh)

    data = bytearray(out.read_bytes())
    text = data.decode("latin1")
    placeholder = re.search(
        r"\[\s*0\s+" + r"\s+".join(str(n) for n in PLACEHOLDER) + r"\s*\]", text
    )
    if not placeholder:
        raise SystemExit("placeholder /ByteRange not found")
    open_at = text.index("<", text.index("/Contents", placeholder.end()))
    close_at = text.index(">", open_at) + 1
    width = placeholder.end() - placeholder.start()
    real = f"[0 {open_at} {close_at} {len(data) - close_at}"
    real = real.ljust(width - 1) + "]"
    assert len(real) == width
    data[placeholder.start() : placeholder.end()] = real.encode("latin1")
    out.write_bytes(bytes(data))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
