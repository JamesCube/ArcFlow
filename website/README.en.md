# Project website

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-project-website"></a>
<a id="publication"></a>

[简体中文](README.md)


<!-- topic:scope -->
A bilingual static GitHub Pages site: Chinese at `/ArcFlow/`, English at `/ArcFlow/en/`. It contains no approval backend, tracking scripts, external fonts, data-collection forms or runtime package dependencies.

<!-- topic:build -->
## Build and check

Development checks use Python 3.9+ and Node 22. The build itself uses only Python's standard library:

```sh
cd website
python3 scripts/build.py
python3 scripts/check.py
npm ci
npx playwright install --with-deps chromium
npm test
```

`dist/` is deployable output. Content-hashed CSS/JS names prevent mixed cached versions. The test server uses the real `/ArcFlow/` prefix. Browser coverage includes both languages at 320/390/768/1440px, tabs and keyboards, repeated image dialogs, language Back/Forward, reduced motion, no-JS content, image loading, overflow, console errors and unexpected third-party requests.

<!-- topic:content -->
## Content and assets

- Copy lives in `content.json`, structure in `scripts/build.py`, styles in `style.css`, and progressive enhancement in `app.js`.
- Feature copy and launch commands are pinned to `8f7e37ce9bea6a4f04f357fab280a04cb5c885c3`; all documentation links target the matching language on current main. This includes PR #50 graph support, which is not included in the older alpha.3 tag.
- Documentation navigation leads to the categorized index, HTTP reference and OpenAPI. Publish revised navigation only after its target documentation is merged.
- `assets/provenance.json` retains original screenshot paths, commits, CI and SHA-256. Fourteen original images contain synthetic data only and do not prove current CI or production readiness.
- Four graph images are exact originals from accepted commit `9bb7a84a`, run `38193744653`, artifact `11722613201`. Their original artifact paths, dimensions and hashes are recorded in the same provenance file. The complete source images are displayed without editing; previews link to the local originals.
- The graph guide and local-start links describe the standalone payment workspace. This static site does not host Java or an interactive approval demo.
- `assets/social-card.svg` is the original editable vector source of the committed 1200×630 PNG. Rebuild with Inkscape after edits; do not fabricate product UI.

<!-- topic:publication -->
## Publication boundaries

Source lives on main; editing it does not publish the site. Update only built, verified dist content on the separate gh-pages branch at its root. Never publish repository source, logs, dependencies, private data or local evidence. Deployment needs separate authorization and requires no new Pages/token grants, paid service or custom domain.

Pages was disabled at the initial historical checkpoint; that is not a current status claim. Verify actual hosting settings before deployment. See [GitHub Pages branch publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
