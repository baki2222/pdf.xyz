import type { ToolCategory, ToolCategoryId } from "./types";

/** Ordered category definitions. Order drives navigation and grid layout. */
export const categories: ToolCategory[] = [
  {
    id: "organize",
    name: "Organize",
    short: "Organize",
    description: "Merge, split, reorder, rotate, and clean up pages.",
    icon: "organize",
    gradient: "from-violet-500 to-indigo-500",
  },
  {
    id: "convert-to",
    name: "Convert to PDF",
    short: "To PDF",
    description: "Turn Office files, images, web pages, and text into PDF.",
    icon: "convertTo",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    id: "convert-from",
    name: "Convert from PDF",
    short: "From PDF",
    description: "Export PDFs to Word, Excel, images, and structured data.",
    icon: "convertFrom",
    gradient: "from-cyan-500 to-teal-500",
  },
  {
    id: "edit",
    name: "Edit & Annotate",
    short: "Edit",
    description: "Edit text and images, annotate, watermark, and number pages.",
    icon: "edit",
    gradient: "from-fuchsia-500 to-pink-500",
  },
  {
    id: "sign",
    name: "Sign & Forms",
    short: "Sign",
    description: "Sign documents, request signatures, and fill forms.",
    icon: "sign",
    gradient: "from-emerald-500 to-green-500",
  },
  {
    id: "security",
    name: "Security",
    short: "Security",
    description: "Protect, unlock, redact, flatten, and compare PDFs.",
    icon: "shield",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    id: "optimize",
    name: "Optimize",
    short: "Optimize",
    description: "Compress, OCR, repair, and web-optimize your documents.",
    icon: "speed",
    gradient: "from-rose-500 to-red-500",
  },
  {
    id: "ai",
    name: "AI Tools",
    short: "AI",
    description: "Chat with, summarize, translate, and extract data from PDFs.",
    icon: "ai",
    gradient: "from-violet-500 via-purple-500 to-blue-500",
  },
];

const categoryMap = new Map<ToolCategoryId, ToolCategory>(
  categories.map((category) => [category.id, category]),
);

export function getCategory(id: ToolCategoryId): ToolCategory | undefined {
  return categoryMap.get(id);
}
