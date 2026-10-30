/**
 * What a worker job needs only once it RUNS — reserve and upload
 * (`./slot-upload`), poll to a terminal state (`./job-polling`), read a
 * refusal (`./read-error`) — as one module, so it is one on-demand chunk.
 *
 * Never import this statically: reach it through `./job-run-lazy`. Until
 * 2026-10-30 the worker clients imported these three directly, which put
 * them (2.5 KB gz with the stage helpers, `8146-*.js`) in the first load of
 * every worker tool page and the status page, for code that runs only after
 * a file is chosen and Run is pressed. `lazy-chunks.test.ts` holds that no
 * page loads the upload or the poll up front, each found by its own
 * sentence (`NO_UPLOAD_SLOT`, `STOPPED_WAITING`) — so a static import of
 * either module, not only of this one, is caught.
 */
export { uploadToWorkerSlot } from "./slot-upload";
export { pollJobToTerminal } from "./job-polling";
export { readWorkerError } from "./read-error";
