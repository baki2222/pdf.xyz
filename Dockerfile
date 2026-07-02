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
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
USER nextjs
# `next start` honors PORT; no worker secrets are needed to serve the site.
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "start"]

# --------------------------------------------------------------------------- #
# worker — the out-of-band secure-worker daemon runtime. Installs the native
# deep-compression + OCR engines and runs `pnpm worker:daemon`. Never serves HTTP.
# --------------------------------------------------------------------------- #
FROM base AS worker
ENV NODE_ENV=production
# Native engines the secure-worker path advertises. Two families, one apt layer
# (a single `apt-get update` + cleanup keeps the layer small and cache-honest):
#
#   * Deep compression — lossless structural repack needs none of these; deep
#     image compression auto-detects Ghostscript (`gs`), qpdf, or mutool on PATH
#     and runs the first it finds. `mupdf-tools` provides `mutool`.
#   * OCR (optional; `PDFXYZ_OCR`, off by default) — `ocrmypdf` is the PDF-first
#     engine (adds an invisible text layer to a scanned PDF; it wraps Tesseract +
#     Ghostscript). `tesseract-ocr` is the guaranteed baseline (image → searchable
#     PDF / text sidecar), and `tesseract-ocr-eng` is the minimal English language
#     data both engines need — installed EXPLICITLY because `--no-install-recommends`
#     would otherwise skip the language pack and leave OCR with no traineddata.
#
# Installed here and ONLY here: the `web` target ships none of these. Provider and
# OCR config is still read from the environment at run time, never baked into a layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ghostscript \
      qpdf \
      mupdf-tools \
      ocrmypdf \
      tesseract-ocr \
      tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
# Run as a non-root user.
RUN groupadd --system --gid 1001 worker \
 && useradd --system --uid 1001 --gid worker worker
# The daemon runs scripts/worker-daemon.ts via tsx, so it needs the source tree
# and its config — but NOT the web build (`.next` is intentionally not copied).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
USER worker
# Presence-only readiness probe: exit 0 = drainable (queue + storage configured),
# exit 2 = not configured. Provider config is read from the environment at run
# time (never baked into the image). Claims no job and processes nothing.
HEALTHCHECK --interval=1m --timeout=30s --start-period=20s --retries=3 \
  CMD ["pnpm", "worker:daemon", "--dry-run-status"]
# Default: long-running drain-then-poll loop. Override for batch/smoke runs, e.g.
#   docker run --rm pdfxyz-worker:local pnpm worker:daemon --drain
CMD ["pnpm", "worker:daemon"]
