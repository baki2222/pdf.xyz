import { renderBrandMark } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Apple touch icon (iOS home screen). Rendered from the shared brand mark.
export default function AppleIcon() {
  return renderBrandMark(180);
}
