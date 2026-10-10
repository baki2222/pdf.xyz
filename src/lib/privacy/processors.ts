/**
 * Who processes visitor data for pdf.xyz, and what each one receives — the
 * list /privacy §7 renders, and the names every other section draws on.
 *
 * Two kinds of fact meet here, and they are held in different ways:
 *
 *  - What the CODE integrates — Google's tag and collection origins, the
 *    storage origin the publish workflow demands on the wire, the AI
 *    adapters' hosts — is DERIVED by `privacy-truth.test.tsx`, which fails
 *    when an integration has no company here.
 *  - What only PRODUCTION can say — which companies host the two servers,
 *    which Cloudflare services are on, which AI family runs — was verified
 *    outside the repository on 2026-10-10 (the Art. 30 record, §5, facts
 *    F5-F7). That test keeps its own copy of those facts with their
 *    provenance: an independent bound, so changing one list and not the
 *    other is red. A later deployment can make them stale; re-check at the
 *    wire before relying on one.
 *
 * Deliberately NOT here: a data-centre location nobody has verified (the
 * worker host's IP is registered to Contabo GmbH; the building is unknown),
 * the transfer mechanism per company (owner to confirm), and the provider
 * behind our mailbox (owner to confirm). A sentence that is true either way
 * says the company and its country, which are known.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`).
 */
import { LEGAL_CONTACT } from "@/lib/legal";

export interface Processor {
  readonly id: "cloudflare" | "interserver" | "contabo" | "openai" | "google";
  /** As /privacy names it. */
  readonly name: string;
  /** Where the company is based — not where a given server stands. */
  readonly basedIn: string;
  /** What it does for us and what it receives, in a reader's words. */
  readonly does: string;
}

export const CLOUDFLARE = "Cloudflare";
/** The object store that holds uploads and results. */
export const STORAGE_PROVIDER = `${CLOUDFLARE} R2`;
/** The production AI provider (F7: the live heartbeat names `openai`). */
export const AI_PROVIDER = {
  name: "OpenAI",
  family: "openai",
  /**
   * What OpenAI may keep by default to monitor for abuse, unless
   * zero-data-retention is arranged — which is not confirmed, so the page
   * states the default as an upper bound ("up to"), true either way.
   */
  abuseMonitoringRetentionDays: 30,
} as const;

/** The same figure, as /privacy states it. */
export const AI_PROVIDER_RETENTION = `${AI_PROVIDER.abuseMonitoringRetentionDays} days`;

export const PROCESSORS: readonly Processor[] = [
  {
    id: "cloudflare",
    name: CLOUDFLARE,
    basedIn: "the USA",
    does: `Sits in front of the whole site: every request passes through its network, which also answers for the site's domain and encrypts the connection to your browser. ${STORAGE_PROVIDER} stores uploaded files and results for the windows in section 2, and receives each upload straight from your browser. ${CLOUDFLARE} Email Routing receives email sent to ${LEGAL_CONTACT} and forwards it to our mailbox. Our processing server also reaches the job queue through ${CLOUDFLARE}.`,
  },
  {
    id: "interserver",
    name: "InterServer",
    basedIn: "the USA",
    does: "Hosts our web server, in New Jersey, USA. It runs this website and the job queue, which holds each job's record and instructions, and the rate-limit counters.",
  },
  {
    id: "contabo",
    name: "Contabo",
    basedIn: "Germany",
    does: "Provides the server our processing worker runs on, where uploaded files are scanned for malware and processed.",
  },
  {
    id: "openai",
    name: AI_PROVIDER.name,
    basedIn: "the USA",
    does: "Our AI provider. When you use an AI tool it receives the text of your PDF and what you typed into the tool — see section 3.",
  },
  {
    id: "google",
    name: "Google",
    basedIn: "the USA",
    does: "Runs Google Analytics, which loads only if you allow it — see section 4.",
  },
];
