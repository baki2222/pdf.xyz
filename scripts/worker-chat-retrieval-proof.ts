/**
 * `pnpm worker:chat-retrieval-proof` — Chat with PDF's page selection inside
 * the built worker image: the start-up proof the heartbeat publishes as
 * `chatRetrieval` (`src/lib/workers/chat-with-pdf/retrieval-capability.ts`),
 * run on the image's REAL `pdftotext` and ICU, each check printed by letter.
 *
 * A 70-page PDF with a token on page 60 only goes through the executor's
 * order under an 8,000-character delivery cap with a RECORDING provider: no
 * AI call, no spend, no secret, queue, store or user document. It also
 * prints the word segmenter's own answer, so the run shows the image has
 * full ICU (`Intl.Segmenter` word granularity) rather than inferring it.
 *
 * Exit codes: 0 = proven; 1 = a check failed (or the image has no
 * pdftotext). Run by `.github/workflows/container.yml`.
 */
import {
  CHAT_RETRIEVAL_PROOF_CAP,
  runChatRetrievalProof,
} from "@/lib/workers/chat-with-pdf/retrieval-capability";
import { tokenize, wordSegmenterAvailable } from "@/lib/pdf/page-retrieval";

async function main(): Promise<number> {
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
            "zqprobe চুক্তির 契約書 สัญญา",
          ),
        ]
          .filter((piece) => piece.isWordLike)
          .map((piece) => piece.segment)
      : null;
  console.log(
    `node ${process.version}; ICU ${process.versions.icu ?? "none"}; ` +
      `Intl.Segmenter ${typeof Intl.Segmenter}; word-like segments ` +
      `${JSON.stringify(segmenter)}; wordSegmenterAvailable ${wordSegmenterAvailable()}; ` +
      `tokenize ${JSON.stringify(tokenize("[Page 12]\n░░░ zqprobe"))}`,
  );
  console.log(`delivery cap ${CHAT_RETRIEVAL_PROOF_CAP} characters`);
  const started = Date.now();
  const result = await runChatRetrievalProof(process.env);
  for (const line of result.lines) console.log(line);
  console.log(`proof ran in ${Date.now() - started} ms`);
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
