# Bundled fonts

These font files are used **only** to render the OpenGraph / Twitter share
image (`src/app/opengraph-image.tsx`) at build time. They are not shipped to the
browser — the app UI uses Geist via `next/font`.

- `Inter-Regular.woff`, `Inter-Bold.woff` — Inter (Latin subset), by Rasmus
  Andersson.
  - Source: `@fontsource/inter@5` (jsDelivr).
  - License: SIL Open Font License 1.1 — free to use, embed, and redistribute.
    <https://github.com/rsms/inter/blob/master/LICENSE.txt>

WOFF (not WOFF2) is committed intentionally: Satori — the engine behind
`next/og` — reads WOFF/TTF/OTF directly, so this keeps the OG image build
deterministic with no network fetch.
