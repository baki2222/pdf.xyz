# Deployment

pdf.xyz deploys to **Vercel** and serves from the **pdf.xyz** domain. This guide
covers first-time setup, the environment policy, and the day-to-day
preview → production workflow.

> The app is a standard Next.js App Router project. Nothing here requires
> secrets today — every live tool runs in the browser.

---

## 1. Prerequisites

- A Vercel account with access to the target team.
- The GitHub repo connected to Vercel (`baki2222/pdf.xyz`).
- Node ≥ 20 and pnpm locally (pnpm is pinned via `packageManager` in
  `package.json`, so Vercel and CI use the same version).

## 2. Create the Vercel project

1. **New Project → Import** the GitHub repository.
2. Framework preset: **Next.js** (auto-detected).
3. Build & install commands: taken from [`vercel.json`](../vercel.json) —
   - Install: `pnpm install --frozen-lockfile`
   - Build: `pnpm build`
4. Node.js version: **20.x or 22.x** (Project → Settings → General).
5. Leave the output/root defaults; there is no custom output directory.

`vercel.json` also sets sensible CDN cache headers for `robots.txt`,
`sitemap.xml`, and the manifest. All **security headers and the CSP** are
defined in `next.config.mjs` so they apply identically in local `next start`,
preview, and production.

## 3. Environment variables

**Policy: never commit secrets, and never read `.env*` files into the client.**

- `.env`, `.env.local`, and `.env*.local` are git-ignored (see `.gitignore`).
- **Today:** no environment variables are required. The whole app builds and
  runs without any.
- **When secure workers / AI land:** add their keys in
  **Vercel → Project → Settings → Environment Variables**, scoped to the right
  environment (Production / Preview / Development). Server-only secrets must
  **not** be prefixed `NEXT_PUBLIC_` (that prefix exposes a value to the
  browser). Keep worker/AI credentials server-side only.

## 4. Custom domain (pdf.xyz)

1. **Project → Settings → Domains → Add** `pdf.xyz` and `www.pdf.xyz`.
2. Set the redirect so one is canonical (recommend `pdf.xyz` apex as canonical,
   `www` → apex).
3. Configure DNS at the registrar as Vercel instructs, typically:
   - Apex `pdf.xyz`: `A` → `76.76.21.21` **or** an `ALIAS`/`ANAME` to
     `cname.vercel-dns.com` (registrar-dependent).
   - `www`: `CNAME` → `cname.vercel-dns.com`.
4. Vercel provisions TLS automatically.
5. Confirm `siteConfig.url` in `../src/lib/site.ts` is `https://pdf.xyz` — it is the
   `metadataBase` for canonical/OG URLs, robots, and the sitemap.

**HSTS note:** the app sends `Strict-Transport-Security` with `preload` in
production. This is correct for a dedicated HTTPS domain, but it commits the
apex + subdomains to HTTPS. Only submit to the [HSTS preload list](https://hstspreload.org/)
once you are certain every current and future subdomain will always serve
HTTPS.

## 5. Preview → production workflow

- **Pull requests** get an automatic **Preview Deployment** with a unique URL.
  CI (`../.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build, and
  the Playwright smoke suite on every PR.
- **`main`** is the production branch — merges deploy to `pdf.xyz`.
- Branch model: feature work happens on `phase-*` branches (e.g.
  `phase-4-production-hardening`). Open a PR into `main`; **do not** deploy
  straight to production from a feature branch.
- **Rollback:** Vercel keeps every deployment. Use
  **Deployments → ⋯ → Promote/Rollback** for an instant revert.

## 6. Post-deploy checklist

Run against the live/preview URL:

```bash
# Security headers
curl -sI https://pdf.xyz | grep -iE 'content-security-policy|x-frame-options|strict-transport|referrer-policy|permissions-policy|x-content-type'

# Crawl + share surfaces
curl -s https://pdf.xyz/robots.txt
curl -s https://pdf.xyz/sitemap.xml | head
curl -sI https://pdf.xyz/opengraph-image | grep -i content-type
```

- [ ] Security headers + CSP present (no CSP console errors on tool pages).
- [ ] `robots.txt` points at the sitemap; `sitemap.xml` lists tool pages.
- [ ] OG image renders (paste a tool URL into a link-preview debugger).
- [ ] Core in-browser tools work (merge two PDFs end-to-end).
- [ ] Lighthouse: performance, SEO, and accessibility are green.
