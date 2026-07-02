import { renderBrandMark } from "@/lib/og";

export const dynamic = "force-static";

// 512×512 PWA icon referenced from the web app manifest.
export function GET() {
  return renderBrandMark(512);
}
