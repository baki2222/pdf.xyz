/**
 * Presence-only **lifecycle readiness** — the honest seam for a fact the app can
 * *never* verify from inside the process: whether a bucket actually has the
 * generated lifecycle rules applied.
 *
 * Confirming a live bucket's lifecycle configuration would require a cloud API
 * call, which this build deliberately never makes. So lifecycle readiness is
 * **operator-declared**: the operator generates a policy (`./render.ts`), applies it
 * to their bucket out-of-band, and then *asserts* that state via environment flags.
 * This module reads those flags — presence and shape only — and reports one of a few
 * honest states, never claiming rules are in force just because a flag is set.
 *
 * Node-free: plain env parsing, so the readiness composes into both the operator
 * dry-run output and any client-safe status without pulling a Node built-in. It
 * names no bucket, endpoint, credential, or value.
 */

import type { FieldError } from "@/lib/jobs";
import {
  isLifecycleProvider,
  LIFECYCLE_PROVIDERS,
  type LifecycleProvider,
} from "./render";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this module reads (names only; never values). */
export const LIFECYCLE_ENV = {
  /** Which provider the operator targets (also selects the render format). */
  provider: "PDFXYZ_LIFECYCLE_PROVIDER",
  /** Operator assertion that the generated policy is applied AND verified live. */
  validated: "PDFXYZ_LIFECYCLE_VALIDATED",
  /** Operator assertion that the bucket has versioning enabled. */
  versioned: "PDFXYZ_LIFECYCLE_VERSIONED",
} as const;

/**
 * The honest lifecycle state:
 * - `validated`: provider declared AND the operator asserts rules are applied and
 *   verified. The strongest claim the app can honestly relay (it trusts the
 *   operator's out-of-band verification; it never checks the bucket itself).
 * - `declared`: a provider is declared, but the operator has not asserted the
 *   policy is verified — so rules may or may not actually be in force.
 * - `unknown`: nothing is declared. The app cannot tell whether a lifecycle policy
 *   exists; it makes no claim either way.
 * - `invalid`: a declared value is malformed (unknown provider, bad boolean).
 */
export type LifecycleReadinessState =
  "validated" | "declared" | "unknown" | "invalid";

/** Presence-only lifecycle readiness. Names no bucket, endpoint, or value. */
export interface LifecycleReadiness {
  readonly state: LifecycleReadinessState;
  /** The declared target provider, or null when none/invalid. NAME only. */
  readonly provider: LifecycleProvider | null;
  /** Whether the operator declared the bucket versioned; null when undeclared. */
  readonly versioned: boolean | null;
  /** One-line, content-free explanation. Never names a variable or value. */
  readonly detail: string;
}

/** A validated lifecycle declaration. */
export interface LifecycleConfig {
  readonly provider: LifecycleProvider;
  readonly validated: boolean;
  readonly versioned: boolean;
}

/** Outcome of parsing the lifecycle declaration from the environment. */
export type ParseLifecycleConfigResult =
  | { ok: true; config: LifecycleConfig }
  | {
      ok: false;
      /** Whether a provider was declared at all. */
      selected: boolean;
      /** Malformed variables, by NAME only. */
      issues: FieldError[];
    };

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** Parse a boolean flag; unset ⇒ fallback, unrecognized ⇒ error. */
function parseBool(
  raw: string | undefined,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  const v = raw.toLowerCase();
  if (TRUE_VALUES.has(v)) return { ok: true, value: true };
  if (FALSE_VALUES.has(v)) return { ok: true, value: false };
  return { ok: false };
}

/**
 * Parse the lifecycle declaration. Presence and shape only. When no provider is
 * declared it reports `selected: false` with no issues (the honest "unknown"
 * fallback); when a provider is declared but any value is malformed it reports the
 * offending variable names (never values). `env` is injectable for tests.
 */
export function parseLifecycleConfig(
  env: EnvSource = process.env,
): ParseLifecycleConfigResult {
  const providerRaw = read(env, LIFECYCLE_ENV.provider);
  if (providerRaw === undefined) {
    return { ok: false, selected: false, issues: [] };
  }

  const issues: FieldError[] = [];
  const provider = providerRaw.toLowerCase();
  const providerOk = isLifecycleProvider(provider);
  if (!providerOk) {
    issues.push({
      field: LIFECYCLE_ENV.provider,
      message: `Must be one of: ${LIFECYCLE_PROVIDERS.join(", ")}.`,
    });
  }

  const validated = parseBool(read(env, LIFECYCLE_ENV.validated), false);
  if (!validated.ok) {
    issues.push({
      field: LIFECYCLE_ENV.validated,
      message: "Must be true or false.",
    });
  }

  const versioned = parseBool(read(env, LIFECYCLE_ENV.versioned), false);
  if (!versioned.ok) {
    issues.push({
      field: LIFECYCLE_ENV.versioned,
      message: "Must be true or false.",
    });
  }

  if (!providerOk || !validated.ok || !versioned.ok || issues.length > 0) {
    return { ok: false, selected: true, issues };
  }

  return {
    ok: true,
    config: {
      provider: provider as LifecycleProvider,
      validated: validated.value,
      versioned: versioned.value,
    },
  };
}

const DETAIL: Record<LifecycleReadinessState, string> = {
  validated:
    "A lifecycle/retention policy is declared and the operator asserts it is applied and verified on the bucket. The app trusts this out-of-band assertion; it never inspects the bucket itself.",
  declared:
    "A lifecycle/retention policy provider is declared, but it is not asserted as verified — the rules may not actually be applied on the bucket yet. Generate, apply, and then mark it validated.",
  unknown:
    "No lifecycle/retention policy is declared, so whether the bucket auto-deletes expired objects is unknown here. The app still actively deletes inputs and expires artifacts; a lifecycle backstop is strongly recommended.",
  invalid:
    "The declared lifecycle configuration is malformed and was ignored; the effective state is unknown. Fix the declared provider/flags.",
};

/**
 * Resolve presence-only {@link LifecycleReadiness} from the environment. Maps the
 * parsed declaration to an honest state, defaulting to `unknown` when nothing is
 * declared and never over-claiming that rules are in force. `env` is injectable.
 */
export function resolveLifecycleReadiness(
  env: EnvSource = process.env,
): LifecycleReadiness {
  const parsed = parseLifecycleConfig(env);
  if (!parsed.ok) {
    const state: LifecycleReadinessState = parsed.selected
      ? "invalid"
      : "unknown";
    return { state, provider: null, versioned: null, detail: DETAIL[state] };
  }
  const state: LifecycleReadinessState = parsed.config.validated
    ? "validated"
    : "declared";
  return {
    state,
    provider: parsed.config.provider,
    versioned: parsed.config.versioned,
    detail: DETAIL[state],
  };
}
