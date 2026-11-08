import { WORKER_BATCH_TOOLS } from "./tools";

/**
 * What Protect PDF's and Unlock PDF's batches say (batch plan P4), beside
 * the worker batch's own words (`./worker-copy`). One definition for the
 * batch's rows and the tool pages, so the page cannot describe a batch the
 * code does not run.
 *
 * Each sentence is true of `runner/batch/security-batch.tsx`:
 *
 *   - the local look before an upload is `classifyPdfAccess`, a pdf.js open
 *     in the browser: Unlock leaves out only a file it reports
 *     `unencrypted`; Protect leaves out one it reports `password-required`
 *     or `restricted`. Anything else is sent, and our server's own check
 *     answers for it, word for word, on the row;
 *   - a file left out is a SKIPPED row, with no output, so it is never in
 *     the ZIP ("Download all" bundles finished rows only);
 *   - the password is typed once, frozen when Run is pressed, sent in each
 *     file's job body exactly as for one file, and forgotten by the page
 *     when the batch ends, is put back with "Run again", or is left — so a
 *     retry asks for it again.
 *
 * Read by the batch's own chunk and by the tool pages' content on the
 * server; never by a first-load module.
 */

/** A file Unlock's batch found not locked: left out, unsent. */
export const UNLOCK_NOT_LOCKED_REASON =
  "This PDF is not locked, so there is nothing to unlock. The batch left it out, unsent, and it is not in the ZIP.";

/** A file Protect's batch found already needing a password to open. */
export const PROTECT_NEEDS_PASSWORD_REASON =
  "This PDF already needs a password to open, so the batch left it out, unsent. Unlock it with that password first, then protect it again.";

/** A file Protect's batch found already restricted by an owner password. */
export const PROTECT_RESTRICTED_REASON =
  "This PDF is already encrypted: it opens without a password, but an owner (permissions) password locks its printing, copying or editing. The batch left it out, unsent; unlock it with that owner password first, then protect it.";

const files = (n: number) => `${n} failed ${n === 1 ? "file" : "files"}`;

/** Unlock's retry, once a batch has ended with failures. */
export function unlockRetryHeading(failed: number): string {
  return `Try another password for the ${files(failed)}`;
}

/** Protect's retry, once a batch has ended with failures. */
export function protectRetryHeading(failed: number): string {
  return `Protect the ${files(failed)} again`;
}

/** Under either retry heading: what runs, what stays, why it asks again. */
export const SECURITY_RETRY_NOTE =
  "Only the failed files run again; the files that worked keep their results. This page forgot the password when the batch ended, so type it here.";

/** Under the batch's password: one password for every file. */
export const UNLOCK_BATCH_PASSWORD_HINT =
  "One password for the whole batch: the password that opens the files — or, for a file that opens without one, its owner (permissions) password.";

/** Under Protect's batch password: one password for every file. */
export const PROTECT_BATCH_PASSWORD_HINT =
  "One password for every file: anyone opening any of them will need it. Store it somewhere safe — it can't be recovered.";

/** A tool page's account of the password in its batch. */
export function securityBatchPageSentence(
  slug: "protect-pdf" | "unlock-pdf",
): string {
  const { verb } = WORKER_BATCH_TOOLS[slug];
  const lead =
    slug === "unlock-pdf"
      ? "In a batch, you type one password, for the whole batch. A file that is not locked is left out, unsent, with a row that says so, and is not in the ZIP. If files fail, for example on a wrong password, Try another password runs only those files again with a new one; the files that worked keep their results."
      : "In a batch, you type one password, and choose one encryption strength and one set of permissions, for every file. A file this browser can tell is already encrypted is left out, unsent, with a row that says so.";
  return `${lead} The password is sent with each file's job, as it is for one file, and the page forgets it when the batch ends; to ${verb.toLowerCase()} failed files again, you type it again.`;
}
