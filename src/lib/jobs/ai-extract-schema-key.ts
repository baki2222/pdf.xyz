/**
 * Where AI Data Extraction keeps the schemas a person saves: this browser's
 * localStorage, under this one key. Alone in its module so the storage
 * registry `/privacy` renders (`@/lib/browser-storage`) can import the key
 * without importing the schema code.
 */
export const SAVED_SCHEMAS_KEY = "pdfxyz.ai-extract-schemas";
