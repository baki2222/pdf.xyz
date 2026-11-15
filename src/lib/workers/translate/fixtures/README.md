# Translate PDF probe fixtures (CJK in Type 3)

Real PDFs printed by the worker image's Chromium 156, which prints the
CFF-only Noto CJK faces of Debian bookworm as **Type 3** fonts. A desktop
Chromium with TrueType system CJK faces never produces this shape, so these
files and the prod-image proof are the only places that path is exercised.

Captured 2026-11-16 in a throwaway `--network none` container of
`ghcr.io/baki2222/pdfxyz-worker:latest`, digest
`sha256:4ec9d4cf0461c6b554697a7946d0b6343111a2a8a2e144f674147cdd4ffbe0b3`
(no env file, no secret, no model: the probe's stub model returns the text),
from the branch `feat/translate-cjk-pdf` tree mounted read-only:

```sh
docker run --rm --network none -v <tree>:/app-x:ro -v <out>:/out -w /app-x \
  --entrypoint npx ghcr.io/baki2222/pdfxyz-worker:latest \
  tsx scripts/capture-translate-cjk-fixtures.ts /out
```

| file                       | what it is                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zh-probe.pdf`             | the start-up probe's zh PDF, after the ToUnicode rewrite (probe verdict PASS)                                                                                                                                             |
| `ja-probe.pdf`             | the probe's ja PDF, after the rewrite (PASS)                                                                                                                                                                              |
| `ko-probe.pdf`             | the probe's ko PDF (PASS; Hangul shares no glyph with a radical)                                                                                                                                                          |
| `en-probe.pdf`             | the probe's en PDF (PASS): CID TrueType only, for the ToUnicode byte-identity test                                                                                                                                        |
| `bn-probe.pdf`             | the probe's bn PDF (PASS): CID TrueType only, for the same test                                                                                                                                                           |
| `zh-probe.pre-rewrite.pdf` | the same zh probe from a copy of the tree with the one line `normaliseToUnicodeStreams(doc);` removed (mutation m5), so its ToUnicode maps 文's glyph to U+2F42. A NEGATIVE fixture only (probe verdict `FAIL (glyphs)`). |
| `zh-probe.pdffonts.txt`    | `pdffonts` (poppler 22.12.0) in the same image over `zh-probe.pdf`, unedited                                                                                                                                              |

Excerpts become fixtures: none of these files is edited. Negative controls
mutate a COPY of their bytes in the test (`pdf-glyphs.test.ts`).
