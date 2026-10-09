/**
 * The recents store's key, alone in its module so a server page that lists
 * what the site keeps in a browser (`/privacy`, through
 * `@/lib/browser-storage`) can name it without importing the store's React
 * hook (`./recents`).
 */
export const RECENTS_STORAGE_KEY = "pdfxyz.recents.v1";
