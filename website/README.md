# ArcFlow project website

A bilingual, static GitHub Pages website. Chinese is served at `/ArcFlow/`, English at `/ArcFlow/en/`. No backend, tracking scripts, external fonts, data-collection forms, or runtime package dependencies.

## Build and check

Python 3.9+ and Node.js 22 are used for development checks. The build itself uses Python's standard library.

```sh
cd website
python3 scripts/build.py
python3 scripts/check.py
npm ci
npx playwright install --with-deps chromium
npm test
```

`dist/` is the deployable output. CSS and JavaScript filenames include content hashes so returning visitors never mix new HTML with old cached code. The test server intentionally serves the real `/ArcFlow/` project prefix. Playwright covers both languages at 320, 390, 768, and 1440 pixels; scenario tabs; keyboard navigation; repeated image-dialog opening and dismissal; language navigation with Back/Forward; reduced motion; JavaScript-disabled content; image loading; overflow; console exceptions; and unexpected third-party requests.

## Content and assets

- Edit bilingual copy in `content.json`, page structure in `scripts/build.py`, presentation in `style.css`, and progressive enhancement in `app.js`.
- Feature baseline: main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`.
- The published `v0.1.0-alpha.3` is older than that baseline. PR #39 is an unmerged candidate, not advertised as a delivered feature.
- `assets/provenance.json` preserves original screenshot paths, capture commits, workflow URLs, and SHA-256 hashes. All 10 screenshots are original bytes from the public repository and contain synthetic demo data. They do not prove production readiness or current CI.
- `assets/social-card.svg` is the editable source for the committed 1200 × 630 PNG. It contains original vector artwork and text, without a fabricated product interface. Regenerate with Inkscape when changing it.

## Publication

GitHub Pages was verified disabled before this work: Deploy from a branch, source None. The intended publication uses an independent `gh-pages` branch, root directory `/`, with only the contents of `dist/`. This follows GitHub's branch-publishing route and requires no custom `pages: write` or `id-token: write` workflow grant. No credentials, custom domain, paid service, application PR merge, or security-policy change is required.

The source PR remains a draft for review. Publishing this static site does not merge the source PR or application candidates. Future publication should always build and check the intended source commit, then update only the separate Pages branch. Do not copy source files, local evidence, logs, node_modules, or private data into the public deployment.

Official guidance: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
