import { renderBrandMark } from "@/lib/og";

export const dynamic = "force-static";

// 192×192 PWA icon referenced from the web app manifest.
export function GET() {
  return renderBrandMark(192);
}
