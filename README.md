# Humble links

A bookmarklet that saves every download of a Humble Bundle library bundle
page as signed URLs, one per line, for curl.

## Install

Open <https://ivuorinen.net/hb/> and drag the **Humble links** link to your
bookmarks bar. The page builds the link from `humble-links.js` when it loads.

## Use

1. Open a bundle page in your Humble library. Load it fresh (reload it if you
   got there by clicking around the library).
2. Click the bookmark. A window shows how many links it has collected, with a
   progress bar over the bundle's titles. When it finishes, a `.txt` file
   named after the bundle downloads and the window reports how many links
   were saved and which titles, if any, failed.

## Download

```sh
./hb.sh ~/Downloads/humble-book-bundle-a-i-by-packt.txt
```

This downloads every file into `humble-book-bundle-a-i-by-packt/` in the
current directory. Running it again skips finished files and resumes partial
ones. It exits non-zero if any download failed. The signed URLs expire 24
hours after the click.

## Develop

[mise](https://mise.jdx.dev/) installs the tools pinned in `mise.toml`:
run `mise install`, then:

| Task                   | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `mise run preview`     | Serves `site/` at <http://localhost:3000>, reloading on changes |
| `mise run bookmarklet` | Prints the bookmark URL, e.g. `mise run bookmarklet \| pbcopy`  |
| `mise run test`        | Runs the tests                                                  |
| `mise run lint`        | Runs Biome, yamllint, actionlint, zizmor, shellcheck and shfmt  |
| `mise run lint-fix`    | Applies Biome's safe fixes and formatting                       |
- Edit `site/humble-links.js`. There is no build step: `site/index.html`
  wraps it into the bookmark URL with `site/bookmarklet.mjs` when it loads,
  so the preview always offers the current code to drag.
- The tests use a made-up bundle page, `test/fixtures/bundle-page.html.txt`,
  so no real library data is in the repo.
- mise's lockfiles (`mise.lock`, `.mise/locks/`) stay local: git and the
  linters ignore them.
- In Claude Code, a PostToolUse hook (`.claude/settings.json`,
  `.claude/hooks/lint-fix.sh`) runs `mise run lint-fix` after every Write or
  Edit, and shows Claude whatever Biome cannot fix.
- CI (`.github/workflows/ci.yml`) installs the same tools with mise, runs
  `lint` and `test` on every push and pull request, then publishes `site/`
  to GitHub Pages from `main`. Only `site/` is published.
- Design: `docs/2026-11-14-humble-links-bookmarklet-design.md`
