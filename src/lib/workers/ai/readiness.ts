/**
 * Presence-only readiness of the **AI provider** for the whole deployment — the
 * seam that lets the web app decide, *before* a user uploads anything, whether an
 * AI tool (summarize, translate, chat, ai-extract) can honestly be offered.
 *
 * This is the AI analogue of `../daemon/readiness.ts`, and it exists for the same
 * reason: the piece that does the work runs out-of-band. The API key is
 * deliberately deployed to the secure worker only — the web service "needs no
 * worker secrets" (see `docker-compose.worker.yml`) — so the web tier cannot, and
 * must not, prove a key exists. What it CAN read is the non-secret family switch
 * (`PDFXYZ_AI_PROVIDER`, plus the optional public `PDFXYZ_AI_MODEL`), which an
 * operator sets on both tiers to declare "this deployment runs AI on family X".
 *
 * Honesty posture:
 *  - `ready` means "an operator has declared AI for this deployment", NOT "a key
 *    was verified". The distinction is stated plainly in `detail` and mirrors how
 *    {@link DaemonReadiness} reports a drainable queue without claiming a daemon
 *    is actually running.
 *  - Declaring nothing is the safe default: AI tools stay off and the UI says so
 *    up front, so a user never uploads a document to a tool that cannot run.
 *  - A half-configured or malformed declaration is honestly *off*, pointing at the
 *    offending setting by its human name — never its value.
 *  - Node-free and secret-free, and — unlike the operator-facing
 *    {@link import("./config").nativeAiCapability} — **variable-name-free**: this
 *    type is serialized straight into `/api/worker/status` and the client-facing
 *    {@link import("../status").WorkerStatus}, which by long-standing invariant
 *    carry no `PDFXYZ_` names (see `../deploy/honesty.test.ts`). Deployment
 *    guidance here is written for a human reader; the exact variable names live in
 *    the operator docs and in `AI_ENV`.
 */

import {
  AI_ENV,
  AI_PROVIDER_FAMILIES,
  nativeAiCapability,
  resolveAiDeclaration,
  type AiProviderFamily,
} from "./config";

type EnvSource = Record<string, string | undefined>;

/** The honest, client-safe readiness of the AI provider in this deployment. */
export interface AiReadiness {
  /** True when an operator declared a known provider family for this deployment. */
  declared: boolean;
  /** The declared provider family, or `null` when absent/malformed. Public id only. */
  provider: AiProviderFamily | null;
  /** Public model id the worker would run, or `null`. Never a secret. */
  model: string | null;
  /**
   * True when THIS process holds a complete, valid AI configuration (family AND
   * key) — the normal state on the worker tier, and `false` on a correctly
   * configured web tier, which is deliberately keyless. Presence only: it reports
   * that a key exists here, never any part of its value.
   */
  configuredHere: boolean;
  /**
   * True when the UI may offer AI tools. Derived from the declaration alone,
   * because the key lives on the out-of-band worker and is unobservable here.
   */
  ready: boolean;
  /**
   * One-line, client-safe explanation. Never names a key, endpoint, value, or
   * environment variable — see the module note on the no-`PDFXYZ_` invariant.
   */
  detail: string;
}

const OPERATOR_SETUP = `An operator enables them by declaring a supported AI provider family (${AI_PROVIDER_FAMILIES.join(", ")}) for this deployment and giving the secure worker that provider's API key.`;

/**
 * Human names for the settings a declaration can be wrong about, so an invalid
 * deployment is still actionable in a payload that must not carry variable names.
 * Keyed by the `FieldError.field` the config layer reports (an `AI_ENV` variable).
 */
const SETTING_LABELS: Record<string, string> = {
  [AI_ENV.provider]: "the AI provider family",
  [AI_ENV.model]: "the AI model id",
};

function settingLabel(field: string): string {
  return SETTING_LABELS[field] ?? "an AI setting";
}

/**
 * Resolve the deployment's AI readiness from the environment. Presence-only and
 * deterministic; `env` is injectable for tests. `configuredHere` uses the full
 * config resolver (so the worker tier reports its own complete state), while
 * `ready` uses the key-free declaration, which is all the web tier can know.
 */
export function resolveAiReadiness(env: EnvSource = process.env): AiReadiness {
  const declaration = resolveAiDeclaration(env);
  // The full, key-aware capability. On the keyless web tier this is not ready
  // even when AI is correctly declared — that is expected, not a fault.
  const configuredHere = nativeAiCapability(env).ready;

  if (declaration.state === "absent") {
    return {
      declared: false,
      provider: null,
      model: null,
      configuredHere: false,
      ready: false,
      detail: `No AI provider is declared for this deployment, so the AI tools stay off — nothing is uploaded and no answer, summary, translation, or extraction is produced. ${OPERATOR_SETUP}`,
    };
  }

  if (declaration.state === "invalid") {
    return {
      declared: false,
      provider: null,
      model: null,
      configuredHere: false,
      ready: false,
      detail: `The AI configuration for this deployment is invalid (${settingLabel(declaration.error.field)} ${declaration.error.message}), so the AI tools stay off rather than running half-configured.`,
    };
  }

  const { provider, model } = declaration;
  return {
    declared: true,
    provider,
    model,
    configuredHere,
    ready: true,
    detail: configuredHere
      ? `AI is configured in this process with the ${provider} provider (model ${model}).`
      : `AI is declared for this deployment on the ${provider} provider (model ${model}) and runs on the out-of-band secure worker, which holds the API key. Whether that worker's key is present is not observable from here; if it is missing, the job fails honestly instead of returning a fabricated answer.`,
  };
}
