import {
  RELEASE_RESTORE_DRILL_EXIT,
  RELEASE_RESTORE_DRILL_REASON_DETAIL,
  RELEASE_RESTORE_DRILL_REASON_IDS,
  RELEASE_RESTORE_DRILL_STRICT_DRIFT_ESCALATED_SUMMARY,
  RELEASE_RESTORE_DRILL_VERDICT_SUMMARY,
  type ReleaseRestoreDrillArchive,
  type ReleaseRestoreDrillPolicy,
  type ReleaseRestoreDrillReason,
  type ReleaseRestoreDrillReasonId,
  type ReleaseRestoreDrillRecord,
  type ReleaseRestoreDrillRollup,
  type ReleaseRestoreDrillSeverity,
} from "./types";

function reasonIds(
  archive: ReleaseRestoreDrillArchive,
  records: readonly ReleaseRestoreDrillRecord[],
  policy: ReleaseRestoreDrillPolicy,
): ReleaseRestoreDrillReasonId[] {
  const ids = new Set<ReleaseRestoreDrillReasonId>();

  // Archive anchor (PRIMARY).
  if (!archive.recognized || archive.state === "unreadable" || archive.state === "absent") {
    ids.add("archive-unreadable");
  } else if (archive.state === "tampered") {
    ids.add("archive-tampered");
  } else {
    // usable — the pack's own posture governs.
    if (archive.posture === "archive-blocked") ids.add("archive-blocked");
    else if (archive.posture === "archive-incomplete") ids.add("archive-incomplete");
    else if (archive.posture === "archive-watch") ids.add("archive-watch");
  }

  // Per-record restore checks (generic over the record set; the class is carried by each record's restoreState).
  let anyNotRestored = false;
  let exercised = false;
  for (const r of records) {
    if (r.supplied) exercised = true;
    switch (r.restoreState) {
      case "restored-mismatch":
        ids.add("restore-mismatch");
        break;
      case "restored-tampered":
        ids.add("restore-corrupt");
        break;
      case "restored-unreadable":
        ids.add("restore-unreadable");
        break;
      case "restored-unexpected":
        ids.add("restore-unexpected");
        break;
      case "not-restored":
        anyNotRestored = true;
        break;
      default:
        break;
    }
  }
  if (policy.requireFullRestore && anyNotRestored) ids.add("restore-coverage-incomplete");

  // A usable pack with nothing restored proved no restorability (unless scoped to the manifest).
  if (archive.usable && !exercised && !policy.archiveOnly) ids.add("restore-not-exercised");

  return RELEASE_RESTORE_DRILL_REASON_IDS.filter((id) => ids.has(id));
}

export function buildRestoreReasons(ids: readonly ReleaseRestoreDrillReasonId[]): ReleaseRestoreDrillReason[] {
  return ids.map((id) => ({ id, ...RELEASE_RESTORE_DRILL_REASON_DETAIL[id] }));
}

export function computeRestoreRollup(
  archive: ReleaseRestoreDrillArchive,
  records: readonly ReleaseRestoreDrillRecord[],
  policy: ReleaseRestoreDrillPolicy,
): { rollup: ReleaseRestoreDrillRollup; reasons: ReleaseRestoreDrillReason[] } {
  const ids = reasonIds(archive, records, policy);
  const reasons = buildRestoreReasons(ids);
  const count = (s: ReleaseRestoreDrillSeverity) => reasons.filter((r) => r.severity === s).length;
  const blocking = count("blocking");
  const insufficiencies = count("insufficient");
  const advisories = count("advisory");
  const wouldDrift = blocking === 0 && insufficiencies === 0 && advisories > 0;
  const strictDriftEscalated = policy.strictDrift && wouldDrift;
  const verdict =
    blocking > 0 || strictDriftEscalated
      ? "restore-failed"
      : insufficiencies > 0
        ? "restore-incomplete"
        : advisories > 0
          ? "restore-drift"
          : "restore-verified";
  const exitCode =
    verdict === "restore-verified"
      ? RELEASE_RESTORE_DRILL_EXIT.VERIFIED
      : verdict === "restore-drift"
        ? RELEASE_RESTORE_DRILL_EXIT.DRIFT
        : verdict === "restore-incomplete"
          ? RELEASE_RESTORE_DRILL_EXIT.INCOMPLETE
          : RELEASE_RESTORE_DRILL_EXIT.FAILED;
  return {
    reasons,
    rollup: {
      verdict,
      exitCode,
      verified: verdict === "restore-verified",
      reasons: ids,
      blocking,
      insufficiencies,
      advisories,
      archiveOnly: policy.archiveOnly,
      requireFullRestore: policy.requireFullRestore,
      strictDrift: policy.strictDrift,
      strictDriftEscalated,
      detail: strictDriftEscalated
        ? RELEASE_RESTORE_DRILL_STRICT_DRIFT_ESCALATED_SUMMARY
        : RELEASE_RESTORE_DRILL_VERDICT_SUMMARY[verdict],
    },
  };
}
