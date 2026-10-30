"""Algorithm 2.B (ISO 32000-2, revision 6) vectors from pypdf — an
implementation that is not ours — for `src/lib/pdf/security/primitives.test.ts`.

The vectors are chosen to include inputs where the loop's stopping round
matters: the last byte of E equals the (1-based) round count minus 32 at the
first round it may stop. An implementation that compares against a 0-based
round number gets exactly those wrong (it did, until 2026-10-30 — one R6 file
in a few dozen opened with a wrong key).

    python -I make-hash-2b-vectors.py <out.json>
"""

import hashlib
import json
import os
import sys

from pypdf._encryption import AlgV5


def stops_at_boundary(password: bytes, salt: bytes, udata: bytes) -> bool:
    """Does pypdf's loop stop on a round where `e[-1] == count - 32`?"""
    from pypdf._crypt_providers import aes_cbc_encrypt

    k = hashlib.sha256(password + salt + udata).digest()
    count = 0
    while True:
        count += 1
        e = aes_cbc_encrypt(k[:16], k[16:32], (password + k + udata) * 64)
        k = (hashlib.sha256, hashlib.sha384, hashlib.sha512)[sum(e[:16]) % 3](
            e
        ).digest()
        if count >= 64 and e[-1] <= count - 32:
            return e[-1] == count - 32


def main(out: str) -> None:
    rng = __import__("random").Random(20261030)
    boundary, plain = [], []
    while len(boundary) < 12 or len(plain) < 12:
        password = bytes(rng.randrange(256) for _ in range(rng.randrange(0, 20)))
        salt = bytes(rng.randrange(256) for _ in range(8))
        udata = bytes(rng.randrange(256) for _ in range(48)) if rng.random() < 0.5 else b""
        edge = stops_at_boundary(password, salt, udata)
        bucket = boundary if edge else plain
        if len(bucket) >= 12:
            continue
        bucket.append(
            {
                "password": password.hex(),
                "salt": salt.hex(),
                "udata": udata.hex(),
                "hash": AlgV5.calculate_hash(6, password, salt, udata).hex(),
                "boundary": edge,
            }
        )
    with open(out, "w") as fh:
        json.dump(boundary + plain, fh, indent=1)
        fh.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
