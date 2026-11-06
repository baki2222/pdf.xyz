/**
 * `pnpm worker:epub-proof` — EPUB to PDF inside the built worker image: the
 * fixture books (`@/tests/epub-fixtures`) through the real engine and the
 * image's REAL Chromium, each PDF read back with pdf.js for chapter order,
 * the image, the stylesheet, the outline and the absence of script output; a
 * reversed book as the control the verdict must fail; and the refusals (DRM,
 * a ZIP bomb, a .docx named .epub, a spine escaping the root), each before
 * Chromium. The render network is replaced by one that counts and throws, so
 * a fetch for the book's remote image is a FAIL. See
 * `src/lib/workers/epub/image-proof.ts`.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = Chromium is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched, and nothing it prints is document text
 * beyond the fixtures' own proof words.
 */
import { nativeEpubRenderDeps } from "@/lib/workers/epub/native";
import { runEpubImageProof } from "@/lib/workers/epub/image-proof";
import {
  docxNamedEpub,
  drmBook,
  epub2Book,
  epub3Book,
  escapingSpineBook,
  fixedLayoutBook,
  fontObfuscatedBook,
  zipBombBook,
} from "@/tests/epub-fixtures";

async function main(): Promise<number> {
  const requests: string[] = [];
  let fetches = 0;
  const refuse = async (): Promise<never> => {
    fetches += 1;
    throw new Error("the EPUB render reached the network");
  };
  const chromium = nativeEpubRenderDeps(process.env, {
    onRequest: (r) => requests.push(r.url),
    network: { resolve: refuse, fetch: refuse },
  }).chromium;
  if (!chromium) {
    console.log("CANNOT CONCLUDE — Chromium is not available in this image.");
    return 2;
  }
  const result = await runEpubImageProof({
    chromium,
    requests: () => requests,
    fetches: () => fetches,
    books: {
      epub3: () => epub3Book(),
      epub3Reversed: () => epub3Book({ reverseSpine: true }),
      epub2: epub2Book,
      fixedLayout: fixedLayoutBook,
      fontObfuscated: fontObfuscatedBook,
      drm: drmBook,
      zipBomb: zipBombBook,
      docxNamedEpub,
      escapingSpine: escapingSpineBook,
    },
  });
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? "PROVEN" : "FAIL");
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
