# Release evidence restore drill — example inputs

Content-free fixtures for `pnpm worker:release-restore-drill` (Phase 56). The drill proves an **archived**
release-evidence pack can be **restored and trusted** before an operator relies on it. It is offline and
read-only: it fetches nothing — the operator restores the files out of band and hands them here.

## What the drill does

It ingests a `pdfxyz.release-archive/1` pack (the PRIMARY anchor, `--archive`) that was restored from cold
storage, **re-validates the pack against itself** (re-deriving its Phase-55 rollup from its own records, so a
hand-flipped posture is caught as a tamper), and — for each underlying record the operator also restored
(`--governance` / `--trend` / `--report` / `--audit` / `--bundle`) — **re-validates it** and **cross-checks its
posture against what the pack recorded**. A restored record whose posture no longer matches the archive record is
a restore-integrity failure; one that no longer re-derives is corrupt.

It answers one question: **"Can this archived release evidence be restored and trusted?"** — and fails closed when
it cannot.

## Files

| File | What it is |
| --- | --- |
| `archive-archivable.json` | A clean `pdfxyz.release-archive/1` pack over the healthy record set below. |
| `archive-watch.json` | A pack whose own posture is `archive-watch` (advisory). |
| `archive-blocked.json` | A pack whose own posture is `archive-blocked` (blocking). |
| `archive-incomplete.json` | A pack whose own posture is `archive-incomplete` (insufficient). |
| `archive-tampered.json` | The archivable pack with its recorded posture hand-flipped (does not re-derive). |
| `governance-healthy.json`, `trend-stable.json`, `report-promote-ready.json`, `audit-pass.json`, `bundle-pass.json` | The underlying records the archivable pack indexed — the RESTORED inputs to match against it. |
| `trend-warning.json` | A different (warning) trend — restoring it where a stable one was archived is a mismatch. |
| `not-a-document.json` | An unrecognized input (an unreadable anchor). |

## Commands

```bash
# A full restore drill — verify the pack AND every underlying record restored intact and matches (exit 0).
pnpm worker:release-restore-drill \
  --archive=docs/examples/release-restore-drill/archive-archivable.json \
  --governance=docs/examples/release-restore-drill/governance-healthy.json \
  --trend=docs/examples/release-restore-drill/trend-stable.json \
  --report=docs/examples/release-restore-drill/report-promote-ready.json \
  --audit=docs/examples/release-restore-drill/audit-pass.json \
  --bundle=docs/examples/release-restore-drill/bundle-pass.json --text

# Re-validate ONLY the pack's own integrity (a manifest self-check), no restore exercised (exit 0):
pnpm worker:release-restore-drill --archive=docs/examples/release-restore-drill/archive-archivable.json --archive-only

# A restored record that does NOT match the archive record → RESTORE-FAILED (exit 4):
pnpm worker:release-restore-drill \
  --archive=docs/examples/release-restore-drill/archive-archivable.json \
  --trend=docs/examples/release-restore-drill/trend-warning.json
```

## Exit codes

| Exit | Verdict | Meaning |
| --- | --- | --- |
| `0` | `restore-verified` | The pack re-derives + is archivable, every restored record matched, a restore was exercised (or `--archive-only`). |
| `1` | usage | The CLI was misused (no `--archive`, a bad flag, two stdin inputs). |
| `2` | `restore-incomplete` | An unreadable/incomplete pack, an unreadable restored record, a required record not restored, or nothing restored. |
| `3` | `restore-drift` | An advisory posture (a watch pack, or an out-of-band restored record). |
| `4` | `restore-failed` | A tampered pack, a blocked archive, a restore mismatch, or a corrupt restore. |

## Honesty

Every field is a bounded enum, a small integer, an ISO stamp, an opaque sha256 hex digest (over safe canonical
content-free data), or app-authored prose — **never** a filename, path, object key, bucket, URL, endpoint, size,
byte, or record content, even from a hostile input. The drill fetches nothing, runs nothing, and mutates nothing;
`restore-verified` authorizes nothing — it only reports that the restored evidence was self-consistent and coherent
with the archive record. Integrity is proven by the semantic re-derivation + cross-check, not by a signature (there
is no signing key), and the recorded digests are fingerprints for cross-drill comparison, not attestations.
