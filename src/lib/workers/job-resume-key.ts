/**
 * The sessionStorage prefix a worker panel keeps a running job's id under,
 * one key per tool (`<prefix><slug>`), so a reload can keep waiting for the
 * job. A leaf, so the browser-storage registry `/privacy` renders reads the
 * prefix the panel writes with instead of a copy of it.
 */
export const WORKER_JOB_STORAGE_PREFIX = "pdfxyz.workerJob.";
