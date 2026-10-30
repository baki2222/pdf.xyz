"""Step 2 of the restricted-PDF fixtures (see README.md beside this file).

Encrypts base.pdf with two producers that share no code with pdf.xyz:
qpdf (through pikepdf) and pypdf. Every file opens with the EMPTY user
password; the owner password is a fixed test value, written in the README.

    python -I make-encrypted.py <dir containing base.pdf>
"""

import sys
from pathlib import Path

import pikepdf
import pypdf
from pypdf.constants import UserAccessPermissions as UAP

OWNER = {
    "qpdf-r6-aes256.pdf": "owner-r6-test",
    "qpdf-r5-aes256.pdf": "owner-r5-test",
    "qpdf-r4-aes128.pdf": "owner-r4-test",
    "qpdf-r3-rc4-128.pdf": "owner-r3-test",
    "qpdf-r2-rc4-40.pdf": "owner-r2-test",
    "qpdf-r6-view-only.pdf": "owner-view-test",
    "pypdf-r6-aes256.pdf": "owner-pypdf-test",
}

# Print, fill forms, comment, accessibility, high-quality print: granted.
# Change content, copy, assemble: withheld. The owner's sample carries the
# same grant (P = -1052).
FILL_ONLY = pikepdf.Permissions(
    accessibility=True,
    extract=False,
    modify_annotation=True,
    modify_assembly=False,
    modify_form=True,
    modify_other=False,
    print_lowres=True,
    print_highres=True,
)
# Nothing but viewing, printing and accessibility.
VIEW_ONLY = pikepdf.Permissions(
    accessibility=True,
    extract=False,
    modify_annotation=False,
    modify_assembly=False,
    modify_form=False,
    modify_other=False,
    print_lowres=True,
    print_highres=True,
)


def qpdf(base: Path, out: Path, r: int, aes: bool, perms, streams: bool):
    with pikepdf.open(base) as pdf:
        pdf.save(
            out,
            encryption=pikepdf.Encryption(
                user="",
                owner=OWNER[out.name],
                R=r,
                aes=aes,
                allow=perms,
                metadata=r >= 4,
            ),
            object_stream_mode=(
                pikepdf.ObjectStreamMode.generate
                if streams
                else pikepdf.ObjectStreamMode.disable
            ),
            # Fixed /ID and no wall-clock, so a re-run is comparable.
            static_id=True,
            deterministic_id=False,
        )


def main(folder: Path):
    base = folder / "base.pdf"
    qpdf(base, folder / "qpdf-r6-aes256.pdf", 6, True, FILL_ONLY, True)
    qpdf(base, folder / "qpdf-r5-aes256.pdf", 5, True, FILL_ONLY, True)
    qpdf(base, folder / "qpdf-r4-aes128.pdf", 4, True, FILL_ONLY, True)
    qpdf(base, folder / "qpdf-r3-rc4-128.pdf", 3, False, FILL_ONLY, False)
    qpdf(base, folder / "qpdf-r2-rc4-40.pdf", 2, False, FILL_ONLY, False)
    qpdf(base, folder / "qpdf-r6-view-only.pdf", 6, True, VIEW_ONLY, True)

    writer = pypdf.PdfWriter(clone_from=str(base))
    # The /P value qpdf writes for FILL_ONLY (bits 1, 2, 4, 5, 11 clear).
    granted = UAP(-1052 & 0xFFFFFFFF)
    writer.encrypt(
        user_password="",
        owner_password=OWNER["pypdf-r6-aes256.pdf"],
        permissions_flag=granted,
        algorithm="AES-256",
    )
    with open(folder / "pypdf-r6-aes256.pdf", "wb") as fh:
        writer.write(fh)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
