import Link from "next/link";
import {
  CROP_KEEPS_CONTENT,
  REDACT_TOOL_HREF,
  REDACT_TOOL_NAME,
} from "@/lib/pdf/crop-disclosure";

/**
 * Shown with the cropped download — the moment someone who cropped away a
 * header with an account number is about to share the file. See
 * `@/lib/pdf/crop-disclosure` for why.
 */
export function CropDisclosure() {
  return (
    <p className="text-muted text-sm leading-relaxed">
      {CROP_KEEPS_CONTENT}{" "}
      <Link
        href={REDACT_TOOL_HREF}
        className="text-fg font-medium underline underline-offset-2"
      >
        Open {REDACT_TOOL_NAME}
      </Link>
    </p>
  );
}
