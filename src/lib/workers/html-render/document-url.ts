/**
 * Where an uploaded HTML document is served from, for Chromium's eyes only.
 * `.invalid` is reserved (RFC 6761) and the render network refuses it, so the
 * page can never fetch it — or anything relative to it — back from anywhere.
 *
 * Its own module, free of Node imports, because two sides must agree on it:
 * the worker serves the upload here (`native.ts`), and the browser tells the
 * user, before upload, which of the file's references resolve against it and
 * so will be missing from the PDF (`./unbundled-assets`).
 */
export const HTML_DOCUMENT_URL = "https://document.invalid/";
