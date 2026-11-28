/**
 * A worker batch's finished PDFs joined into one, in the order given
 * (audit wave 2, powerpoint-to-pdf#1). Merge PDF's own engine, loaded only
 * when the join is asked for, so no page pays for it before then.
 */
export async function combineBatchPdfs(
  blobs: readonly Blob[],
): Promise<Uint8Array> {
  const files = await Promise.all(
    blobs.map(async (blob) => new Uint8Array(await blob.arrayBuffer())),
  );
  const { mergePdfs } = await import("@/lib/pdf/engine");
  return mergePdfs(files);
}
