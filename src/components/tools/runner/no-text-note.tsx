import Link from "next/link";

/** The tool that recovers text from a scanned PDF, and where it lives. */
export const OCR_TOOL_NAME = "OCR PDF";
export const OCR_TOOL_HREF = "/tools/ocr-pdf";

/**
 * What PDF to Text and PDF to Markdown show when a PDF has no selectable text.
 *
 * A scanned PDF is the most common reason those tools come back empty, and the
 * result used to be a dead end: a green "success" panel with a plain-text hint
 * to "Use OCR PDF when OCR is enabled" and no way to get there. The way out is
 * a real link now. The file cannot be carried across (OCR PDF has no in-browser
 * handoff), so the note says to add the same file there rather than implying
 * it will arrive on its own.
 */
export function NoSelectableTextNote({ extra }: { extra?: string }) {
  return (
    <div className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-3 border p-4 text-sm leading-relaxed">
      <p>
        This PDF has no selectable text — it is probably scanned or made of
        images. {OCR_TOOL_NAME} can recognize the text (it can output TXT); open
        it and add the same file there.
        {extra ? ` ${extra}` : ""}
      </p>
      <Link
        href={OCR_TOOL_HREF}
        className="text-fg self-start font-medium underline underline-offset-2"
      >
        Open {OCR_TOOL_NAME}
      </Link>
    </div>
  );
}
