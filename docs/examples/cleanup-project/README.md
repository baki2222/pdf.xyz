# Cleanup evidence exporter — example raw exports (Phase 43)

Example **raw provider exports** for the offline projector (`pnpm worker:cleanup-project`).
Each is a synthetic capture of what an operator's own `aws s3api list-objects-v2` /
`head-object` output (or a normalized dump) might look like — deliberately stuffed with
`EXAMPLE-…` placeholder locator/identifier fields (`Key`, `ETag`, `Owner`, `signedUrl`,
`endpoint`, request ids, storage class) so you can watch the projector **drop every one of
them**. The projector reads ONLY a bounded allowlist of fields and emits a content-free
document the Phase 42 cleanup tools accept.

> The `EXAMPLE-…` values are obviously-synthetic placeholders, never real keys, buckets,
> URLs, or bytes. The projector never reads their values — it only tallies that a
> locator/identity/integrity/url field was dropped — so the **projected output** carries
> none of them. `src/lib/workers/cleanup/project/examples.test.ts` re-projects every fixture
> through the real transform and asserts both the documented verdict and that no `EXAMPLE-`
> substring survives.

This tool is a **redaction / normalization helper**. It is **not** proof of deletion, **not**
malware scanning, **not** a cloud scanner, and makes **no** authentication / authorization /
provenance claim: it only reshapes an export you already produced into a content-free shape.
It makes **no** cloud call and deletes **nothing**.

Project one, then pipe it straight into a Phase 42 tool (the projected document keys its record
array exactly as the downstream parser reads it, and the embedded `receipt` is ignored there):

```sh
# Raw head-object/list capture → artifact-cleanup INVENTORY → dry-run sweeper
pnpm worker:cleanup-project --target=inventory --file=docs/examples/cleanup-project/raw-inventory-projected.json \
  | pnpm worker:artifact-cleanup --stdin --text

# Raw probe capture → cleanup-check EVIDENCE → absence verifier
pnpm worker:cleanup-project --target=evidence --file=docs/examples/cleanup-project/raw-evidence-projected.json \
  | pnpm worker:cleanup-check --stdin
```

## Fixtures and the verdict each pins

| File | `--target` | Verdict | Exit | Why |
| --- | --- | --- | --- | --- |
| `raw-inventory-projected.json` | `inventory` | `projected` | 0 | A present object with a valid manifest + recognized kind → usable, nothing unsafe. |
| `raw-evidence-projected.json` | `evidence` | `projected` | 0 | A present-with-expiry probe, a `NoSuchKey` absence, and a `503` error — all usable observations. |
| `raw-unsafe-tombstoned.json` | `inventory` | `unsafe` | 4 | A present object carrying a deletion tombstone: bytes that should be gone remain. |
| `raw-insufficient-listing.json` | `inventory` | `insufficient` | 2 | A bare listing entry with no lifecycle / manifest / kind — not enough usable metadata. |

The `expiresAtMs` values are deliberately extreme (`1000` = always past,
`99999999999999` = always future) so a fixture's verdict does not depend on the wall clock.
Pass `--now=<epoch-ms|ISO>` to bucket absolute `LastModified` ages against a fixed instant.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Projected successfully (usable records, no unsafe condition). |
| 1 | Usage / input error (bad flags, or an unreadable / oversized / malformed export). |
| 2 | Not enough usable metadata to project (a metadata-thin export). |
| 4 | Unsafe export (a present-but-tombstoned object, or a structurally invalid record). |
