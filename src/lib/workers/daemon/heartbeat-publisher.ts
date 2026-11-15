/**
 * The daemon's heartbeat publisher: the runtime facts it reads plus the
 * capabilities it PROVES (`./proved-capabilities`), composed into one
 * publisher. Lives here, not in `scripts/worker-daemon.ts`, so the one
 * decision that matters — a readiness probe never proves, and publishes only
 * proofs THIS container's daemon wrote — is a tested function and not a
 * branch in a CLI shell.
 */
import {
  createHeartbeatPublisher,
  type HeartbeatCapabilities,
  type HeartbeatMode,
  type HeartbeatPublisher,
  type HeartbeatRedisDeps,
} from "@/lib/workers/heartbeat";
import { emptyCapabilities } from "@/lib/workers/heartbeat/capabilities";
import type { DaemonMode } from "./args";
import {
  resolveProvedCapabilities,
  type ProvedKey,
  type Provers,
  type ProvedSource,
} from "./proved-capabilities";

type Env = Record<string, string | undefined>;

/** What the runtime reports without running work: everything a proof does not. */
export type RuntimeCapabilities = Omit<HeartbeatCapabilities, ProvedKey>;

export interface DaemonHeartbeatOptions {
  readonly mode: DaemonMode;
  readonly heartbeatMode: HeartbeatMode;
  readonly env: Env;
  readonly runtime: RuntimeCapabilities;
  readonly release?: string;
  /** The image's build fingerprint; without one nothing can be cached. */
  readonly fingerprint?: string;
  /** {@link containerRunStamp}'s answer for this process. */
  readonly run: string | null;
  /** Cache directory; defaults to `os.tmpdir()` (container-local). */
  readonly dir?: string;
  readonly provers?: Provers;
  readonly deps?: HeartbeatRedisDeps;
}

export interface DaemonHeartbeat {
  readonly publisher: HeartbeatPublisher;
  readonly proofs: {
    readonly source: ProvedSource;
    readonly cacheWritten?: boolean;
  };
}

export async function buildDaemonHeartbeat(
  opts: DaemonHeartbeatOptions,
): Promise<DaemonHeartbeat> {
  const resolved = await resolveProvedCapabilities({
    mode: opts.mode,
    env: opts.env,
    key:
      opts.fingerprint !== undefined
        ? { fingerprint: opts.fingerprint, run: opts.run }
        : null,
    ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    ...(opts.provers !== undefined ? { provers: opts.provers } : {}),
  });
  const proofs = {
    source: resolved.source,
    ...(resolved.cacheWritten !== undefined
      ? { cacheWritten: resolved.cacheWritten }
      : {}),
  };
  const spec = {
    mode: opts.heartbeatMode,
    ...(opts.release !== undefined ? { release: opts.release } : {}),
    ...(opts.fingerprint !== undefined
      ? { fingerprint: opts.fingerprint }
      : {}),
    ...(opts.deps !== undefined ? { deps: opts.deps } : {}),
  };
  if (resolved.capabilities === null) {
    // Cold readiness probe: no proof from this image in this container yet.
    // A beat now would overwrite the daemon's record (one key per role) with
    // values nobody proved, so nothing is published — the daemon's beat stands.
    const inner = createHeartbeatPublisher(opts.env, {
      ...spec,
      capabilities: emptyCapabilities(),
    });
    return {
      proofs,
      publisher: {
        capability: inner.capability,
        async beat() {
          return inner.capability.enabled
            ? { published: false, reason: "unproven" }
            : { published: false, reason: "disabled" };
        },
      },
    };
  }
  const capabilities: HeartbeatCapabilities = {
    ...opts.runtime,
    ...resolved.capabilities,
  };
  return {
    proofs,
    publisher: createHeartbeatPublisher(opts.env, { ...spec, capabilities }),
  };
}
