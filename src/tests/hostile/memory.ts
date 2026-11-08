// How much resident memory the work that follows adds at its peak, in MB.
//
// WHY NOT `maxRSS - before`. `process.resourceUsage().maxRSS` is the
// process's LIFETIME high-water mark, so it can only see work that climbs
// above everything the process did before it. On CI's Linux runners a child's
// startup already set that mark high: an honest one-page file "peaked" at
// 657 MB there (under 400 MB on Windows), and every positive control that
// expected a 64 MiB decode to show read exactly 0 (PR #297's first CI run).
// The same blindness let every upper bound pass vacuously.
//
// On Linux the kernel's own mark is reset first. Writing "5" to
// /proc/self/clear_refs sets VmHWM to the current VmRSS, so VmHWM afterwards
// is the work's peak alone. Elsewhere (Windows, macOS) nothing can reset the
// mark, and the old reading is kept. It worked there because startup stayed
// under the work, and `meter.method` says which one a reading came from.
import { readFileSync, writeFileSync } from "node:fs";

export interface MemoryMeter {
  /** Peak resident memory added since the meter started, MB. */
  growthMb(): number;
  readonly method: "linux-hwm" | "max-rss";
}

function procStatusKb(key: "VmHWM" | "VmRSS"): number {
  const status = readFileSync("/proc/self/status", "utf8");
  const match = new RegExp(`${key}:\\s*(\\d+)\\s*kB`).exec(status);
  if (!match) throw new Error(`no ${key} in /proc/self/status`);
  return Number(match[1]);
}

export function startMemoryMeter(): MemoryMeter {
  if (process.platform === "linux") {
    try {
      writeFileSync("/proc/self/clear_refs", "5");
      const baseKb = procStatusKb("VmRSS");
      return {
        method: "linux-hwm",
        growthMb: () => Math.max(0, procStatusKb("VmHWM") - baseKb) / 1024,
      };
    } catch {
      // Not permitted here: fall back to the lifetime mark below.
    }
  }
  const baseKb = process.resourceUsage().maxRSS;
  return {
    method: "max-rss",
    growthMb: () => (process.resourceUsage().maxRSS - baseKb) / 1024,
  };
}
