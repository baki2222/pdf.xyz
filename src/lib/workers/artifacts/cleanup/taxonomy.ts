/**
 * The bounded **taxonomy** for the storage-artifact cleanup verifier (Phase 42): the
 * closed set of stale/orphan/drift CATEGORIES a present object can fall into, the
 * SEVERITY ladder they roll up to, and the reconciling PLAN ACTION each implies.
 *
 * This is a deliberately dependency-free leaf (pure `const` tuples + maps, no imports),
 * for the same reason the metric-name schema is a leaf: it is the single source of truth
 * shared by the evaluator (`./evaluate`), the receipt (`./receipt`), the text renderer
 * (`./render`), the CLI, and the observability metric schema (`../../observability/metrics`,
 * which value-imports {@link CLEANUP_CATEGORIES}/{@link CLEANUP_SEVERITIES} as its label
 * vocabulary). Keeping it import-free means the metric schema can reference this vocabulary
 * without forming an import cycle.
 *
 * Every value here is a content-free, low-cardinality token — never a filename, object key,
 * bucket name, signed URL, size, or document byte — and every token is redaction-stable
 * (it survives the shared telemetry redactor unchanged), so a category/severity can be a
 * metric label without being mangled or dropped.
 *
 * Honesty posture (load-bearing): a category escalates a record's severity ONLY on
 * POSITIVE evidence. An explicit deletion tombstone or a passed retention deadline on a
 * still-present object is a breach/drift; ABSENT or incomplete evidence (no lifecycle
 * fact, no manifest, an unrecognized kind, a not-configured backend) is only ever
 * `unknown` ("not enough evidence"), never a fabricated cleanup recommendation. The
 * verifier therefore never claims an object should be deleted without evidence that it
 * is expired or tombstoned.
 */

/**
 * The bounded stale/orphan/drift categories a present storage object resolves to. Each
 * record resolves to exactly ONE, by the evaluator's deterministic precedence:
 *  - `ok`                   — live, with complete, consistent, healthy metadata (retain);
 *  - `expired-but-present`  — a recorded retention window has passed yet the object is
 *                             still present (a sweep candidate — the app considers it
 *                             no longer downloadable, but the bucket has not reaped it);
 *  - `deleted-but-present`  — an explicit deletion tombstone is recorded yet the object
 *                             is still present (a lifecycle BREACH — bytes that should be
 *                             gone remain);
 *  - `missing-lifecycle`    — no usable lifecycle evidence (a legacy object, or
 *                             metadata-stripping storage): cannot tell if it is expired;
 *  - `missing-manifest`     — no valid provenance manifest recorded (missing/invalid);
 *  - `unsupported-kind`     — the recorded output kind is not one the app produces/serves;
 *  - `storage-unavailable`  — the backing store is not configured, so nothing can be
 *                             evaluated or acted on here;
 *  - `invalid-record`       — the inventory entry was structurally invalid (not an object),
 *                             so it cannot be trusted (a data-quality breach of the input).
 */
export const CLEANUP_CATEGORIES = [
  "ok",
  "expired-but-present",
  "deleted-but-present",
  "missing-lifecycle",
  "missing-manifest",
  "unsupported-kind",
  "storage-unavailable",
  "invalid-record",
] as const;
export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

/**
 * The bounded severity ladder, monotonic with the CLI exit code:
 *  - `ok`      — nothing to clean, complete healthy evidence (exit 0);
 *  - `unknown` — not enough evidence to decide (exit 2);
 *  - `drift`   — cleanup recommended: a present object the app no longer serves (exit 3);
 *  - `breach`  — invalid input or a tombstoned-but-present object (exit 4).
 * The report's overall verdict is the worst severity present across all records.
 */
export const CLEANUP_SEVERITIES = ["ok", "unknown", "drift", "breach"] as const;
export type CleanupSeverity = (typeof CLEANUP_SEVERITIES)[number];

/**
 * The report's overall verdict — the worst {@link CleanupSeverity} across every record
 * (or `ok` for an empty inventory: nothing present ⇒ nothing to clean). Deliberately the
 * same closed vocabulary as the severity ladder; `unknown`/`drift` intentionally match
 * the bucket lifecycle verifier's verdict words so the two surfaces read consistently.
 */
export type CleanupVerdict = CleanupSeverity;

/**
 * The reconciling action a category implies for an operator. Content-free guidance only;
 * this tool NEVER deletes — see the CLI's dry-run posture and docs/RUNBOOK.md:
 *  - `retain`      — keep it; it is live and healthy;
 *  - `investigate` — gather more evidence before acting (missing lifecycle / no backend / bad record);
 *  - `review`      — a human should confirm it is an orphan before removing it;
 *  - `delete`      — positive evidence it should be gone (expired or tombstoned); the
 *                    operator removes it out-of-band with their own credentials.
 */
export const CLEANUP_PLAN_ACTIONS = [
  "retain",
  "investigate",
  "review",
  "delete",
] as const;
export type CleanupPlanAction = (typeof CLEANUP_PLAN_ACTIONS)[number];

/** The severity each category rolls up to. */
export const CLEANUP_SEVERITY_BY_CATEGORY: Readonly<
  Record<CleanupCategory, CleanupSeverity>
> = {
  ok: "ok",
  "expired-but-present": "drift",
  "deleted-but-present": "breach",
  "missing-lifecycle": "unknown",
  "missing-manifest": "unknown",
  "unsupported-kind": "unknown",
  "storage-unavailable": "unknown",
  "invalid-record": "breach",
};

/** The reconciling plan action each category implies. */
export const CLEANUP_ACTION_BY_CATEGORY: Readonly<
  Record<CleanupCategory, CleanupPlanAction>
> = {
  ok: "retain",
  "expired-but-present": "delete",
  "deleted-but-present": "delete",
  "missing-lifecycle": "investigate",
  "missing-manifest": "review",
  "unsupported-kind": "review",
  "storage-unavailable": "investigate",
  "invalid-record": "investigate",
};

/** Ascending rank for a severity, so "worst" is a simple max. */
export const CLEANUP_SEVERITY_RANK: Readonly<Record<CleanupSeverity, number>> = {
  ok: 0,
  unknown: 1,
  drift: 2,
  breach: 3,
};

/** Return the worse (higher-rank) of two severities. */
export function worseSeverity(
  a: CleanupSeverity,
  b: CleanupSeverity,
): CleanupSeverity {
  return CLEANUP_SEVERITY_RANK[a] >= CLEANUP_SEVERITY_RANK[b] ? a : b;
}
