import { releaseArchiveMetric } from "../observability/metrics";
import { NOOP_METRIC_SINK, type WorkerMetricSink } from "../observability/collector";
import type { ReleaseArchivePosture } from "./types";

let sink: WorkerMetricSink = NOOP_METRIC_SINK;

export function setReleaseArchiveSink(next: WorkerMetricSink): void {
  sink = next;
}

export function resetReleaseArchiveSink(): void {
  sink = NOOP_METRIC_SINK;
}

export function recordReleaseArchive(posture: ReleaseArchivePosture): void {
  sink(releaseArchiveMetric(posture));
}
