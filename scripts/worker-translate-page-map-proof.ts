/**
 * `pnpm worker:translate-page-map-proof` — Translate PDF's page headings
 * inside the built worker image (slice 4 of competitor audit #29,
 * 2026-11-16).
 *
 *  1. The start-up proof the heartbeat publishes (`translatePageMap`): a
 *     generated three-page PDF as two translate-pdf jobs through the
 *     executor's order, with the image's REAL Translate extractor, its REAL
 *     reflowed-PDF renderer (Chromium) and the engine's own `pdftotext`
 *     read-back, after the PDF-language memo settles. Arm A's stub model
 *     echoes the segment (markers kept), arm B's strips the markers. Must be
 *     true. Prints the derived target, each arm's stage, request count,
 *     persisted `results.ai.pageMap` and the PDF's heading lines, the
 *     verdict's `failed` list, and `pdftotext -v`.
 *  2. The control: the same probe with arm A's model ALSO dropping the
 *     markers. Must be false with `failed` EXACTLY [control, pdf_a, wire_a]
 *     — the real reader must see arm A's PDF lose its page headings, and the
 *     in-probe control must see the two arms become indistinguishable. A
 *     control that failed for any other set proves a different thing.
 *  3. The glued case: arm A's model glues each marker between the pages'
 *     words with its brand broken by a zero-width space. Must fail EXACTLY
 *     [control, pdf_a, wire_a, zip_identity] (`GLUED_FAILED`) — and so never
 *     zip_clean: the real reader must find no trace of the broken brand in
 *     either ZIP or in the PDF as poppler reads it.
 *  4. The heartbeat's own entry point, `provesTranslatePageMap(env)`, must
 *     be true.
 *
 * Exit codes: 0 = proven; 1 = the probe false (including `pdf_unavailable`:
 * the CI image has Chromium and the CI-required PDF languages are proven
 * there, so no PDF to label is itself a failure), the control true or false
 * for the wrong set, the glued run for any other set, or the entry point
 * false; 2 = no pdftotext in this
 * image. Run by `.github/workflows/container.yml`; no secret, queue, store,
 * network, model or user document is touched — the model is a stub and the
 * document is generated here.
 */
import { spawnSync } from "node:child_process";
import { resolveNativePdfTextReader } from "@/lib/workers/pdf-text/native";
import { resolveNativePdfTextConfig } from "@/lib/workers/pdf-text/native-config";
import { translateDeps } from "@/lib/workers/translate/native";
import {
  GLUED_FAILED,
  gluedBrokenBrandAnswer,
  probeTranslatePageMap,
  provesTranslatePageMap,
  stripSeparatorsAnswer,
  type PageMapVerdict,
} from "@/lib/workers/translate/page-map-capability";
import { translatePdfLanguages } from "@/lib/workers/translate/pdf-capability";

/** The control's expected failure set, sorted. */
const CONTROL_FAILED = ["control", "pdf_a", "wire_a"];

function printVerdict(label: string, verdict: PageMapVerdict, ms: number) {
  console.log(
    `${label}: ${verdict.ok ? "PASS" : "FAIL"} failed=[${verdict.failed.join(",")}] target=${verdict.target ?? "(none)"} ${Math.round(ms)} ms`,
  );
  for (const [arm, r] of Object.entries(verdict.arms ?? {}))
    console.log(
      `  arm ${arm}: stage=${r.stage} requests=${r.requests} headings=${JSON.stringify(r.headings)} pageMap=${JSON.stringify(r.pageMap)}`,
    );
}

async function main(): Promise<number> {
  const config = resolveNativePdfTextConfig(process.env);
  const version = spawnSync(config.binary, ["-v"], { encoding: "utf8" });
  const banner = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  console.log(`pdftotext -v: ${banner.split("\n")[0] || "(no output)"}`);

  const readPdfText = resolveNativePdfTextReader(process.env);
  if (!translateDeps(process.env).extract || !readPdfText) {
    console.log("CANNOT CONCLUDE — pdftotext is not available in this image.");
    return 2;
  }

  const failures: string[] = [];

  const t0 = performance.now();
  const languages = await translatePdfLanguages(process.env);
  console.log(
    `proven PDF languages (${languages.length}): ${languages.join(",")} ${Math.round(performance.now() - t0)} ms`,
  );

  // Built AFTER the memo settled: `deps.pdf.languages` reads it at job time.
  const deps = translateDeps(process.env);
  if (!deps.pdf)
    failures.push("no reflowed-PDF renderer (Chromium) in this image");

  const t1 = performance.now();
  const probe = await probeTranslatePageMap({
    extract: deps.extract,
    pdf: deps.pdf,
    readPdfText,
    env: process.env,
  });
  printVerdict("probe (both arms)", probe, performance.now() - t1);
  if (probe.failed.includes("pdf_unavailable"))
    failures.push(
      "pdf_unavailable — no renderer, no reader, or no provable target; the CI image must print one",
    );
  if (!probe.ok) failures.push("the probe is false");

  const t2 = performance.now();
  const control = await probeTranslatePageMap({
    extract: deps.extract,
    pdf: deps.pdf,
    readPdfText,
    env: process.env,
    answerA: stripSeparatorsAnswer,
  });
  printVerdict(
    "control (arm A's model drops the markers too)",
    control,
    performance.now() - t2,
  );
  if (control.ok) failures.push("the control is true");
  const got = [...control.failed].sort();
  if (
    got.length !== CONTROL_FAILED.length ||
    got.some((c, i) => c !== CONTROL_FAILED[i])
  )
    failures.push(
      `the control failed [${got.join(",")}], not [${CONTROL_FAILED.join(",")}]`,
    );

  const t3 = performance.now();
  const glued = await probeTranslatePageMap({
    extract: deps.extract,
    pdf: deps.pdf,
    readPdfText,
    env: process.env,
    answerA: gluedBrokenBrandAnswer,
  });
  printVerdict(
    "glued (arm A glues each marker inline, brand broken by a ZWSP)",
    glued,
    performance.now() - t3,
  );
  const gotGlued = [...glued.failed].sort();
  if (
    gotGlued.length !== GLUED_FAILED.length ||
    gotGlued.some((c, i) => c !== GLUED_FAILED[i])
  )
    failures.push(
      `the glued run failed [${gotGlued.join(",")}], not [${GLUED_FAILED.join(",")}]`,
    );

  const entry = await provesTranslatePageMap(process.env);
  console.log(`provesTranslatePageMap(env): ${entry}`);
  if (!entry) failures.push("the heartbeat's entry point is false");

  if (failures.length > 0) {
    console.log(`PAGE MAP PROOF: ${failures.length} FAILED`);
    for (const f of failures) console.log(`  - ${f}`);
    return 1;
  }
  console.log("PAGE MAP PROOF: PASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(
      `FAIL — the proof threw: ${error instanceof Error ? error.name : "unknown"}`,
    );
    process.exit(1);
  },
);
