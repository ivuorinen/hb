# Humble download-links bookmarklet: design

## Intent

A bookmarklet clicked on a Humble Bundle library bundle page
(`humblebundle.com/…/library/…`) collects every download of that bundle as a
full signed URL and saves them to a text file, one URL per line, so curl can
download everything without a browser session.

## Goals

- Every file of every DRM-free download in the bundle, all formats (EPUB, PDF,
  MOBI, PRC, CBZ, ZIP, …).
- Output: a `.txt` file, one absolute `https://cdn.humble.com/…?t=…` URL per
  line, nothing else. `curl -O` names files from the URL path (query string
  dropped; verified with curl 8.7.1).
- Works on all eight saved example pages, whether or not the page embeds
  signed URLs. (The saved pages held personal library data and are not in
  the repo; the tests use a made-up page in the same format,
  `test/fixtures/bundle-page.html.txt`.)

## Non-goals

- The whole library in one click. One run handles the bundle page it is
  clicked on.
- Keys (Steam etc.), streams, torrents.
- Format filtering in the bookmarklet. Filter the output with `grep`.
- Downloading. curl does that.

## Constraints

- Signed URLs expire 24 h after issue (`exp − st = 86400`); curl must run
  within that window.
- 7 of 8 example pages have `signedUrls: "$undefined"`; URLs exist only after
  a server call. Only `dystopian-worlds.html` embeds them.
- The site is Next.js App Router. Page data is the RSC payload, streamed as
  inline `self.__next_f.push([1, "…"])` scripts; Next.js's runtime drains the
  `self.__next_f` array itself on load. Download buttons call the Server Action
  `getSignedUrlsForEntitlements([entitlementId])`, whose 42-char action hash
  changes on each Humble deploy.

## Approaches

- **A. Call the Server Action directly (chosen).** One code path for every
  page. Depends on the Next.js action request format and the function name.
- B. Patch `window.open`, click every download button. Survives a renamed
  action, but fires one click, one toast and one `recordDownload` per file,
  and depends on button markup.
- Rejected: hard-coding the action hash (breaks on deploy); the Bulk Download
  button (`/api/library/bulk-download` streams a zip via the session cookie;
  no curl-usable links).

## How (decided)

1. **Entitlements**: `self.__next_f` must exist (a Next.js page), but its
   contents are gone by the time the bookmarklet runs. Read the
   `self.__next_f.push([1, "…"])` literals from the inline `<script>`
   elements, JSON-parse and join them; regex out
   `{"id":"<uuid>","title":"…","type":"download_drm_free"`. Row 0's canonical
   path (`"c":["","home","library","<bundle id>"]`) must end in the same
   bundle id as `location.pathname`, because in-app navigation leaves the
   previous page's scripts in the DOM. No entitlements, or a mismatch: show
   "reload the page and try again" and stop.
2. **Action hash**: collect JS URLs under `/_next/static/chunks/` from
   `<script src>` tags plus `performance.getEntriesByType("resource")`; fetch
   each (browser cache) and match `"([0-9a-f]{40,})",[^"]*"getSignedUrlsForEntitlements"`.
   Not found → say so and stop.
3. **Signed URLs**: for each entitlement, sequentially, `POST location.href`
   with headers `Next-Action: <hash>`, `Accept: text/x-component`, body
   `JSON.stringify([[id]])` — one ID per call, as the site does. Parse each
   response line (`<n>:<json>`); as the site's client does, read only
   `data.signedUrls` of the `ok: true` row and collect its `https://`
   strings. Dedupe. An empty `signedUrls` object is a failure.
4. **Failures**: an HTTP or parse error marks that title failed and the run
   continues. A successful response with no URLs (e.g. a region-message
   entitlement) is not a failure.
5. **Progress**: a modal `<dialog>` opens on click, in a shadow root so the
   page's CSS cannot restyle it. A `<progress>` bar counts titles done of
   the total (indeterminate until the hash is found), and a line counts the
   links collected so far. `document.title` also shows `n/total` and is
   restored at the end. Every message, errors included, goes to the modal;
   there are no alerts. Closing the modal mid-run hides it; the result
   reopens it.
6. **Save**: Blob → `<a download>` click, filename slugged from the bundle
   title, e.g. `humble-book-bundle-a-i-by-packt.txt`. The modal then shows
   the link count, title count and failed titles.
7. **Usage**: `./hb.sh humble-book-bundle-a-i-by-packt.txt` downloads
   every URL into a folder named after the list.

## Files

- `site/`: everything GitHub Pages serves at <https://ivuorinen.net/hb/>,
  and nothing else.
  - `humble-links.js`: readable source.
  - `bookmarklet.mjs`: `buildBookmarklet(source)`, the `javascript:` +
    `encodeURIComponent` wrapper.
  - `index.html`: install page. It fetches `humble-links.js` and builds the
    draggable link in the browser, so there is no build step and no
    generated file to keep in sync.
- `hb.sh`: downloads a saved list into a folder named after it.
- `mise.toml`: pinned tools and the `preview`, `bookmarklet`, `test` and
  `lint` tasks. mise's lockfiles are local only (`.gitignore`).
- `.github/workflows/ci.yml`: installs the tools from `mise.toml` and runs
  `mise run lint` and `mise run test` on every push and pull request; on
  `main`, uploads `site/` as the Pages artifact and deploys it.

## Left to the builder

- Code layout that lets the parsing functions (entitlements from RSC text,
  hash from a chunk, URLs from an action response) run under `node --test`
  against the saved pages and the downloaded chunk, while the built
  bookmarklet stays one self-contained expression.
- Whether the action needs a `Next-Router-State-Tree` header: verify on the
  live page; add it only if the server rejects the call without it.
- The live network call cannot be tested offline. Final check is on a real
  bundle page in a logged-in browser.
