/**
 * Where the analytics choice is kept — a leaf, so the browser-storage
 * registry `/privacy` renders can read the key without importing the consent
 * hooks into a server page.
 */
export const CONSENT_STORAGE_KEY = "pdfxyz.analytics-consent";
