# Storage-artifact cleanup verifier — example inventories (Phase 42)

Content-free, offline example inventories for the **dry-run sweeper**
(`pnpm worker:artifact-cleanup`). Each is a synthetic projection of a bucket listing —
bounded lifecycle/manifest/provider/kind enums plus the decoded `{expiresAtMs, deleted}`
retention evidence and coarse `ageMs`/`sizeBytes` — and carries **no** object keys,
bucket names, signed URLs, filenames, or bytes. They are safe to commit, print, and paste
into a ticket.

Run one:

```sh
pnpm worker:artifact-cleanup --file=docs/examples/artifacts/cleanup/inventory-drift.json --json --plan
cat docs/examples/artifacts/cleanup/inventory-clean.json | pnpm worker:artifact-cleanup --stdin --text
```

The tool is **dry-run only**: it never lists a real bucket, never calls a cloud API, and
never deletes anything. Actual object deletion stays operator-owned and out-of-band. To
instead prove that should-be-gone objects are _actually absent_ (not merely
retrieval-denied), use the absence **verifier** lens, `pnpm worker:cleanup-check`.

## Fixtures and the verdict each pins

| File                     | Verdict   | Exit | Why                                                                                                                     |
| ------------------------ | --------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `inventory-clean.json`   | `ok`      | 0    | Every object is live with a valid manifest, a recognized kind, and a configured backend.                                |
| `inventory-unknown.json` | `unknown` | 2    | Objects with missing manifest, missing lifecycle evidence, or a not-configured backend — not enough evidence to decide. |
| `inventory-drift.json`   | `drift`   | 3    | An expired object is still present (a sweep candidate); cleanup recommended.                                            |
| `inventory-breach.json`  | `breach`  | 4    | A tombstoned object is still present (bytes that should be gone remain) — a policy breach.                              |

The `expiresAtMs` values are deliberately extreme (`1000` = always past, `99999999999999`
= always future) so a fixture's verdict does not depend on the wall clock. Pass
`--now=<epoch-ms|ISO>` to evaluate against a fixed instant.

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | No cleanup or drift found.                                    |
| 1    | Usage / input error (bad flags, or an unparseable inventory). |
| 2    | Unknown / not enough evidence.                                |
| 3    | Cleanup recommended / warning drift.                          |
| 4    | Invalid / breached policy.                                    |

`src/lib/workers/artifacts/cleanup/examples.test.ts` re-evaluates every fixture through the
real evaluator, so an example can never silently drift from the tool's behavior.
