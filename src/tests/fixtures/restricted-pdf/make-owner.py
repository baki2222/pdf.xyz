"""The OWNER-PASSWORD fixtures (see README.md beside this file).

Encrypts grant-base.pdf (two pages, an 8 x 8 picture on page 1) with pypdf
in AES-128 (V4 R4) and AES-256 (V5 R6), withholding copying and page
assembly with everything else the RC4 file `pypdf-r3-no-assemble-copy.pdf`
withholds — so Rotate PDF and Extract Images refuse them, and Merge PDF,
Extract Pages and Delete Pages refuse every encrypted file. Two open with
the EMPTY user password; one needs the open password "open-test". Every
password is a test value, written in the README.

pypdf's AES needs the `cryptography` package; where it is missing this
script supplies the AES block operations from Node's own `crypto` module
(one `node` process per call), which shares no code with pdf.xyz's
handler either. The bytes pypdf writes are the same either way.

    python -I make-owner.py <dir containing grant-base.pdf> [--only NAME]
"""

import secrets
import subprocess
import sys
from pathlib import Path

import pypdf
from pypdf import _encryption
from pypdf.constants import UserAccessPermissions as UAP

# As make-grant.py's NEITHER: print, accessibility and high-quality print
# granted; change content (bit 4), copy (5), comments (6), fill forms (9)
# and assemble (11) withheld.
NEITHER = -1 & ~(1 | 2 | 8 | 16 | 32 | 256 | 1024)  # -1340

# name: (open password, owner password, algorithm).
FILES = {
    "pypdf-r4-aes128-no-grant.pdf": ("", "owner-aes128-test", "AES-128"),
    "pypdf-r6-aes256-no-grant.pdf": ("", "owner-aes256-test", "AES-256"),
    "pypdf-r6-aes256-both-passwords.pdf": (
        "open-test",
        "owner-both-test",
        "AES-256",
    ),
    # Added 2026-11-17 (review): an EMPTY owner password. Anyone opens it
    # "as owner" with no password, and that is not a person proving it, so
    # it must stay restricted. Written alone with `--only`, so the files
    # above keep their bytes.
    "pypdf-r6-aes256-empty-owner.pdf": ("", "", "AES-256"),
}

NODE = r"""
const [mode, key, iv, data] = process.argv.slice(1).map((h, i) =>
  i === 0 ? h : Buffer.from(h, "hex"));
const bits = key.length * 8;
const name = mode.startsWith("ecb") ? `aes-${bits}-ecb` : `aes-${bits}-cbc`;
const pad = mode.endsWith("-pad");
const make = mode.includes("dec") ? "createDecipheriv" : "createCipheriv";
const c = require("node:crypto")[make](name, key, mode.startsWith("ecb") ? null : iv);
c.setAutoPadding(pad);
process.stdout.write(Buffer.concat([c.update(data), c.final()]).toString("hex"));
"""


def node_aes(mode: str, key: bytes, iv: bytes, data: bytes) -> bytes:
    out = subprocess.run(
        ["node", "-e", NODE, mode, key.hex(), iv.hex() or "00", data.hex() or ""],
        check=True,
        capture_output=True,
        text=True,
    )
    return bytes.fromhex(out.stdout)


class NodeCryptAES:
    """pypdf's CryptAES: a random IV, PKCS #7 padding, CBC, IV first."""

    def __init__(self, key: bytes) -> None:
        self.key = key

    def encrypt(self, data: bytes) -> bytes:
        iv = secrets.token_bytes(16)
        return iv + node_aes("cbc-enc-pad", self.key, iv, data)

    def decrypt(self, data: bytes, *, strict: bool = True) -> bytes:
        return node_aes("cbc-dec-pad", self.key, data[:16], data[16:])


def use_node_aes() -> None:
    try:
        import cryptography  # noqa: F401

        return
    except ImportError:
        pass
    _encryption.CryptAES = NodeCryptAES
    _encryption.aes_cbc_encrypt = lambda k, iv, d: node_aes("cbc-enc", k, iv, d)
    _encryption.aes_cbc_decrypt = lambda k, iv, d: node_aes("cbc-dec", k, iv, d)
    _encryption.aes_ecb_encrypt = lambda k, d: node_aes("ecb-enc", k, b"", d)
    _encryption.aes_ecb_decrypt = lambda k, d: node_aes("ecb-dec", k, b"", d)


def main(folder: Path, only: str | None = None):
    use_node_aes()
    base = folder / "grant-base.pdf"
    for name, (user, owner, algorithm) in FILES.items():
        if only is not None and name != only:
            continue
        writer = pypdf.PdfWriter(clone_from=str(base))
        writer.encrypt(
            user_password=user,
            owner_password=owner,
            permissions_flag=UAP(NEITHER & 0xFFFFFFFF),
            algorithm=algorithm,
        )
        with open(folder / name, "wb") as fh:
            writer.write(fh)


if __name__ == "__main__":
    main(
        Path(sys.argv[1]),
        sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--only" else None,
    )
