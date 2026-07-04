import { releaseRestoreDrillMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseRestoreDrillVerdict } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

export function setReleaseRestoreDrillSink(next: WorkerMetricSink): void {
  sink = next;
}

export function resetReleaseRestoreDrillSink(): void {
  sink = NOOP_METRIC_SINK;
}

export function recordReleaseRestoreDrill(verdict: ReleaseRestoreDrillVerdict): void {
  sink(releaseRestoreDrillMetric(verdict));
}
