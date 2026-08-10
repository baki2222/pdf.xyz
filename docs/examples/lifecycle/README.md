# Lifecycle verification examples

These are **example observed lifecycle documents** for the daemon's
`--lifecycle-verify` mode. They are static, content-free fixtures — every file
contains only rule ids, structural prefixes (`inputs/`, `artifacts/`, `logs/`),
`Status`, and integer day counts. **None contains a bucket name, endpoint, region,
credential, object key, or any secret**, so they are safe to commit and print.

## What `--lifecycle-verify` does

The daemon can already **generate** a content-free retention/lifecycle policy
(`--lifecycle-policy`). The operator **applies** it to their bucket out-of-band with
the provider CLI — the app never calls the cloud. `--lifecycle-verify` closes the
loop with **evidence**: it compares the policy the app _would_ generate against a
lifecycle configuration you export from the bucket yourself, and reports whether the
backstop is actually enforced.

The app still never reads the bucket. You do the privileged read out-of-band and hand
the daemon the resulting document, which is itself content-free:

```sh
# 1. Export the live bucket's lifecycle config (uses YOUR credentials, out-of-band).
aws s3api get-bucket-lifecycle-configuration --bucket <your-bucket> > observed.json

# 2. Verify it against the policy the app would generate. No cloud call here.
pnpm worker:daemon --lifecycle-verify --provider=aws-s3 --versioned --observed=observed.json
```

Exit codes:

| Exit | Verdict           | Meaning                                                              |
| ---- | ----------------- | -------------------------------------------------------------------- |
| `0`  | `verified`        | Every generated backstop is enforced at least as strongly.           |
| `2`  | `unknown`         | No `--observed` document supplied — nothing to verify.               |
| `4`  | `drift` / invalid | A backstop is missing/weaker/disabled, or the document is malformed. |

Matching is **structural, not by id**: an observed rule governs a generated rule when
it targets a prefix that _covers_ the generated rule's prefix (a whole-bucket rule
covers `inputs/`) and carries the field for that role. So you may name your bucket
rules anything and still verify clean — see `observed-verified.aws-s3.json`, whose
rule ids differ from the generated `pdfxyz-*` ids.

## Files

| File                                 | Verdict against the versioned default policy                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `observed-verified.aws-s3.json`      | `verified` — all five backstops enforced; one unrelated `logs/` rule is reported as unmatched (informational). |
| `observed-drift-weaker.aws-s3.json`  | `drift` — inputs expire after 30 days, so an input can outlive the 1-day privacy ceiling (`weaker`).           |
| `observed-drift-missing.aws-s3.json` | `drift` — the artifact-expiration rule is absent, so nothing expires produced artifacts (`missing`).           |

`src/lib/workers/lifecycle/examples.test.ts` pins each file's verdict and asserts it
stays content-free, so an example can never silently drift from the verifier.
