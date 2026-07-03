# Release evidence artifact — example inputs (Phase 47)

Example **content-free tool results** for the release evidence artifact
(`pnpm worker:release-artifact`). Each is a real, bounded output an operator's own commands already
produce — never a raw provider export, secret, bucket, or byte:

- `release-gate-*.json` — a `pdfxyz.worker-release-gate/1` result from `pnpm worker:release-gate
  --json` (the composite PASS/WARN/FAIL promotion verdict + per-check statuses, all bounded enums).
  `release-gate-pass.json` is a real, unedited full-gate run (11/11 checks pass); the `-warn`,
  `-fail`, and `-unknown` variants were derived from it by flipping one check + the rollup, to
  exercise every artifact verdict.
- `ops-bundle-*.json` — a `pdfxyz.ops-bundle/1` summary from `pnpm worker:ops-bundle --json`,
  attached as OPTIONAL incident-handoff context. `ops-bundle-ok.json` / `ops-bundle-critical.json`
  were generated from the committed `docs/examples/ops-bundle/ops-check-*.json` snapshots.

> Every value in these fixtures — and in the artifact the tool renders from them — is a bounded
> enum, boolean, small count, an ISO stamp, app-authored prose, an optional validated release label,
> a validated short git commit hash, or the integrity digest. There is no locator, object key,
> bucket, URL, endpoint, region, id, filename, size, or byte. The artifact re-authors every
> load-bearing field from the app's own maps (no-leak by reconstruction), so even a poisoned input
> string is dropped. `src/lib/workers/release-artifact/examples.test.ts` runs every case through the
> real runner and asserts the documented verdict, that the digest is valid + deterministic, and that
> no locator token survives; the hostile no-leak proof lives in
> `src/lib/workers/release-artifact/privacy.test.ts`.

The artifact is evidence **AGGREGATION + INTEGRITY** over content-free data. It is **not** a
cryptographic signature, **not** proof of byte deletion, **not** malware scanning, **not**
authentication / authorization, and does **not** validate cloud state or perform the promotion: it
makes **no** cloud call, reads **no** provider export/secret/bucket, and deletes **nothing**.

Build one — archive a captured gate result, optionally attach an ops-bundle summary, then verify:

```sh
# Pre-run the gate, then archive its result with git provenance + an integrity digest
pnpm worker:release-gate --json > gate.json
pnpm worker:release-artifact --release-gate=gate.json --label=v1.2.3 --output=release.json --json

# Or run the gate internally and print an operator-friendly summary
pnpm worker:release-artifact --text

# Confirm the archived artifact was not altered (recomputes the digest over the canonical body)
pnpm worker:release-artifact --verify=release.json
```

## Fixtures and the artifact verdict each pins

| Gate input | + ops-bundle | Tree | Artifact | Exit | Why |
| --- | --- | --- | --- | --- | --- |
| `release-gate-pass.json` | — | clean | `pass` | 0 | The gate passed and provenance is clean. |
| `release-gate-pass.json` | — | dirty | `warn` | 3 | A dirty tree escalates a clean pass (the commit does not fully describe the built bytes). |
| `release-gate-pass.json` | `ops-bundle-ok.json` | clean | `pass` | 0 | The ops-bundle is context only; it does not change the verdict. |
| `release-gate-pass.json` | `ops-bundle-critical.json` | clean | `pass` | 0 | Even a critical ops-bundle is runtime context; it does not gate this build. |
| `release-gate-warn.json` | — | clean | `warn` | 3 | An advisory gate check flagged a concern. |
| `release-gate-fail.json` | — | clean | `fail` | 4 | A blocking gate check failed. |
| `release-gate-unknown.json` | — | clean | `unknown` | 2 | A gate check could not be run to a verdict; the artifact cannot certify readiness. |

The archived gate verdict is PRIMARY. The only signal the artifact adds is this build's working-tree
cleanliness: a dirty tree escalates a clean `pass` to `warn`, and never downgrades a `fail`/`unknown`
(a missing gate result is a more honest signal than "ready with a caveat"). An attached ops-bundle
reflects a runtime's live ops posture and is archived for context only. All fixtures pin
`generatedAt` to a fixed instant for determinism; the tool re-stamps its own `generatedAt` and
recomputes the digest.

## Integrity digest

The artifact carries `integrity.digest`: a `sha256` of the **canonical** body (recursively
key-sorted, minimally-separated JSON — the `pdfxyz-sorted-keys/1` scheme). It is a tamper-evidence
anchor, **not** a signature (no key, no identity). Recompute + confirm it offline with
`pnpm worker:release-artifact --verify=<file>`; a mismatch means the archived body was altered.

## Exit codes

| Code | Verdict | Meaning |
| --- | --- | --- |
| 0 | `pass` | A promote-able evidence artifact was written (or `--verify` confirmed the digest). |
| 1 | `usage` | The CLI was misused (a bad flag, an invalid label, an unreadable `--verify` target). |
| 2 | `unknown` | The gate result was indeterminate/absent; readiness cannot be certified. |
| 3 | `warn` | An advisory signal (the gate warned, or the working tree is dirty). |
| 4 | `fail` | A blocking gate check failed, or `--verify` found a digest mismatch. |
