import Link from "next/link";
import {
  CROP_KEEPS_CONTENT,
  REDACT_TOOL_HREF,
  REDACT_TOOL_NAME,
} from "@/lib/pdf/crop-disclosure";

/**
 * Shown with the cropped download — the moment someone who cropped away a
 * header with an account number is about to share the file. See
 * `@/lib/pdf/crop-disclosure` for why. Split Pages in Half passes its own
 * sentence (`SPLIT_HALF_KEEPS_CONTENT`): its halves are crop boxes too.
 */
export function CropDisclosure({
  sentence = CROP_KEEPS_CONTENT,
}: {
  sentence?: string;
}) {
  return (
    <p className="text-muted text-sm leading-relaxed">
      {sentence}{" "}
      <Link
        href={REDACT_TOOL_HREF}
        className="text-fg font-medium underline underline-offset-2"
      >
        Open {REDACT_TOOL_NAME}
      </Link>
    </p>
  );
}
