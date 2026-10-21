import { HeroDeskIsland } from "@/components/intent/hero-desk-island";
import { Container } from "@/components/ui/container";
import {
  acceptAttribute,
  acceptHint,
} from "@/components/upload/accepted-kinds";
import { processingMeta } from "@/lib/tools/processing";

/** The home desk's id: the target of every "Choose files" link on the page. */
export const UPLOAD_ANCHOR = "upload";

/**
 * The home page's first screen, for someone who has never heard of us: what
 * this is in one line, what you can do in one sentence, one button, and one
 * line on where files go.
 *
 * WAS (until 2026-10-21) a mono spec kicker ("Privacy-first PDF platform ·
 * 50 tools"), a two-part headline on a cyan sweep, a lede, "Open workspace"
 * and "Browse all tools", a three-item trust rule, and a working desk with
 * six task links. The owner's brief: "it looks like advanced developer
 * style; users struggle to understand". The desk stays — it is how a file
 * picked or dropped here becomes a job ticket (WP-05/07), and a drop
 * anywhere on the page still lands in it — but its first state is a plain
 * drop area.
 *
 * ONE ORDER FOR EVERY WIDTH: headline, desk, sentence, trust line — so on a
 * phone the desk is on the first screen (`e2e/home-desk.mobile.spec.ts`).
 * From `lg` the words take the left column and the desk the right, placed
 * by row and column, with no reordering.
 */
export function Hero() {
  // The badge words the cards use, so the note names what a visitor sees.
  const server = processingMeta.server.plain;
  const ai = processingMeta.ai.plain;
  return (
    <section className="border-line border-b">
      <Container className="grid grid-cols-1 pt-8 pb-12 sm:pt-12 lg:grid-cols-12 lg:grid-rows-[1fr_auto_1fr] lg:gap-x-12 lg:pt-12 lg:pb-12">
        <h1 className="font-display text-fg text-display-1 font-bold text-balance lg:col-span-6 lg:row-start-1 lg:self-end">
          Every PDF tool you need, free and private
        </h1>

        <div className="mt-6 lg:col-span-6 lg:col-start-7 lg:row-span-3 lg:row-start-1 lg:mt-0">
          <HeroDeskIsland
            id={UPLOAD_ANCHOR}
            accept={acceptAttribute()}
            acceptHint={acceptHint()}
            note={
              <p className="text-muted mt-1.5 max-w-xs text-xs leading-snug text-pretty">
                Your files stay in this browser until you start a tool marked{" "}
                {server} or {ai}.
              </p>
            }
          />
        </div>

        <p className="text-muted mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg lg:col-span-6 lg:row-start-2 lg:mt-6">
          Merge, split, compress, convert, edit and sign PDFs online — free,
          with no sign-up.
        </p>

        <p className="text-muted mt-4 flex items-start gap-2 text-sm lg:col-span-6 lg:row-start-3 lg:mt-6 lg:self-start">
          <span
            aria-hidden
            className="bg-ok mt-[0.4rem] size-1.5 shrink-0 rounded-full"
          />
          Most tools run in your browser — your files never leave your device.
        </p>
      </Container>
    </section>
  );
}
