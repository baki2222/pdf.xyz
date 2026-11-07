"""Step 2 of the GRANT fixtures (see README.md beside this file).

Encrypts grant-base.pdf with pypdf (RC4 128-bit, revision 3 — pypdf's own
cipher, no extra package), which shares no code with pdf.xyz. Two files
open with the EMPTY user password, two need the open password "open-test";
every password is a test value, written in the README.

    python -I make-grant.py <dir containing grant-base.pdf>
"""

import sys
from pathlib import Path

import pypdf
from pypdf.constants import UserAccessPermissions as UAP

# Every bit set, then: bits 1-2 (reserved, must be 0), 4 (change content),
# 6 (comments) and 9 (fill forms) cleared. Print, copy (bit 5),
# accessibility, ASSEMBLE (bit 11) and high-quality print stay granted.
ASSEMBLE_COPY = -1 & ~(1 | 2 | 8 | 32 | 256)  # -300
# The same, with copy (bit 5) and assemble (bit 11) cleared too.
NEITHER = ASSEMBLE_COPY & ~(16 | 1024)  # -1340

# Every permission granted (bits 1-2 cleared, as the format requires).
EVERYTHING = -4

# name: (open password, owner password, /P). An empty open password opens
# the file in any viewer; the last two need theirs ("open-test").
FILES = {
    "pypdf-r3-assemble-copy.pdf": ("", "owner-grant-test", ASSEMBLE_COPY),
    "pypdf-r3-no-assemble-copy.pdf": ("", "owner-nogrant-test", NEITHER),
    "pypdf-r3-open-password.pdf": ("open-test", "owner-open-test", EVERYTHING),
    "pypdf-r3-open-password-restricted.pdf": (
        "open-test",
        "owner-openrestr-test",
        ASSEMBLE_COPY,
    ),
}


def main(folder: Path):
    base = folder / "grant-base.pdf"
    for name, (user, owner, p) in FILES.items():
        writer = pypdf.PdfWriter(clone_from=str(base))
        writer.encrypt(
            user_password=user,
            owner_password=owner,
            permissions_flag=UAP(p & 0xFFFFFFFF),
            algorithm="RC4-128",
        )
        with open(folder / name, "wb") as fh:
            writer.write(fh)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
