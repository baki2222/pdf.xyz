# syntax=docker/dockerfile:1
#
# pdf.xyz — one multi-stage build, two INDEPENDENT runtime targets:
#
#   * `web`    — the Next.js App Router site (`pnpm start`). Serves users. Ships
#                NO native PDF engines and never imports or starts the daemon.
#   * `worker` — the out-of-band secure-worker daemon (`pnpm worker:daemon`).
#                Ships Ghostscript / qpdf / mutool for deep compression AND the
#                OCRmyPDF / Tesseract OCR stack (English language data), drains the
#                queue, and never serves HTTP.
#
# The targets share the dependency + build stages but have completely separate
# final images, which is what keeps the web app and the worker physically
# separated: the web image cannot run the daemon, and the worker image never
# bundles the site. Build one or the other explicitly:
#
#   docker build --target web    -t pdfxyz-web:local .
#   docker build --target worker -t pdfxyz-worker:local .
#
# NOTE: This repository's build environment has no reachable Docker daemon, so
# these images were NOT built here. The Dockerfile's structure and the web/worker
# separation are covered by static tests (src/deploy/artifacts.test.ts). Build
# and run it in real worker infrastructure before advertising processing.

# Pin Node to a supported major (package.json engines: >=20; CI uses 22).
ARG NODE_VERSION=22

# --------------------------------------------------------------------------- #
# base — Corepack-provided pnpm (pinned by the `packageManager` field).
# --------------------------------------------------------------------------- #
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --------------------------------------------------------------------------- #
# deps — full install (dev deps included: `next build` and the worker's `tsx`
# runner both need them). Cached on the manifests alone.
# --------------------------------------------------------------------------- #
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------------------- #
# build — produce the production Next.js build (consumed by the `web` target).
# `.dockerignore` keeps secrets and the `.claude-*.md` prompts out of the copy.
# --------------------------------------------------------------------------- #
FROM deps AS build
# NEXT_PUBLIC_* values are BAKED at `pnpm build` — runtime env cannot supply
# them. The one that matters is the CSP connect-src extension for the storage
# origin: built without it, every browser→R2 upload is blocked by the page's
# own Content-Security-Policy, and nothing fails until a real visitor picks a
# file. `publish.yml` passes it and then asserts the served CSP actually
# carries the origin before pushing; `container.yml` builds without it on
# purpose (its contract is no secrets, no publishing — a blank arg keeps that
# build byte-stable).
ARG NEXT_PUBLIC_STORAGE_CONNECT_SRC=""
ENV NEXT_PUBLIC_STORAGE_CONNECT_SRC=${NEXT_PUBLIC_STORAGE_CONNECT_SRC}
COPY . .
RUN pnpm build

# --------------------------------------------------------------------------- #
# web — the site runtime. `next start` over the prebuilt output. Deliberately
# installs NO native PDF engines and never references the worker daemon.
# --------------------------------------------------------------------------- #
FROM base AS web
ENV NODE_ENV=production
# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# `next start` serves `public/` straight from disk. The build stage's copy is
# the complete one — `pnpm build` runs the pdfjs-wasm and Noto-font copy steps
# before `next build` — and this image shipped WITHOUT it until 2026-08-24,
# because nothing had ever run the image: every font, wasm decoder, and static
# file would have 404'd on the first non-Vercel deployment (Vercel serves
# `public/` itself, which is why the gap was invisible there).
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
USER nextjs
# `next start` honors PORT; no worker secrets are needed to serve the site.
ENV PORT=3000
EXPOSE 3000
# Invoke `next` directly: the runtime needs Node, not a package manager. The
# first boot of this image died on `CMD ["pnpm", "start"]` — corepack's first
# run tries to download pnpm into the invoking user's cache, and the system
# user `nextjs` has no writable home (`useradd --system` creates none), so the
# container exited EACCES before serving a byte. The worker stage solved the
# same trap with a COREPACK_HOME + mkdir dance (see below) because its runtime
# genuinely needs pnpm scripts; the web runtime does not, so it drops the
# package manager instead of accommodating it.
CMD ["node_modules/.bin/next", "start"]

# --------------------------------------------------------------------------- #
# worker — the out-of-band secure-worker daemon runtime. Installs the native
# deep-compression + OCR engines and runs `pnpm worker:daemon`. Never serves HTTP.
# --------------------------------------------------------------------------- #
FROM base AS worker
ENV NODE_ENV=production
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
# Native engines the secure-worker path advertises. Two families, one apt layer
# (a single `apt-get update` + cleanup keeps the layer small and cache-honest):
#
#   * Deep compression — lossless structural repack needs none of these; deep
#     image compression auto-detects Ghostscript (`gs`), qpdf, or mutool on PATH
#     and runs the first it finds. `mupdf-tools` provides `mutool`.
#   * OCR (optional; `PDFXYZ_OCR`, off by default) — `ocrmypdf` is the PDF-first
#     engine (adds an invisible text layer to a scanned PDF; it wraps Tesseract +
#     Ghostscript). `tesseract-ocr` is the guaranteed baseline (image → searchable
#     PDF / text sidecar). Every language pack is installed EXPLICITLY because
#     `--no-install-recommends` would otherwise skip them and leave OCR with no
#     traineddata.
#
#     ONE PACK PER LANGUAGE THE PRODUCT OFFERS. The list below must stay in step
#     with `OCR_LANGUAGES` in `src/lib/jobs/ocr.ts` — that array is what the UI
#     shows and the job API accepts, so a language present there but absent here
#     is a promise the worker cannot keep. It reads as a broken file to the user:
#     Tesseract exits non-zero on a missing pack and the job surfaced
#     "The OCR engine could not process this file", blaming their document for
#     our missing dependency. `src/deploy/ocr-languages.test.ts` fails the build
#     if the two ever drift apart again.
#   * Proof-only tooling — `poppler-utils` provides `pdftotext`, used ONLY by the
#     deterministic OCRmyPDF searchable-PDF proof (`worker:ocrmypdf-proof`) to confirm
#     the synthetic source PDF carries no selectable text and the OCRmyPDF output does
#     (image-only → searchable). It is not on the OCR runtime path; it is packaged here
#     so that proof can run inside the image, and it stays out of the `web` image.
#
# Installed here and ONLY here: the `web` target ships none of these. Provider and
# OCR config is still read from the environment at run time, never baked into a layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ghostscript \
      qpdf \
      mupdf-tools \
      chromium \
      libreoffice \
      ocrmypdf \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-spa \
      tesseract-ocr-fra \
      tesseract-ocr-deu \
      tesseract-ocr-ita \
      tesseract-ocr-por \
      tesseract-ocr-nld \
      tesseract-ocr-rus \
      tesseract-ocr-ukr \
      tesseract-ocr-pol \
      tesseract-ocr-swe \
      tesseract-ocr-tur \
      tesseract-ocr-chi-sim \
      tesseract-ocr-jpn \
      tesseract-ocr-kor \
      tesseract-ocr-vie \
      tesseract-ocr-ind \
      tesseract-ocr-tha \
      tesseract-ocr-ara \
      tesseract-ocr-hin \
      tesseract-ocr-ben \
      poppler-utils \
 && rm -rf /var/lib/apt/lists/*
# PDF/A OutputIntent profile. A PDF/A file that uses device colour must embed an
# ICC profile as its OutputIntent, and Ghostscript's PDF/A recipe reads one from
# disk (src/lib/workers/pdf-archive/native.ts writes the prefix that does). The
# profile is Ghostscript's OWN sRGB, found wherever this distro's package put it
# and copied to one fixed path, so the runtime never guesses a distro layout.
# `test -s` fails the BUILD if no profile was found: an image without it would
# otherwise run PDF/A and refuse every job at the output gate. The path must
# equal DEFAULT_PDFA_ICC_PROFILE in pdf-archive/native-config.ts;
# src/deploy/artifacts.test.ts pins the two together.
RUN icc="$(find /usr/share -path '*ghostscript*' -name srgb.icc -print -quit)" \
 && test -n "$icc" \
 && mkdir -p /usr/share/pdfxyz \
 && cp -L "$icc" /usr/share/pdfxyz/srgb.icc \
 && test -s /usr/share/pdfxyz/srgb.icc
# Run as a non-root user. Corepack may need to hydrate pnpm shims at runtime
# (`docker run … pnpm worker:smoke` in CI), so the worker-owned HOME/cache and
# PNPM_HOME must exist before `USER worker` or Corepack fails with EACCES.
ENV COREPACK_HOME=/home/worker/.cache/node/corepack
RUN groupadd --system --gid 1001 worker \
 && useradd --system --uid 1001 --gid worker --home-dir /home/worker --create-home worker \
 && mkdir -p /home/worker/.cache/node/corepack /pnpm \
 && chown -R worker:worker /home/worker /pnpm /app
# The daemon runs scripts/worker-daemon.ts via tsx, so it needs the source tree
# and its config — but NOT the web build (`.next` is intentionally not copied).
COPY --from=build --chown=worker:worker /app/node_modules ./node_modules
COPY --from=build --chown=worker:worker /app/package.json ./package.json
COPY --from=build --chown=worker:worker /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=worker:worker /app/scripts ./scripts
COPY --from=build --chown=worker:worker /app/src ./src
USER worker
# Presence-only readiness probe: exit 0 = drainable (queue + storage configured),
# exit 2 = not configured. Provider config is read from the environment at run
# time (never baked into the image). Claims no job and processes nothing.
HEALTHCHECK --interval=1m --timeout=30s --start-period=20s --retries=3 \
  CMD ["pnpm", "worker:daemon", "--dry-run-status"]
# Default: long-running drain-then-poll loop. Override for batch/smoke runs, e.g.
#   docker run --rm pdfxyz-worker:local pnpm worker:daemon --drain
CMD ["pnpm", "worker:daemon"]
