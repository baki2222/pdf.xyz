import type { ToolCategory, ToolCategoryId } from "./types";

/** Ordered category definitions. Order drives navigation and grid layout. */
export const categories: ToolCategory[] = [
  {
    id: "organize",
    name: "Organize",
    short: "Organize",
    description: "Merge, split, reorder, rotate, and clean up pages.",
    icon: "organize",
  },
  {
    id: "convert-to",
    name: "Convert to PDF",
    short: "To PDF",
    description: "Turn Office files, images, web pages, and text into PDF.",
    icon: "convertTo",
  },
  {
    id: "convert-from",
    name: "Convert from PDF",
    short: "From PDF",
    description: "Export PDFs to Word, Excel, images, and structured data.",
    icon: "convertFrom",
  },
  {
    id: "edit",
    name: "Edit & Annotate",
    short: "Edit",
    description: "Edit text and images, annotate, watermark, and number pages.",
    icon: "edit",
  },
  {
    id: "sign",
    name: "Sign & Forms",
    short: "Sign",
    description: "Sign documents, request signatures, and fill forms.",
    icon: "sign",
  },
  {
    id: "security",
    name: "Security",
    short: "Security",
    description: "Protect, unlock, redact, flatten, and compare PDFs.",
    icon: "shield",
  },
  {
    id: "optimize",
    name: "Optimize",
    short: "Optimize",
    description: "Compress, OCR, repair, and web-optimize your documents.",
    icon: "speed",
  },
  {
    id: "ai",
    name: "AI Tools",
    short: "AI",
    description: "Chat with, summarize, translate, and extract data from PDFs.",
    icon: "ai",
  },
];

const categoryMap = new Map<ToolCategoryId, ToolCategory>(
  categories.map((category) => [category.id, category]),
);

export function getCategory(id: ToolCategoryId): ToolCategory | undefined {
  return categoryMap.get(id);
}
