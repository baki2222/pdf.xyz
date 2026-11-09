/**
 * The editor's page column, from the one pure layout the PDF Viewer shares
 * (`@/lib/pdf/view-layout`): moved there on 2026-11-10 so both views place
 * pages, and pick which to draw, with the same arithmetic.
 */
export {
  COLUMN_PAD,
  PAGE_GAP,
  currentPage,
  layoutPages,
  pagesNear,
  type PageSlot,
} from "@/lib/pdf/view-layout";
